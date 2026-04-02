import json
import logging
from typing import Any, AsyncGenerator

import httpx

OLLAMA_BASE = "http://127.0.0.1:11434"
logger = logging.getLogger(__name__)


async def list_models() -> list[dict[str, Any]]:
    """Return list of locally installed Ollama models."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{OLLAMA_BASE}/api/tags")
        resp.raise_for_status()
        data = resp.json()
        return [
            {
                "id": m["name"],
                "size_gb": round(m.get("size", 0) / (1024**3), 1),
                "backend": "ollama",
                "modified_at": m.get("modified_at", ""),
            }
            for m in data.get("models", [])
        ]


async def pull_model(name: str) -> AsyncGenerator[dict, None]:
    """
    Stream pull progress for an Ollama model.
    Yields dicts: {"status": str, "percent": int}
    Final: {"done": True}
    """
    async with httpx.AsyncClient(timeout=600) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_BASE}/api/pull",
            json={"name": name, "stream": True},
        ) as resp:
            resp.raise_for_status()
            async for raw_line in resp.aiter_lines():
                if not raw_line.strip():
                    continue
                try:
                    event = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue

                total = event.get("total", 0)
                completed = event.get("completed", 0)
                percent = int(completed * 100 / total) if total else 0
                yield {"status": event.get("status", ""), "percent": percent}

    yield {"done": True}


async def delete_model(name: str) -> None:
    """Delete a locally installed Ollama model."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(
            "DELETE",
            f"{OLLAMA_BASE}/api/delete",
            json={"name": name},
        )
        resp.raise_for_status()


async def chat(
    model: str, messages: list[dict[str, str]]
) -> AsyncGenerator[dict, None]:
    """
    Stream a chat response from Ollama.
    Yields: {"token": str}
    Final: {"done": True}
    """
    async with httpx.AsyncClient(timeout=300) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_BASE}/api/chat",
            json={"model": model, "messages": messages, "stream": True},
        ) as resp:
            resp.raise_for_status()
            async for raw_line in resp.aiter_lines():
                if not raw_line.strip():
                    continue
                try:
                    event = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue

                if event.get("done"):
                    break

                token = event.get("message", {}).get("content", "")
                if token:
                    yield {"token": token}

    yield {"done": True}
