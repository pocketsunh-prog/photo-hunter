#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate photo-hunter level JSON files (both the web and Android apps consume these).

Usage:
    py tools/validate_levels.py                 # validate every shared/levels/*.json
    py tools/validate_levels.py path/to.json    # validate one file

Checks: schema shape, 10 objects, unique ids/names, normalised bboxes in range,
minimum tap size, bbox overlap sanity, Traditional-Chinese text presence.
Exit code 0 = OK, 1 = problems found.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEVELS_DIR = ROOT / "shared" / "levels"

REQUIRED_TOP = [
    "id",
    "slug",
    "collection",
    "title",
    "subtitle",
    "era",
    "image",
    "imageWidth",
    "imageHeight",
    "objects",
]
REQUIRED_OBJ = ["id", "name", "nameEn", "reason", "hint", "bbox", "confidence"]
OBJECT_COUNT = 10
MIN_SIZE = 0.008  # a bbox narrower/shorter than 0.8% of the image is untappable
MAX_SIZE = 0.60   # a bbox covering most of the image is not a specific object


def _is_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def validate(path: Path) -> list[str]:
    errs: list[str] = []
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return [f"{path.name}: file not found"]
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return [f"{path.name}: invalid JSON ({exc})"]

    for key in REQUIRED_TOP:
        if key not in data:
            errs.append(f"{path.name}: missing top-level key '{key}'")
    if errs:
        return errs

    if not isinstance(data["id"], int) or not 1 <= data["id"] <= 99:
        errs.append(f"{path.name}: 'id' must be an int 1..99")
    if not _is_cjk(str(data.get("collection", ""))):
        errs.append(f"{path.name}: 'collection' should be a Traditional Chinese volume name")
    if not _is_cjk(data["title"]):
        errs.append(f"{path.name}: 'title' should contain Traditional Chinese text")

    objects = data["objects"]
    if not isinstance(objects, list):
        return errs + [f"{path.name}: 'objects' must be a list"]
    if len(objects) != OBJECT_COUNT:
        errs.append(f"{path.name}: expected exactly {OBJECT_COUNT} objects, found {len(objects)}")

    seen_ids, seen_names, boxes = set(), set(), []
    for idx, obj in enumerate(objects):
        tag = f"{path.name}: objects[{idx}]"
        if not isinstance(obj, dict):
            errs.append(f"{tag} is not an object")
            continue
        for key in REQUIRED_OBJ:
            if key not in obj:
                errs.append(f"{tag} missing '{key}'")
        if errs and any(k not in obj for k in REQUIRED_OBJ):
            continue

        if obj["id"] in seen_ids:
            errs.append(f"{tag} duplicate id {obj['id']}")
        seen_ids.add(obj["id"])
        if obj["id"] != idx + 1:
            errs.append(f"{tag} id should be {idx + 1}")

        name = str(obj["name"]).strip()
        if not _is_cjk(name):
            errs.append(f"{tag} 'name' must be Traditional Chinese, got {name!r}")
        if name in seen_names:
            errs.append(f"{tag} duplicate object name {name!r}")
        seen_names.add(name)

        if not _is_cjk(str(obj["hint"])):
            errs.append(f"{tag} 'hint' must be Traditional Chinese text")
        if name and name in str(obj["hint"]):
            errs.append(f"{tag} 'hint' leaks the answer name {name!r}")
        if obj["confidence"] not in ("high", "medium", "low"):
            errs.append(f"{tag} 'confidence' must be high|medium|low")

        bbox = obj["bbox"]
        if not (isinstance(bbox, list) and len(bbox) == 4 and all(isinstance(v, (int, float)) for v in bbox)):
            errs.append(f"{tag} 'bbox' must be [x, y, w, h] numbers")
            continue
        x, y, w, h = (float(v) for v in bbox)
        if not all(0.0 <= v <= 1.0 for v in (x, y, w, h)):
            errs.append(f"{tag} bbox values must be normalised 0..1, got {bbox}")
            continue
        if x + w > 1.0001 or y + h > 1.0001:
            errs.append(f"{tag} bbox runs past the image edge: {bbox}")
        if w < MIN_SIZE or h < MIN_SIZE:
            errs.append(f"{tag} bbox too small to tap: {bbox}")
        if w > MAX_SIZE or h > MAX_SIZE:
            errs.append(f"{tag} bbox too large / not specific: {bbox}")
        if w * h < 0.0004:
            errs.append(f"{tag} bbox area under 0.04% of the image: {bbox}")
        boxes.append((obj["id"], x, y, w, h))

    # heavy overlap between two targets makes the wrong object get credited
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            _, ax, ay, aw, ah = boxes[i]
            _, bx, by, bw, bh = boxes[j]
            ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
            iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
            inter = ix * iy
            if inter <= 0:
                continue
            smaller = min(aw * ah, bw * bh)
            if smaller > 0 and inter / smaller > 0.55:
                errs.append(
                    f"{path.name}: objects {boxes[i][0]} and {boxes[j][0]} overlap "
                    f"{inter / smaller:.0%} - separate them"
                )

    for field in ("image",):
        if not str(data[field]).strip():
            errs.append(f"{path.name}: '{field}' is empty")
    return errs


def main(argv: list[str]) -> int:
    targets = [Path(a) for a in argv[1:]] or sorted(LEVELS_DIR.glob("level-*.json"))
    if not targets:
        print(f"No level files found under {LEVELS_DIR}")
        return 1
    all_errs: list[str] = []
    for path in targets:
        errs = validate(path)
        all_errs.extend(errs)
        status = "OK  " if not errs else "FAIL"
        print(f"[{status}] {path.name}")
        for e in errs:
            print(f"        - {e}")
    if all_errs:
        print(f"\n{len(all_errs)} problem(s) across {len(targets)} file(s).")
        return 1
    print(f"\nAll {len(targets)} level file(s) valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
