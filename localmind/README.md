# LocalMind

A private, local AI desktop app built with Tauri v2, React, and a Python FastAPI sidecar.
All models run 100% on your device — no cloud, no subscriptions, no data leaving your computer.

---

## Architecture

```
localmind/
├── frontend/          # React + Vite + TailwindCSS
├── backend/           # Python FastAPI sidecar (runs on localhost:8765)
│   ├── main.py        # FastAPI app, routes, lifespan
│   ├── hardware.py    # Hardware detection (RAM, GPU, disk)
│   ├── installer.py   # Ollama install logic (macOS / Windows / Linux)
│   ├── ollama_backend.py
│   ├── llamacpp_backend.py
│   └── catalog.py
├── src-tauri/         # Tauri v2 Rust shell
│   ├── src/main.rs
│   ├── tauri.conf.json
│   ├── Cargo.toml
│   ├── build.rs
│   ├── icons/         # App icons (generate with `cargo tauri icon`)
│   └── binaries/      # Backend binary lives here after build_backend.py
├── models.json        # Model catalog (tiers: small / medium / large)
├── build_backend.py   # Bundles Python backend → standalone binary
└── preflight_check.py # Pre-build validation
```

---

## First Build on macOS Apple Silicon

Follow this exact sequence:

### Step 1 — Run the preflight check

```bash
python preflight_check.py
```

Fix anything marked ❌ before continuing. All checks must pass.

### Step 2 — Generate app icons

```bash
cargo tauri icon path/to/your-logo.png
```

Use a 1024×1024 PNG. This auto-generates all required sizes into `src-tauri/icons/`.

### Step 3 — Build the Python backend binary

```bash
pip install pyinstaller fastapi uvicorn httpx psutil pydantic
# Optional — needed for CPU-only model support:
pip install llama-cpp-python
python build_backend.py
```

This produces `src-tauri/binaries/localmind-backend-aarch64-apple-darwin`.

### Step 4 — Test in dev mode first

```bash
cargo tauri dev
```

Make sure the app opens, onboarding works, and chat functions correctly before doing a production build.

### Step 5 — Production build

```bash
cargo tauri build
```

Output is in `src-tauri/target/release/bundle/`:
- `macos/` → `.dmg` and `.app`
- `windows/` → `.exe` and `.msi`
- `linux/` → `.AppImage` and `.deb`

---

## Development (without building the full app)

Run the frontend and backend separately:

```bash
# Terminal 1 — Python backend
cd backend
pip install -r requirements.txt   # or install deps manually
python main.py

# Terminal 2 — Vite dev server
cd frontend
npm install
npm run dev
```

---

## Troubleshooting

### llama-cpp-python build failures

llama-cpp-python compiles native C++ extensions and can fail on certain setups.

```bash
# Reinstall with Metal support on Apple Silicon:
CMAKE_ARGS="-DLLAMA_METAL=on" pip install llama-cpp-python --force-reinstall --no-cache-dir

# If that fails, build without it (CPU backend will be skipped):
python build_backend.py   # it detects the missing package and warns you
```

The app works fine without llama-cpp-python — it just won't support `.gguf` CPU-only models.

### GPUtil not working on Apple Silicon

GPUtil uses NVIDIA APIs and doesn't work on Apple Silicon. This is handled automatically —
`hardware.py` detects `arm64` and uses `system_profiler` instead to detect the GPU.
You don't need to do anything. VRAM is estimated as half of total RAM (standard for Apple unified memory).

### Ollama permission dialog on macOS

When installing Ollama for the first time, the app needs to move `Ollama.app` to `/Applications`.
macOS will show a permission dialog — click **Allow**. This is a one-time setup.

If you click Deny by mistake, the install screen will show a **Try Again** button.

### "Application can't be opened" on macOS

If macOS blocks the app because it's from an unidentified developer:

1. Right-click the `.app` file in Finder
2. Select **Open** from the context menu
3. Click **Open** in the dialog that appears

This only needs to be done once. After that, the app opens normally.

To avoid this warning in production, sign and notarize the app with an Apple Developer certificate.

### Backend fails to start

If the chat shows "backend offline":
- Make sure `src-tauri/binaries/localmind-backend-aarch64-apple-darwin` exists
- In dev mode: start the backend manually with `cd backend && python main.py`
- Check port 8765 isn't already in use: `lsof -i :8765`
