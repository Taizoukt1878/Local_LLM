# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

venv = Path("/Users/anouartaizoukt/Documents/local_LLM/.localllm")
llama_lib_dir = venv / "lib/python3.10/site-packages/llama_cpp/lib"

llama_binaries = [
    (str(f), "llama_cpp/lib")
    for f in llama_lib_dir.glob("*.dylib")
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
