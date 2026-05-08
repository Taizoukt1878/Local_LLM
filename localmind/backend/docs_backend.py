"""
docs_backend.py — Simple RAG pipeline for LocalMind "Talk to your Docs".

sentence_transformers is imported lazily on first use so the PyInstaller
sidecar binary can start even when the package is absent.
"""
import logging
import pickle
from datetime import datetime
from pathlib import Path

import numpy as np

import hardware

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

INDEXES_DIR = Path.home() / "localmind" / "indexes"
INDEXES_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Embedding model — lazy-loaded on first use, cached globally
# ---------------------------------------------------------------------------

_embedding_model = None
_availability: bool | None = None  # None = not yet checked


def is_available() -> bool:
    """Return True if sentence_transformers is importable (result is cached)."""
    global _availability
    if _availability is None:
        try:
            import sentence_transformers  # noqa: F401
            _availability = True
        except ImportError:
            _availability = False
    return _availability


def _get_embedding_model():
    """Load and cache the SentenceTransformer model. Raises ImportError if missing."""
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            logger.info("Loading embedding model (first time only, ~80MB)...")
            _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("Embedding model ready.")
        except ImportError as exc:
            raise ImportError(
                "sentence_transformers is not installed. "
                "Run: pip install sentence-transformers and restart the backend."
            ) from exc
    return _embedding_model


def _require_model():
    return _get_embedding_model()  # raises ImportError if not available

# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

# {doc_id: {"id", "name", "chunks", "embeddings", "pages", "size_kb", "indexed_at"}}
DOC_STORE: dict[str, dict] = {}


def _load_indexes_from_disk() -> None:
    for pkl_file in INDEXES_DIR.glob("*.pkl"):
        try:
            with pkl_file.open("rb") as f:
                doc = pickle.load(f)
            DOC_STORE[doc["id"]] = doc
            logger.info("Restored index: %s (%s)", doc["id"], doc["name"])
        except Exception as exc:
            logger.warning("Skipping corrupt index %s: %s", pkl_file.name, exc)


_load_indexes_from_disk()

# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap
    return chunks

# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def _parse_with_docling(file_path: str) -> tuple[str, int]:
    from docling.document_converter import DocumentConverter
    converter = DocumentConverter()
    result = converter.convert(file_path)
    text = result.document.export_to_markdown()
    try:
        page_count = len(result.document.pages)
    except Exception:
        page_count = max(1, len(text) // 3000)
    return text, page_count


def _parse_pdf_fallback(file_path: str) -> tuple[str, int]:
    from pypdf import PdfReader
    reader = PdfReader(file_path)
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n\n".join(pages), len(reader.pages)


def _parse_docx_fallback(file_path: str) -> tuple[str, int]:
    from docx import Document
    doc = Document(file_path)
    text = "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    return text, max(1, len(text) // 3000)


def _parse_txt(file_path: str) -> tuple[str, int]:
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    return text, max(1, len(text) // 3000)


def _parse_file(file_path: str) -> tuple[str, int]:
    ext = Path(file_path).suffix.lower()

    try:
        return _parse_with_docling(file_path)
    except Exception as exc:
        logger.warning("Docling failed for %s: %s — using fallback", file_path, exc)

    try:
        if ext == ".pdf":
            return _parse_pdf_fallback(file_path)
        if ext == ".docx":
            return _parse_docx_fallback(file_path)
        if ext == ".txt":
            return _parse_txt(file_path)
    except Exception as exc:
        raise ValueError(
            "Could not read this file. Make sure it is not password protected or corrupted."
        ) from exc

    raise ValueError(
        "Could not read this file. Make sure it is not password protected or corrupted."
    )

# ---------------------------------------------------------------------------
# Cosine similarity & retrieval
# ---------------------------------------------------------------------------


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def retrieve(doc_id: str, question: str, top_k: int = 3) -> str:
    model = _require_model()
    doc = DOC_STORE[doc_id]
    question_embedding = model.encode([question])[0]
    similarities = [
        _cosine_similarity(question_embedding, emb)
        for emb in doc["embeddings"]
    ]
    top_indices = np.argsort(similarities)[-top_k:][::-1]
    top_chunks = [doc["chunks"][i] for i in top_indices]
    return "\n\n---\n\n".join(top_chunks)

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_and_index(file_path: str, doc_id: str, name: str) -> dict:
    model = _require_model()
    text, pages = _parse_file(file_path)
    chunks = chunk_text(text)
    embeddings = model.encode(chunks)
    size_kb = int(Path(file_path).stat().st_size / 1024)

    doc = {
        "id": doc_id,
        "name": name,
        "chunks": chunks,
        "embeddings": embeddings,
        "pages": pages,
        "size_kb": size_kb,
        "indexed_at": datetime.utcnow().isoformat(),
    }

    DOC_STORE[doc_id] = doc

    pkl_path = INDEXES_DIR / f"{doc_id}.pkl"
    with pkl_path.open("wb") as f:
        pickle.dump(doc, f)

    return _doc_metadata(doc)


def query(doc_id: str, question: str, top_k: int = 3) -> str:
    if doc_id not in DOC_STORE:
        raise KeyError(f"Document {doc_id} not found")
    return retrieve(doc_id, question, top_k)


def list_docs() -> list:
    return [_doc_metadata(doc) for doc in DOC_STORE.values()]


def delete_doc(doc_id: str) -> bool:
    if doc_id not in DOC_STORE:
        return False
    del DOC_STORE[doc_id]
    pkl_path = INDEXES_DIR / f"{doc_id}.pkl"
    if pkl_path.exists():
        pkl_path.unlink()
    return True


def check_compatibility() -> dict:
    profile = hardware.get_hardware_profile()
    ram_gb: float = profile["ram_gb"]
    gpu_present: bool = profile["gpu"]["present"]

    if ram_gb < 8:
        return {
            "supported": False,
            "level": "unsupported",
            "message": "Requires at least 8GB RAM",
        }
    if gpu_present:
        return {
            "supported": True,
            "level": "full",
            "message": "Document parsing fully supported",
        }
    return {
        "supported": True,
        "level": "limited",
        "message": "Supported for small docs under 20 pages",
    }


def _doc_metadata(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "name": doc["name"],
        "pages": doc["pages"],
        "size_kb": doc["size_kb"],
        "indexed_at": doc["indexed_at"],
    }
