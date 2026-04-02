import logging
from pathlib import Path
from typing import Any, AsyncGenerator

logger = logging.getLogger(__name__)

MODELS_DIR = Path.home() / "localmind" / "models"

_loaded_model: Any = None
_loaded_model_path: str | None = None


def _get_llama_cpp():
    try:
        from llama_cpp import Llama  # type: ignore
        return Llama
    except ImportError as exc:
        raise RuntimeError("llama-cpp-python is not installed.") from exc


def load_model(path: str) -> None:
    """Load a GGUF model from disk. Caches the loaded model."""
    global _loaded_model, _loaded_model_path

    if _loaded_model_path == path and _loaded_model is not None:
        return  # already loaded

    Llama = _get_llama_cpp()
    logger.info("Loading llama.cpp model from %s", path)
    _loaded_model = Llama(model_path=path, n_ctx=4096, n_threads=4, verbose=False)
    _loaded_model_path = path
    logger.info("Model loaded.")


async def chat(messages: list[dict[str, str]]) -> AsyncGenerator[dict, None]:
    """
    Stream a chat response using the currently loaded llama.cpp model.
    Yields: {"token": str}
    Final: {"done": True}
    """
    if _loaded_model is None:
        yield {"error": "No model loaded. Please load a model first."}
        yield {"done": True}
        return

    # Build a simple prompt from messages
    prompt = _build_prompt(messages)

    stream = _loaded_model(
        prompt,
        max_tokens=1024,
        stream=True,
        stop=["</s>", "<|end|>", "<|user|>"],
    )

    for chunk in stream:
        token = chunk["choices"][0]["text"]
        if token:
            yield {"token": token}

    yield {"done": True}


def list_models() -> list[dict]:
    """Return GGUF models stored in ~/localmind/models/."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    return [
        {
            "id": f.name,
            "path": str(f),
            "size_gb": round(f.stat().st_size / (1024**3), 1),
            "backend": "llamacpp",
        }
        for f in MODELS_DIR.glob("*.gguf")
    ]


def _build_prompt(messages: list[dict[str, str]]) -> str:
    """Convert OpenAI-style messages list into a plain text prompt."""
    parts: list[str] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            parts.append(f"System: {content}\n")
        elif role == "user":
            parts.append(f"<|user|>\n{content}\n<|end|>\n")
        elif role == "assistant":
            parts.append(f"<|assistant|>\n{content}\n<|end|>\n")
    parts.append("<|assistant|>\n")
    return "".join(parts)
