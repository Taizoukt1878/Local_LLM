"""
Build script: bundles the FastAPI backend into a standalone binary via PyInstaller.
Output: src-tauri/binaries/localmind-backend-<target-triple>[.exe]

Usage:
    python build_backend.py
"""
import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
BACKEND_DIR = ROOT / "backend"
BINARIES_DIR = ROOT / "src-tauri" / "binaries"


def target_triple() -> str:
    system = platform.system()
    machine = platform.machine().lower()

    # Normalise arm64 → aarch64
    if machine in ("arm64", "aarch64"):
        arch = "aarch64"
    elif machine in ("amd64", "x86_64"):
        arch = "x86_64"
    else:
        arch = machine

    if system == "Darwin":
        return f"{arch}-apple-darwin"
    if system == "Windows":
        return f"{arch}-pc-windows-msvc"
    # Linux
    return f"{arch}-unknown-linux-gnu"


def main() -> None:
    BINARIES_DIR.mkdir(parents=True, exist_ok=True)

    triple = target_triple()
    suffix = ".exe" if platform.system() == "Windows" else ""
    binary_name = f"localmind-backend-{triple}{suffix}"

    print(f"Target triple : {triple}")
    print(f"Binary name   : {binary_name}")
    print(f"Output dir    : {BINARIES_DIR}")

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--onefile",
        "--name",
        binary_name,
        "--distpath",
        str(BINARIES_DIR),
        "--workpath",
        str(ROOT / "build" / "pyinstaller-work"),
        "--specpath",
        str(ROOT / "build"),
        "--add-data",
        f"{ROOT / 'models.json'}{':' if platform.system() != 'Windows' else ';'}.",
        # Hidden imports needed by FastAPI / uvicorn
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols",
        "--hidden-import", "uvicorn.protocols.http",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan",
        "--hidden-import", "uvicorn.lifespan.on",
        "--hidden-import", "fastapi",
        "--hidden-import", "pydantic",
        "--hidden-import", "GPUtil",
        "--hidden-import", "psutil",
        str(BACKEND_DIR / "main.py"),
    ]

    print("\nRunning PyInstaller...\n")
    result = subprocess.run(cmd, cwd=str(BACKEND_DIR))
    if result.returncode != 0:
        print("\nBuild FAILED.")
        sys.exit(1)

    output = BINARIES_DIR / binary_name
    if output.exists():
        print(f"\nBuild succeeded: {output}")
    else:
        print("\nBuild finished but output binary not found — check PyInstaller output above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
