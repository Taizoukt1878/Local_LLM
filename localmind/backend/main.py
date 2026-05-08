"""
LocalMind FastAPI backend — runs as a sidecar on localhost:8765.
"""
import asyncio
import json
import logging
import os
import platform
import socket
import subprocess
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import catalog
import docs_backend
import hardware
import installer
import llamacpp_backend
import minds as minds_module
import ollama_backend

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Stale process cleanup helpers
# ---------------------------------------------------------------------------

def _is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def _free_port(port: int) -> None:
    """Kill the process holding *port*, then wait 1 second."""
    if not _is_port_in_use(port):
        return
    try:
        system = platform.system()
        if system == "Windows":
            result = subprocess.run(
                ["netstat", "-ano"], capture_output=True, text=True
            )
            pid = None
            for line in result.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.strip().split()
                    if parts:
                        pid = parts[-1]
                        break
            if pid:
                subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True)
        else:
            result = subprocess.run(
                ["lsof", "-ti", f":{port}"], capture_output=True, text=True
            )
            pid = result.stdout.strip()
            if pid:
                subprocess.run(["kill", "-9", pid], capture_output=True)
        time.sleep(1)
    except Exception:
        logger.warning("_free_port(%d) failed — continuing anyway", port)


def _free_ollama_process() -> None:
    """Kill any running ollama process, then wait 2 seconds."""
    try:
        system = platform.system()
        if system == "Windows":
            subprocess.run(["taskkill", "/IM", "ollama.exe", "/F"], capture_output=True)
        else:
            subprocess.run(["pkill", "-f", "ollama"], capture_output=True)
        time.sleep(2)
    except Exception:
        logger.warning("_free_ollama_process() failed — continuing anyway")

# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    # 1. Check Ollama (non-blocking Popen)
    if installer.is_ollama_installed():
        logger.info("Ollama found — cleaning up stale process then starting serve.")
        _free_ollama_process()
        _free_port(11434)
        installer.start_ollama_serve()
    else:
        logger.warning("Ollama not found; install flow required.")

    # 2. Fetch model catalog in the background so the server is immediately
    #    ready to serve /health without waiting for the network call.
    asyncio.create_task(catalog.fetch_catalog())

    yield  # app runs here


app = FastAPI(title="LocalMind Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "tauri://localhost",        # macOS Tauri
        "https://tauri.localhost",  # Windows WebView2 / Linux Tauri v2
        "http://localhost",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _stream_generator(gen: AsyncGenerator[dict, None]) -> AsyncGenerator[str, None]:
    async for event in gen:
        yield _sse(event)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class PullRequest(BaseModel):
    name: str
    backend: str = "ollama"
    download_url: str | None = None


class ChatRequest(BaseModel):
    model: str
    backend: str = "ollama"
    messages: list[dict[str, str]]
    mind_id: str = "general"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/system/info")
async def system_info() -> dict[str, Any]:
    # Run synchronous hardware probing in a thread so it never blocks the
    # asyncio event loop (subprocess calls inside can stall for seconds).
    loop = asyncio.get_event_loop()
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(None, hardware.get_hardware_profile),
            timeout=15.0,
        )
        return result
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail={"message": "Hardware probe timed out"})
    except Exception as exc:
        logger.exception("hardware probe failed")
        raise HTTPException(status_code=500, detail={"message": str(exc)}) from exc


class InstallRequest(BaseModel):
    sudo_password: str | None = None


@app.post("/install/ollama")
async def install_ollama_endpoint(req: InstallRequest = InstallRequest()) -> StreamingResponse:
    return StreamingResponse(
        _stream_generator(installer.install_ollama(sudo_password=req.sudo_password or None)),
        media_type="text/event-stream",
    )


@app.get("/install/status")
async def install_status() -> dict[str, bool]:
    installed = installer.is_ollama_installed()
    running = False
    if installed:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=2) as client:
                resp = await client.get("http://127.0.0.1:11434/api/tags")
                running = resp.status_code == 200
        except Exception:
            pass
    return {"installed": installed, "running": running}


@app.get("/catalog")
async def get_catalog() -> dict[str, Any]:
    return catalog.get_catalog()


@app.post("/models/pull")
async def pull_model(req: PullRequest) -> StreamingResponse:
    if req.backend == "ollama":
        gen = ollama_backend.pull_model(req.name)
    elif req.backend == "llamacpp":
        if not req.download_url:
            raise HTTPException(status_code=400, detail={"message": "download_url required for llamacpp backend"})
        gen = _pull_llamacpp(req.name, req.download_url)
    else:
        raise HTTPException(status_code=400, detail={"message": f"Unknown backend: {req.backend}"})

    return StreamingResponse(_stream_generator(gen), media_type="text/event-stream")


async def _pull_llamacpp(name: str, url: str) -> AsyncGenerator[dict, None]:
    """Download a GGUF file into ~/localmind/models/."""
    import httpx
    from pathlib import Path

    dest_dir = Path.home() / "localmind" / "models"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / name

    yield {"status": "downloading", "percent": 0}
    async with httpx.AsyncClient(follow_redirects=True, timeout=600) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            downloaded = 0
            with dest.open("wb") as fh:
                async for chunk in resp.aiter_bytes(65536):
                    fh.write(chunk)
                    downloaded += len(chunk)
                    pct = int(downloaded * 100 / total) if total else 0
                    yield {"status": "downloading", "percent": pct}

    yield {"status": "complete", "percent": 100}
    yield {"done": True}


@app.delete("/models/{name:path}")
async def delete_model(name: str, backend: str = "ollama") -> dict[str, str]:
    try:
        if backend == "ollama":
            await ollama_backend.delete_model(name)
        elif backend == "llamacpp":
            from pathlib import Path
            path = Path.home() / "localmind" / "models" / name
            if path.exists():
                path.unlink()
            else:
                raise HTTPException(status_code=404, detail={"message": "Model file not found"})
        else:
            raise HTTPException(status_code=400, detail={"message": f"Unknown backend: {backend}"})
        return {"message": "Model deleted successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("delete_model failed")
        raise HTTPException(status_code=500, detail={"message": str(exc)}) from exc


@app.get("/models/installed")
async def list_installed() -> list[dict]:
    results: list[dict] = []

    if installer.is_ollama_installed():
        try:
            results.extend(await ollama_backend.list_models())
        except Exception:
            logger.warning("Could not list Ollama models.")

    try:
        results.extend(llamacpp_backend.list_models())
    except Exception:
        logger.warning("Could not list llama.cpp models.")

    return results


@app.get("/minds")
async def list_minds() -> list[dict]:
    return minds_module.list_minds()


@app.get("/minds/{mind_id}")
async def get_mind(mind_id: str) -> dict:
    return minds_module.get_mind(mind_id)


@app.post("/chat")
async def chat_endpoint(req: ChatRequest) -> StreamingResponse:
    mind = minds_module.get_mind(req.mind_id)
    system_prompt: str = mind["system_prompt"]
    temperature: float = mind["temperature"]

    # Strip any existing system message from the client — mind takes precedence.
    clean_messages = [m for m in req.messages if m.get("role") != "system"]

    if req.backend == "ollama":
        gen = ollama_backend.chat(req.model, clean_messages, system_prompt, temperature)
    elif req.backend == "llamacpp":
        models_dir = __import__("pathlib").Path.home() / "localmind" / "models"
        model_path = str(models_dir / req.model)
        try:
            llamacpp_backend.load_model(model_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail={"message": f"Could not load model: {exc}"}) from exc
        gen = llamacpp_backend.chat(clean_messages)
    else:
        raise HTTPException(status_code=400, detail={"message": f"Unknown backend: {req.backend}"})

    return StreamingResponse(_stream_generator(gen), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Docs / RAG endpoints
# ---------------------------------------------------------------------------

class DocChatRequest(BaseModel):
    question: str
    model: str
    backend: str = "ollama"
    mind_id: str = "general"


@app.get("/docs/compatibility")
async def docs_compatibility() -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, docs_backend.check_compatibility)


@app.get("/docs")
async def list_docs() -> list:
    return docs_backend.list_docs()


_ALLOWED_DOC_EXTS = {".pdf", ".docx", ".txt"}
_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


def _check_docs_available() -> None:
    if not docs_backend.is_available():
        raise HTTPException(
            status_code=503,
            detail={
                "message": (
                    "The document feature requires sentence-transformers. "
                    "Run: pip install sentence-transformers and restart the backend."
                )
            },
        )


@app.post("/docs/upload")
async def upload_document(file: UploadFile = File(...)) -> dict:
    _check_docs_available()

    ext = Path(file.filename or "").suffix.lower()
    if ext not in _ALLOWED_DOC_EXTS:
        return {"error": f"Unsupported file type '{ext}'. Use PDF, DOCX, or TXT."}

    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        return {"error": "File too large. Maximum size is 50 MB."}

    doc_id = str(uuid.uuid4())
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        loop = asyncio.get_event_loop()
        metadata = await loop.run_in_executor(
            None,
            docs_backend.parse_and_index,
            tmp_path,
            doc_id,
            file.filename or "document",
        )
        return metadata
    except ImportError as exc:
        logger.warning("docs unavailable: %s", exc)
        return {"error": str(exc)}
    except Exception as exc:
        logger.warning("parse_and_index failed: %s", exc)
        return {
            "error": "Could not read this file. Make sure it is not password protected or corrupted."
        }
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.delete("/docs/{doc_id}")
async def delete_document(doc_id: str) -> dict:
    deleted = docs_backend.delete_doc(doc_id)
    return {"success": deleted}


@app.post("/docs/{doc_id}/chat")
async def doc_chat_endpoint(doc_id: str, req: DocChatRequest) -> StreamingResponse:
    _check_docs_available()
    if doc_id not in docs_backend.DOC_STORE:
        raise HTTPException(status_code=404, detail={"message": "Document not found"})

    loop = asyncio.get_event_loop()
    try:
        context = await loop.run_in_executor(
            None, docs_backend.query, doc_id, req.question
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"message": str(exc)}) from exc

    mind = minds_module.get_mind(req.mind_id)
    system_prompt: str = mind["system_prompt"]
    temperature: float = mind["temperature"]

    user_content = (
        "Use the following context from my document to answer my question. "
        "If the answer is not in the context, say clearly that you could not find it in the document.\n\n"
        f"Context:\n{context}\n\n"
        f"Question: {req.question}"
    )
    messages = [{"role": "user", "content": user_content}]

    if req.backend == "ollama":
        gen = ollama_backend.chat(req.model, messages, system_prompt, temperature)
    elif req.backend == "llamacpp":
        models_dir = Path.home() / "localmind" / "models"
        model_path = str(models_dir / req.model)
        try:
            llamacpp_backend.load_model(model_path)
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail={"message": f"Could not load model: {exc}"}
            ) from exc
        gen = llamacpp_backend.chat(messages)
    else:
        raise HTTPException(
            status_code=400, detail={"message": f"Unknown backend: {req.backend}"}
        )

    return StreamingResponse(_stream_generator(gen), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Free any stale backend process before binding the port.
    _free_port(8765)
    # Use the app object directly instead of a string import — string-based
    # module references break in PyInstaller frozen executables.
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
