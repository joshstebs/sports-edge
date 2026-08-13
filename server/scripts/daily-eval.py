#!/usr/bin/env python3
"""SportsEdge daily prediction evaluation (6 AM cron).

Runs the evaluator (scripts/evaluate.ts via tsx) and prints the digest ONLY
when there were picks to grade. Empty stdout = silent tick (watchdog pattern).
Uses absolute paths so it works in the Hermes cron environment (no bash/PATH
guarantees on Windows)."""

import glob
import os
import shutil
import subprocess
import sys

SERVER = r"C:\Users\jsteb\sports-edge\server"


def find_node():
    p = shutil.which("node")
    if p:
        return p
    for cand in [
        r"C:\Program Files\nodejs\node.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\hermes\node\node.exe"),
        r"C:\nvm4w\nodejs\node.exe",
    ]:
        if os.path.exists(cand):
            return cand
    return None


def find_tsx():
    hits = sorted(
        glob.glob(
            os.path.join(SERVER, "node_modules", ".pnpm", "tsx@*", "node_modules", "tsx", "dist", "cli.mjs")
        )
    )
    if hits:
        return hits[-1]
    fallback = os.path.join(SERVER, "node_modules", "tsx", "dist", "cli.mjs")
    return fallback if os.path.exists(fallback) else None


def main():
    node = find_node()
    tsx = find_tsx()
    if not node:
        print("ERROR: node not found on PATH or common locations")
        return 1
    if not tsx:
        print("ERROR: tsx not found in server/node_modules")
        return 1

    try:
        out = subprocess.run(
            [node, tsx, "scripts/evaluate.ts"],
            cwd=SERVER,
            capture_output=True,
            text=True,
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        print("ERROR: evaluation timed out")
        return 1

    text = (out.stdout or "") + (out.stderr or "")
    if "Nothing to evaluate" in text:
        return 0  # silent tick
    print(text)
    return 0 if out.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
