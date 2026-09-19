#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mirror the authored level JSON into both apps.

  shared/levels/*.json   (source of truth, hand/agent authored)
    -> web/data/levels/                            (seeded into MySQL on boot)
    -> android/app/src/main/assets/levels/         (seeded into SQLite on first run)

Run after changing any chapter, then restart the API / rebuild the APK.

Usage: py tools/sync_levels.py
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "shared" / "levels"
IMAGES_DIR = ROOT / "shared" / "assets" / "images"
TARGETS = [
    ROOT / "web" / "data" / "levels",
    ROOT / "android" / "app" / "src" / "main" / "assets" / "levels",
]


def main() -> int:
    files = sorted(SRC.glob("level-*.json"))
    if not files:
        print(f"no level JSON found in {SRC}")
        return 1

    ids = []
    missing_assets: list[str] = []
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        ids.append(data["id"])
        if len(data["objects"]) != 10:
            print(f"warning: {path.name} has {len(data['objects'])} objects, expected 10")
        # Publishing a chapter whose photo was never built would ship a broken
        # level, which is exactly what happens while a volume is still being
        # collected - so refuse loudly instead.
        if not (IMAGES_DIR / data["image"]).is_file():
            missing_assets.append(f"{path.name} -> {data['image']}")
    if sorted(ids) != list(range(1, len(ids) + 1)):
        print(f"warning: chapter ids are not 1..{len(ids)}: {sorted(ids)}")
    if missing_assets:
        print("ERROR: these chapters have no built image asset yet:")
        for entry in missing_assets:
            print(f"  - {entry}")
        print("Run:  py tools/prepare_assets.py")
        print("If a volume is still being collected, its photos are simply not ready to publish yet.")
        return 1

    for target in TARGETS:
        target.mkdir(parents=True, exist_ok=True)
        for stale in target.glob("level-*.json"):
            stale.unlink()
        for path in files:
            shutil.copy2(path, target / path.name)
        print(f"{len(files)} chapters -> {target.relative_to(ROOT)}")

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
