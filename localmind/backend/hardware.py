import platform
import shutil
import subprocess
from typing import Literal

import psutil

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


def _get_gpu_info_windows() -> dict:
    """
    Detect GPU on Windows using subprocesses with timeouts.
    GPUtil/nvidia-ml-python can block the asyncio event loop indefinitely;
    subprocess.run(..., timeout=5) avoids that.
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

    # Any GPU via wmic (AMD, Intel, etc.)
    try:
        result = subprocess.run(
            ["wmic", "path", "win32_VideoController", "get", "Name,AdapterRAM", "/format:csv"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            for line in result.stdout.strip().splitlines():
                line = line.strip()
                if not line or line.startswith("Node"):
                    continue
                parts = line.split(",")
                if len(parts) >= 3:
                    name = parts[-1].strip()
                    try:
                        vram_bytes = int(parts[1].strip())
                        vram_gb = round(vram_bytes / (1024 ** 3), 1)
                    except (ValueError, IndexError):
                        vram_gb = 0
                    if name:
                        return {"present": True, "name": name, "vram_gb": vram_gb}
    except Exception:
        pass

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


def _get_disk_space_gb(path: str = "/") -> float:
    usage = shutil.disk_usage(path)
    return round(usage.free / (1024**3), 1)


def _recommend_tier(ram_gb: float, gpu_present: bool) -> Tier:
    if ram_gb < 8 or not gpu_present:
        return "small"
    if ram_gb < 16:
        return "medium"
    return "large"


def get_hardware_profile() -> dict:
    ram_bytes = psutil.virtual_memory().total
    ram_gb = round(ram_bytes / (1024**3), 1)

    gpu = _get_gpu_info(ram_gb)
    disk_gb = _get_disk_space_gb()
    tier = _recommend_tier(ram_gb, gpu["present"])

    return {
        "ram_gb": ram_gb,
        "gpu": gpu,
        "disk_free_gb": disk_gb,
        "recommended_tier": tier,
    }
