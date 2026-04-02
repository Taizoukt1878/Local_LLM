# LocalMind

> Your private AI, running entirely on your computer.

LocalMind is a beginner-friendly desktop app for running local LLMs using [Ollama](https://ollama.com) and [llama.cpp](https://github.com/ggerganov/llama.cpp). No cloud, no subscriptions, no data leaving your machine.

---

## Architecture

```
Tauri 2.0 shell (Rust)
├── React + TypeScript frontend  (Vite, Tailwind, React Router)
└── Python FastAPI sidecar       (bundled as single binary via PyInstaller)
    ├── Ollama backend           (GPU — via Ollama REST API)
    └── llama.cpp backend        (CPU — via llama-cpp-python)
```

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| Rust | stable | `rustup toolchain install stable` |
| Python | ≥ 3.11 | With `pip` |
| Tauri CLI | v2 | `cargo install tauri-cli --version "^2"` |
| PyInstaller | latest | `pip install pyinstaller` |

---

## Development Setup

### 1 — Clone & install

```bash
git clone <repo-url> localmind
cd localmind
```

### 2 — Python backend

```bash
cd backend
python -m venv .venv

# macOS / Linux
source .venv/bin/activate

# Windows
.venv\Scripts\activate

pip install -r requirements.txt
```

Start the backend in dev mode (runs on port 8765):

```bash
python main.py
```

### 3 — Frontend

```bash
cd ../frontend
npm install
npm run dev   # Vite dev server on port 5173
```

### 4 — Tauri (shell)

In a third terminal, from the repo root:

```bash
cargo tauri dev
```

This opens the Tauri window pointing to `http://localhost:5173`. The backend must be running separately during development.

---

## Building for Production

### Step 1 — Build the Python backend binary

```bash
# From repo root, with your Python venv active:
python build_backend.py
```

This produces `src-tauri/binaries/localmind-backend-<triple>[.exe]`.

### Step 2 — Build the Tauri app

```bash
cargo tauri build
```

The final installer/app bundle is placed in `src-tauri/target/release/bundle/`.

---

## Platform-specific notes

### macOS

- Ollama is installed to `/Applications/Ollama.app` if not already present.
- The backend binary is code-signed by the Tauri bundler (configure your signing identity in `tauri.conf.json`).
- `aarch64-apple-darwin` (Apple Silicon) and `x86_64-apple-darwin` (Intel) are both supported.

### Windows

- Ollama installer is run silently with the `/S` flag.
- Antivirus software may flag the PyInstaller binary; consider code-signing with a certificate.
- Build target: `x86_64-pc-windows-msvc`.

### Linux

- Ollama is installed via the official shell script (`curl | sh`).
- The app bundles as a `.deb` (Debian/Ubuntu) and `.AppImage`.
- GPU support requires the Ollama service to have access to NVIDIA/AMD drivers.

---

## Project Structure

```
localmind/
├── src-tauri/              # Tauri shell (Rust)
│   ├── src/main.rs         # Sidecar spawn + window setup
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── binaries/           # PyInstaller output goes here (git-ignored)
├── frontend/               # React + TypeScript UI
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts          # Fetch / SSE helpers
│   │   ├── pages/
│   │   │   ├── Onboarding.tsx
│   │   │   ├── ModelPicker.tsx
│   │   │   └── Chat.tsx
│   │   └── components/
│   │       ├── ModelCard.tsx
│   │       └── ChatMessage.tsx
│   └── package.json
├── backend/                # Python FastAPI sidecar
│   ├── main.py
│   ├── hardware.py
│   ├── ollama_backend.py
│   ├── llamacpp_backend.py
│   ├── installer.py
│   ├── catalog.py
│   └── requirements.txt
├── models.json             # Curated model catalog
├── build_backend.py        # PyInstaller build script
└── README.md
```

---

## API Reference (backend on port 8765)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/system/info` | Hardware profile + recommended tier |
| `GET` | `/install/ollama` | SSE stream: install Ollama |
| `GET` | `/install/status` | Check if Ollama is installed & running |
| `GET` | `/catalog` | Full model catalog (filtered by available backends) |
| `GET` | `/models/installed` | List installed models (all backends) |
| `POST` | `/models/pull` | SSE stream: pull/download a model |
| `DELETE` | `/models/{name}` | Delete a model |
| `POST` | `/chat` | SSE stream: chat completion |

---

## Customising the Model Catalog

Edit `models.json` at the repo root. The structure is:

```json
{
  "small": {
    "label": "Human-readable tier name",
    "description": "...",
    "requirements": "...",
    "models": [
      {
        "id": "model-id-for-ollama-or-filename-for-gguf",
        "label": "Display name",
        "backend": "ollama | llamacpp",
        "size_gb": 2.3,
        "description": "...",
        "download_url": "https://... (llamacpp only)"
      }
    ]
  }
}
```

---

## Contributing

Pull requests are welcome. Please open an issue first for large changes.

---

## License

MIT
