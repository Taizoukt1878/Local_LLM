import shutil
from typing import Literal

import psutil

Tier = Literal["small", "medium", "large"]


def _get_gpu_info() -> dict:
    """Try to get GPU info via GPUtil; return empty dict if unavailable."""
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

    gpu = _get_gpu_info()
    disk_gb = _get_disk_space_gb()
    tier = _recommend_tier(ram_gb, gpu["present"])

    return {
        "ram_gb": ram_gb,
        "gpu": gpu,
        "disk_free_gb": disk_gb,
        "recommended_tier": tier,
    }
