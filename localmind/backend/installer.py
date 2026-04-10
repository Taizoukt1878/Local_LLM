import asyncio
import os
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import AsyncGenerator

import httpx

OLLAMA_WINDOWS_URL = "https://ollama.com/download/OllamaSetup.exe"
OLLAMA_MACOS_URL = "https://ollama.com/download/Ollama-darwin.zip"
OLLAMA_LINUX_INSTALL_SCRIPT = "https://ollama.com/install.sh"


def is_ollama_installed() -> bool:
    """Return True if the ollama binary is available on PATH or common locations."""
    if shutil.which("ollama"):
        return True
    common = [
        Path("/usr/local/bin/ollama"),
        Path("/usr/bin/ollama"),
        Path.home() / ".local" / "bin" / "ollama",
        Path("C:/Program Files/Ollama/ollama.exe"),
    ]
    return any(p.exists() for p in common)


def start_ollama_serve() -> None:
    """Start ollama serve as a detached background process (ignore if already running)."""
    try:
        subprocess.Popen(
            ["ollama", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception:
        pass  # already running or not installed — caller handles this


async def _download_file(url: str, dest: Path) -> AsyncGenerator[dict, None]:
    async with httpx.AsyncClient(follow_redirects=True, timeout=300) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            downloaded = 0
            with dest.open("wb") as fh:
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    fh.write(chunk)
                    downloaded += len(chunk)
                    pct = int(downloaded * 100 / total) if total else 0
                    yield {"stage": "downloading", "percent": pct}


async def install_ollama(sudo_password: str | None = None) -> AsyncGenerator[dict, None]:
    """
    Generator that yields progress dicts and installs Ollama for the current platform.
    Yields: {"stage": str, "percent": int, "message": str}
    Final event: {"done": True}
    Error event: {"stage": "error", "message": str, "retryable": bool}

    sudo_password: optional administrator password for Linux installs.
    """
    system = platform.system()

    yield {"stage": "starting", "percent": 0, "message": "Preparing to install Ollama..."}

    if system == "Linux":
        yield {"stage": "downloading", "percent": 10, "message": "Downloading Ollama install script..."}

        # Download install script to a temp file so we can feed it to sudo without a TTY
        tmp_path: str | None = None
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
                resp = await client.get(OLLAMA_LINUX_INSTALL_SCRIPT)
                resp.raise_for_status()
                with tempfile.NamedTemporaryFile(mode="wb", suffix=".sh", delete=False) as f:
                    f.write(resp.content)
                    tmp_path = f.name
        except Exception as exc:
            yield {
                "stage": "error",
                "percent": 0,
                "message": f"Failed to download installer: {exc}",
                "retryable": True,
            }
            return

        yield {"stage": "installing", "percent": 30, "message": "Installing Ollama (this may take a moment)..."}

        try:
            if sudo_password:
                # sudo -S reads the password from stdin; the script path is a separate arg
                # so stdin is fully consumed by sudo before sh starts.
                proc = await asyncio.create_subprocess_exec(
                    "sudo", "-S", "sh", tmp_path,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
                assert proc.stdin is not None
                proc.stdin.write((sudo_password + "\n").encode())
                await proc.stdin.drain()
                proc.stdin.close()
            else:
                proc = await asyncio.create_subprocess_exec(
                    "sh", tmp_path,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )

            assert proc.stdout is not None
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                decoded = line.decode(errors="ignore").strip()
                if decoded:
                    yield {"stage": "installing", "percent": 50, "message": decoded}

            await proc.wait()
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        if proc.returncode != 0:
            if sudo_password:
                msg = "Installation failed. Please check your password and try again."
            else:
                msg = (
                    "Installation failed. "
                    "Ollama requires administrator privileges — "
                    "please enter your password and try again."
                )
            yield {
                "stage": "error",
                "percent": 0,
                "message": msg,
                "retryable": True,
                "needs_sudo": not bool(sudo_password),
            }
            return

    elif system == "Darwin":
        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = Path(tmpdir) / "Ollama-darwin.zip"

            yield {
                "stage": "permission_prompt",
                "percent": 0,
                "message": (
                    "We'll ask for your permission to install Ollama — "
                    "this is a one-time setup. Click Allow when prompted."
                ),
            }

            yield {"stage": "downloading", "percent": 0, "message": "Downloading Ollama for macOS..."}
            async for progress in _download_file(OLLAMA_MACOS_URL, zip_path):
                yield {**progress, "message": f"Downloading... {progress['percent']}%"}

            yield {"stage": "installing", "percent": 90, "message": "Installing Ollama..."}
            proc = await asyncio.create_subprocess_exec(
                "unzip", "-o", str(zip_path), "-d", tmpdir,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()

            app_src = Path(tmpdir) / "Ollama.app"
            app_dst = Path("/Applications/Ollama.app")

            if not app_src.exists():
                yield {
                    "stage": "error",
                    "percent": 0,
                    "message": "Download appears corrupted. Please try again.",
                    "retryable": True,
                }
                return

            try:
                if app_dst.exists():
                    shutil.rmtree(app_dst)
                shutil.move(str(app_src), str(app_dst))
            except PermissionError:
                yield {
                    "stage": "error",
                    "percent": 0,
                    "message": (
                        "We need permission to install Ollama. "
                        "Please try again and click Allow when macOS asks."
                    ),
                    "retryable": True,
                }
                return

    elif system == "Windows":
        with tempfile.TemporaryDirectory() as tmpdir:
            exe_path = Path(tmpdir) / "OllamaSetup.exe"

            yield {"stage": "downloading", "percent": 0, "message": "Downloading Ollama for Windows..."}
            async for progress in _download_file(OLLAMA_WINDOWS_URL, exe_path):
                yield {**progress, "message": f"Downloading... {progress['percent']}%"}

            yield {"stage": "installing", "percent": 90, "message": "Running installer..."}
            proc = await asyncio.create_subprocess_exec(
                str(exe_path), "/S",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()

            if proc.returncode != 0:
                yield {
                    "stage": "error",
                    "percent": 0,
                    "message": (
                        "We need permission to install Ollama. "
                        "Please try again and click Allow when Windows asks."
                    ),
                    "retryable": True,
                }
                return
    else:
        yield {
            "stage": "error",
            "percent": 0,
            "message": f"Unsupported platform: {system}",
            "retryable": False,
        }
        return

    yield {"stage": "done", "percent": 100, "message": "Ollama installed successfully!"}
    yield {"done": True}
