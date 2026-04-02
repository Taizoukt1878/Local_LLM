import json
import logging
from pathlib import Path
from typing import Any

import httpx

REMOTE_CATALOG_URL = "https://your-update-server.com/models.json"
LOCAL_CATALOG_PATH = Path(__file__).parent.parent / "models.json"

logger = logging.getLogger(__name__)

_catalog_cache: dict[str, Any] | None = None


def _is_llamacpp_available() -> bool:
    try:
        import llama_cpp  # noqa: F401
        return True
    except ImportError:
        return False


def _load_local_catalog() -> dict[str, Any]:
    with LOCAL_CATALOG_PATH.open() as f:
        return json.load(f)


async def fetch_catalog() -> dict[str, Any]:
    """Fetch catalog from remote, fall back to local bundled file."""
    global _catalog_cache

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(REMOTE_CATALOG_URL)
            resp.raise_for_status()
            _catalog_cache = resp.json()
            logger.info("Loaded catalog from remote.")
    except Exception:
        logger.warning("Could not fetch remote catalog; using local bundled version.")
        _catalog_cache = _load_local_catalog()

    return _catalog_cache  # type: ignore[return-value]


def get_catalog(filter_backends: bool = True) -> dict[str, Any]:
    """Return cached catalog, optionally filtering out unavailable backends."""
    raw = _catalog_cache or _load_local_catalog()
    if not filter_backends:
        return raw

    llamacpp_ok = _is_llamacpp_available()
    filtered: dict[str, Any] = {}

    for tier, tier_data in raw.items():
        models = [
            m for m in tier_data.get("models", [])
            if m.get("backend") != "llamacpp" or llamacpp_ok
        ]
        filtered[tier] = {**tier_data, "models": models}

    return filtered
