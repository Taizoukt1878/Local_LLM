# -*- mode: python ; coding: utf-8 -*-
import sys
import platform
from pathlib import Path

venv = Path(sys.prefix)
python_version = f"python{sys.version_info.major}.{sys.version_info.minor}"

_system = platform.system()
if _system == "Windows":
    llama_lib_dir = venv / "Lib/site-packages/llama_cpp/lib"
    _lib_glob = "*.dll"
else:
    llama_lib_dir = venv / f"lib/{python_version}/site-packages/llama_cpp/lib"
    _lib_glob = "*.dylib" if _system == "Darwin" else "*.so"

llama_binaries = [
    (str(f), "llama_cpp/lib")
    for f in llama_lib_dir.glob(_lib_glob)
    if f.is_file()
]

a = Analysis(
    ["backend/main.py"],
    pathex=["backend"],
    binaries=llama_binaries,
    datas=[("models.json", ".")],
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="localmind-backend",
    debug=False,
    strip=False,
    upx=False,
    console=True,
    onefile=True,
)
