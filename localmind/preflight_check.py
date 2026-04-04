"""
Pre-build validation script for LocalMind.
Checks all prerequisites before running `cargo tauri build`.

Usage:
    python preflight_check.py

Exit codes:
    0 — all checks passed
    1 — one or more checks failed
"""
import importlib.util
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent

BOLD  = "\033[1m"
GREEN = "\033[92m"
RED   = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"

passed: list[str] = []
failed: list[tuple[str, str]] = []  # (check_name, fix_instruction)


def ok(label: str) -> None:
    print(f"  {GREEN}✅{RESET} {label}")
    passed.append(label)


def fail(label: str, fix: str) -> None:
    print(f"  {RED}❌{RESET} {label}")
    print(f"     {YELLOW}→ {fix}{RESET}")
    failed.append((label, fix))


def run(cmd: list[str]) -> tuple[int, str]:
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=10
        )
        return result.returncode, (result.stdout + result.stderr).strip()
    except FileNotFoundError:
        return 1, ""
    except subprocess.TimeoutExpired:
        return 1, "timed out"


# ── 1. Rust ──────────────────────────────────────────────────────────────────
print(f"\n{BOLD}Checking prerequisites...{RESET}\n")

code, out = run(["rustc", "--version"])
if code == 0:
    ok(f"Rust installed  ({out})")
else:
    fail(
        "Rust not found",
        "Install via: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
    )

# ── 2. Node.js ───────────────────────────────────────────────────────────────
code, out = run(["node", "--version"])
if code == 0:
    ok(f"Node.js installed  ({out})")
else:
    fail(
        "Node.js not found",
        "Install via https://nodejs.org or: brew install node",
    )

# ── 3. Python 3.10+ ──────────────────────────────────────────────────────────
major, minor = sys.version_info.major, sys.version_info.minor
if major >= 3 and minor >= 10:
    ok(f"Python {major}.{minor} installed  (3.10+ required)")
else:
    fail(
        f"Python {major}.{minor} is too old (need 3.10+)",
        "Install Python 3.10+ from https://python.org or via pyenv",
    )

# ── 4. PyInstaller ───────────────────────────────────────────────────────────
code, out = run([sys.executable, "-m", "PyInstaller", "--version"])
if code == 0:
    ok(f"PyInstaller installed  ({out.strip()})")
else:
    fail(
        "PyInstaller not found",
        f"Install via: {sys.executable} -m pip install pyinstaller",
    )

# ── 5. Xcode command line tools (macOS only) ─────────────────────────────────
if platform.system() == "Darwin":
    code, out = run(["xcode-select", "-p"])
    if code == 0:
        ok(f"Xcode CLT installed  ({out.strip()})")
    else:
        fail(
            "Xcode command line tools not found",
            "Install via: xcode-select --install",
        )
else:
    ok("Xcode CLT check skipped (not macOS)")

# ── 6. App icons ─────────────────────────────────────────────────────────────
icons_dir = ROOT / "src-tauri" / "icons"
if icons_dir.exists() and any(icons_dir.iterdir()):
    icon_count = len(list(icons_dir.iterdir()))
    ok(f"App icons found  ({icon_count} file(s) in src-tauri/icons/)")
else:
    fail(
        "App icons missing (src-tauri/icons/ is empty or doesn't exist)",
        "Generate icons via: cargo tauri icon path/to/your-logo.png  (1024×1024 PNG recommended)",
    )

# ── 7. Backend binary ────────────────────────────────────────────────────────
system  = platform.system()
machine = platform.machine().lower()
if machine in ("arm64", "aarch64"):
    arch = "aarch64"
elif machine in ("amd64", "x86_64"):
    arch = "x86_64"
else:
    arch = machine

if system == "Darwin":
    triple = f"{arch}-apple-darwin"
elif system == "Windows":
    triple = f"{arch}-pc-windows-msvc"
else:
    triple = f"{arch}-unknown-linux-gnu"

suffix = ".exe" if system == "Windows" else ""
binary_path = ROOT / "src-tauri" / "binaries" / f"localmind-backend-{triple}{suffix}"

if binary_path.exists():
    size_mb = round(binary_path.stat().st_size / (1024 ** 2), 1)
    ok(f"Backend binary found  ({binary_path.name}, {size_mb} MB)")
else:
    fail(
        f"Backend binary not found  (expected: src-tauri/binaries/{binary_path.name})",
        "Build it first: python build_backend.py",
    )

# ── Summary ───────────────────────────────────────────────────────────────────
print()
print("─" * 55)
if not failed:
    print(f"\n{GREEN}{BOLD}All checks passed! You're ready to build.{RESET}")
    print(f"\n  {BOLD}Next steps:{RESET}")
    print("    cargo tauri dev      ← test in dev mode first")
    print("    cargo tauri build    ← production build")
    print()
    sys.exit(0)
else:
    print(f"\n{RED}{BOLD}{len(failed)} check(s) failed:{RESET}\n")
    for name, fix in failed:
        print(f"  {RED}✗{RESET} {name}")
        print(f"    {YELLOW}Fix: {fix}{RESET}")
    print()
    sys.exit(1)
