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


def _get_gpu_info(ram_gb: float) -> dict:
    """
    Detect GPU info.
    - On macOS Apple Silicon: GPUtil doesn't work; use system_profiler instead.
    - On other platforms: try GPUtil, fall back to no GPU.
    """
    is_apple_silicon = (
        platform.system() == "Darwin"
        and platform.machine() == "arm64"
    )

    if is_apple_silicon:
        return _get_gpu_info_apple_silicon(ram_gb)

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
