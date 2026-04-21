import json
import logging
import sys
from pathlib import Path
from typing import Any

# In a PyInstaller bundle, data files land in sys._MEIPASS.
# In normal execution they sit two levels up from this file (localmind/models.json).
if getattr(sys, "frozen", False):
    LOCAL_CATALOG_PATH = Path(sys._MEIPASS) / "models.json"  # type: ignore[attr-defined]
else:
    LOCAL_CATALOG_PATH = Path(__file__).parent.parent / "models.json"

logger = logging.getLogger(__name__)

_catalog_cache: dict[str, Any] | None = None


def _is_llamacpp_available() -> bool:
    try:
        import llama_cpp  # noqa: F401
        return True
    except Exception:
        return False


def _load_local_catalog() -> dict[str, Any]:
    try:
        with LOCAL_CATALOG_PATH.open() as f:
            return json.load(f)
    except Exception:
        logger.warning("Local catalog not found at %s — returning empty catalog.", LOCAL_CATALOG_PATH)
        return {}


async def fetch_catalog() -> dict[str, Any]:
    """Load catalog from the bundled local file."""
    global _catalog_cache
    _catalog_cache = _load_local_catalog()
    logger.info("Loaded local catalog from %s.", LOCAL_CATALOG_PATH)
    return _catalog_cache


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
