#!/usr/bin/env python3
"""Parse every production Rust file without rewriting it or requiring a GUI SDK.

Unlike the isolated filesystem tests, this includes lib.rs, its Tauri command
declarations and native menus. This is a syntax check; cargo check/build must
still validate macros, types, dependencies and platform APIs on the target OS.
"""
from pathlib import Path
import os
import shutil
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parents[1]
    formatter = os.environ.get("RUSTFMT") or shutil.which("rustfmt")
    if not formatter:
        sys.exit("Rust syntax check needs rustfmt. Install it with: rustup component add rustfmt")
    files = sorted((root / "src-tauri" / "src").rglob("*.rs"))
    files.append(root / "src-tauri" / "build.rs")
    for path in files:
        result = subprocess.run(
            [formatter, "--edition", "2021", "--emit", "stdout", "--config", "skip_children=true", str(path)],
            stdout=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode:
            sys.exit(f"Rust syntax check failed: {path.relative_to(root)}")
    print(f"PASS: all {len(files)} production Rust files parse, including the native app entry point.")


if __name__ == "__main__":
    main()
