"""
LocalMind FastAPI backend — runs as a sidecar on localhost:8765.
"""
import asyncio
import json
import logging
import platform
import socket
import subprocess
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import catalog
import hardware
import installer
import llamacpp_backend
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


@app.post("/chat")
async def chat_endpoint(req: ChatRequest) -> StreamingResponse:
    if req.backend == "ollama":
        gen = ollama_backend.chat(req.model, req.messages)
    elif req.backend == "llamacpp":
        models_dir = __import__("pathlib").Path.home() / "localmind" / "models"
        model_path = str(models_dir / req.model)
        try:
            llamacpp_backend.load_model(model_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail={"message": f"Could not load model: {exc}"}) from exc
        gen = llamacpp_backend.chat(req.messages)
    else:
        raise HTTPException(status_code=400, detail={"message": f"Unknown backend: {req.backend}"})

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
