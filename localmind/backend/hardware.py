import logging
import platform
import shutil
import subprocess
from typing import Literal

import psutil

logger = logging.getLogger(__name__)

Tier = Literal["small", "medium", "large"]


def _get_gpu_info_apple_silicon(ram_gb: float) -> dict:
    """
    On Apple Silicon, GPU is always present (unified memory architecture).
    Try to confirm via system_profiler; fall back to estimating VRAM as half of RAM.
    """
    try:
        out = subprocess.check_output(
            ["system_profiler", "SPDisplaysDataType"],
            timeout=5,
            stderr=subprocess.DEVNULL,
        ).decode("utf-8", errors="ignore")

        # Look for Apple GPU name (e.g. "Apple M2 Pro")
        gpu_name = None
        for line in out.splitlines():
            line = line.strip()
            if "Chipset Model" in line or "Apple M" in line:
                gpu_name = line.split(":", 1)[-1].strip()
                break

        # Estimate VRAM: Apple Silicon shares memory; half of RAM is a reasonable floor
        vram_gb = round(ram_gb / 2, 1)

        return {
            "present": True,
            "name": gpu_name or "Apple Silicon GPU",
            "vram_gb": vram_gb,
        }
    except Exception:
        # Absolute fallback — we know M-series always has a GPU
        return {
            "present": True,
            "name": "Apple Silicon GPU",
            "vram_gb": round(ram_gb / 2, 1),
        }


def _get_gpu_info_linux() -> dict:
    """
    Detect GPU on Linux using subprocesses so that a crash in a GPU tool
    (e.g. missing nvidia-ml.so) cannot segfault the backend process.
    """
    # NVIDIA via nvidia-smi
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = [p.strip() for p in result.stdout.strip().split("\n")[0].split(",")]
            if len(parts) >= 2:
                try:
                    vram_gb = round(float(parts[1]) / 1024, 1)
                except ValueError:
                    vram_gb = 0
                return {"present": True, "name": parts[0], "vram_gb": vram_gb}
    except Exception:
        pass

    # Any GPU visible via lspci (AMD, Intel, etc.)
    try:
        result = subprocess.run(["lspci"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                lower = line.lower()
                if any(kw in lower for kw in ["vga compatible", "3d controller", "display controller"]):
                    parts = line.split(":", 2)
                    name = parts[-1].strip() if len(parts) >= 3 else "Unknown GPU"
                    return {"present": True, "name": name, "vram_gb": 0}
    except Exception:
        pass

    return {"present": False, "name": None, "vram_gb": 0}


def _parse_wmic_video_controller(stdout: str) -> dict | None:
    """
    Parse the output of `wmic path win32_VideoController get name,AdapterRAM`.

    The default (non-csv) wmic format is fixed-width with a header row:
        AdapterRAM   Name
        4293918720   NVIDIA GeForce RTX 3070
        ...

    Column order isn't guaranteed (AdapterRAM may come before or after Name),
    so we use the header row to find each field's column span.
    """
    lines = [ln for ln in stdout.splitlines() if ln.strip()]
    if len(lines) < 2:
        return None

    header = lines[0]
    header_lower = header.lower()
    name_idx = header_lower.find("name")
    ram_idx = header_lower.find("adapterram")
    if name_idx < 0 or ram_idx < 0:
        return None

    # Determine column boundaries from the two fields' positions.
    if ram_idx < name_idx:
        ram_slice = slice(ram_idx, name_idx)
        name_slice = slice(name_idx, None)
    else:
        name_slice = slice(name_idx, ram_idx)
        ram_slice = slice(ram_idx, None)

    for row in lines[1:]:
        # Pad short rows so slicing doesn't blow up.
        if len(row) < max(name_idx, ram_idx):
            continue
        name = row[name_slice].strip()
        ram_str = row[ram_slice].strip()
        if not name:
            continue
        vram_gb = 0.0
        try:
            vram_bytes = int(ram_str)
            vram_gb = round(vram_bytes / (1024 ** 3), 1)
        except (ValueError, TypeError):
            vram_gb = 0.0
        return {"present": True, "name": name, "vram_gb": vram_gb}

    return None


def _get_gpu_info_windows_via_gputil() -> dict | None:
    try:
        import GPUtil  # type: ignore

        gpus = GPUtil.getGPUs()
        if gpus:
            gpu = gpus[0]
            return {
                "present": True,
                "name": gpu.name,
                "vram_gb": round(gpu.memoryTotal / 1024, 1),
            }
    except Exception as exc:
        logger.debug("GPUtil fallback failed: %s", exc)
    return None


def _get_gpu_info_windows() -> dict:
    """
    Detect GPU on Windows. Try wmic first (works for any vendor), then fall
    back to GPUtil. All probes run in subprocesses with short timeouts so
    they cannot stall the asyncio event loop.
    """
    # Primary: wmic (covers NVIDIA, AMD, Intel, etc.)
    try:
        result = subprocess.run(
            ["wmic", "path", "win32_VideoController", "get", "name,AdapterRAM"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            parsed = _parse_wmic_video_controller(result.stdout)
            if parsed is not None:
                return parsed
    except Exception as exc:
        logger.debug("wmic GPU probe failed: %s", exc)

    # Fallback: GPUtil (NVIDIA-only, but useful when wmic is unavailable)
    fallback = _get_gpu_info_windows_via_gputil()
    if fallback is not None:
        return fallback

    return {"present": False, "name": None, "vram_gb": 0}


def _get_gpu_info(ram_gb: float) -> dict:
    """
    Detect GPU info.
    - macOS Apple Silicon: system_profiler
    - Linux: nvidia-smi / lspci subprocesses (avoids GPUtil segfaults)
    - Windows: nvidia-smi / wmic subprocesses (avoids blocking the event loop)
    - Other: GPUtil fallback
    """
    system = platform.system()

    if system == "Darwin" and platform.machine() == "arm64":
        return _get_gpu_info_apple_silicon(ram_gb)

    if system == "Linux":
        return _get_gpu_info_linux()

    if system == "Windows":
        return _get_gpu_info_windows()

    try:
        import GPUtil  # type: ignore

        gpus = GPUtil.getGPUs()
        if gpus:
            gpu = gpus[0]
            return {
                "present": True,
                "name": gpu.name,
                "vram_gb": round(gpu.memoryTotal / 1024, 1),
            }
    except Exception:
        pass

    return {"present": False, "name": None, "vram_gb": 0}


def _get_disk_space_gb(path: str | None = None) -> float:
    if path is None:
        path = "C:\\" if platform.system() == "Windows" else "/"
    usage = shutil.disk_usage(path)
    return round(usage.free / (1024**3), 1)


def _recommend_tier(ram_gb: float, gpu_present: bool) -> Tier:
    if ram_gb < 8 or not gpu_present:
        return "small"
    if ram_gb < 16:
        return "medium"
    return "large"


# Safe defaults — used when probing fails so the frontend always gets a usable
# response and never gets stuck waiting for "perfect" data.
_DEFAULT_PROFILE: dict = {
    "ram_gb": 8,
    "gpu_present": False,
    "gpu_name": None,
    "vram_gb": 0,
    "disk_free_gb": 50,
    "recommended_tier": "small",
    "platform": platform.system() or "Unknown",
}


def default_profile() -> dict:
    """Return a copy of the safe-default profile."""
    profile = dict(_DEFAULT_PROFILE)
    profile["platform"] = platform.system() or "Unknown"
    return profile


def get_hardware_profile() -> dict:
    """
    Return a flat hardware profile. This function NEVER raises — if any probe
    fails, the corresponding field falls back to a safe default. The frontend
    relies on this guarantee to advance past the hardware-scan step.
    """
    profile = dict(_DEFAULT_PROFILE)
    profile["platform"] = platform.system() or "Unknown"

    try:
        ram_bytes = psutil.virtual_memory().total
        profile["ram_gb"] = round(ram_bytes / (1024**3), 1)
    except Exception:
        logger.exception("RAM probe failed; using default")

    try:
        gpu = _get_gpu_info(float(profile["ram_gb"]))
        profile["gpu_present"] = bool(gpu.get("present", False))
        profile["gpu_name"] = gpu.get("name") or None
        profile["vram_gb"] = gpu.get("vram_gb", 0) or 0
    except Exception:
        logger.exception("GPU probe failed; using defaults")

    try:
        profile["disk_free_gb"] = _get_disk_space_gb()
    except Exception:
        logger.exception("Disk probe failed; using default")

    try:
        profile["recommended_tier"] = _recommend_tier(
            float(profile["ram_gb"]), bool(profile["gpu_present"])
        )
    except Exception:
        logger.exception("Tier recommendation failed; using default")

    return profile
