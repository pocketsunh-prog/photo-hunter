#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the shipped image assets for both apps from the source photos.

Creates, for every chapter:
  shared/assets/images/chapter-XX.jpg        1440x1920 game image (~350 KB)
  shared/assets/images/chapter-XX-thumb.jpg   360x480  level-select thumbnail

and mirrors them into:
  web/public/assets/images/
  android/app/src/main/assets/images/

Sources are grouped in volumes; inside a volume the photos are ordered by the
number in their file name, so the un-suffixed file is the first chapter of that
volume and "… (1).png", "… (2).png" … follow:

  images/    -> chapters  1..10   (卷一・古畫尋穿越: ancient scenes, modern objects)
  images2/   -> chapters 11..20   (卷二・今世覓古物: modern photos, ancient artefacts)

Source photos are 1728x2304 (3:4), so the resize is a clean uniform scale and the
normalised bboxes in shared/levels/*.json stay valid. A photo that is missing
from a volume is reported and skipped, so the tool is usable while a volume is
still being collected.

Usage: py tools/prepare_assets.py [--strict]
       --strict  fail (exit 1) if any source photo is missing
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
FULL_DIR = ROOT / "shared" / "assets" / "images"
MIRRORS = [
    ROOT / "web" / "public" / "assets" / "images",
    ROOT / "android" / "app" / "src" / "main" / "assets" / "images",
]

# (source folder, first chapter number of that volume)
VOLUMES = [
    ("images", 1),
    ("images2", 11),
    ("images3", 21),
    ("images4", 31),
    ("images5", 41),
]

# Pinned chapter -> photo mapping. The annotations in shared/levels/*.json are
# written against these photos, so the mapping must never shift: a later photo
# added to a volume is appended to the next free chapter of that volume instead
# of re-ordering the existing ones.
PINNED: dict[int, tuple[str, str]] = {
    1: ("images", "生成吉卜力风格古代照片.png"),
    2: ("images", "生成吉卜力风格古代照片 (1).png"),
    3: ("images", "生成吉卜力风格古代照片 (2).png"),
    4: ("images", "生成吉卜力风格古代照片 (3).png"),
    5: ("images", "生成吉卜力风格古代照片 (4).png"),
    6: ("images", "生成吉卜力风格古代照片 (5).png"),
    7: ("images", "生成吉卜力风格古代照片 (6).png"),
    8: ("images", "生成吉卜力风格古代照片 (7).png"),
    9: ("images", "生成吉卜力风格古代照片 (8).png"),
    10: ("images", "生成吉卜力风格古代照片 (9).png"),
    11: ("images2", "生成吉卜力风格古代照片.png"),
    12: ("images2", "生成吉卜力风格古代照片 (1).png"),
    13: ("images2", "生成吉卜力风格古代照片 (2).png"),
    14: ("images2", "生成吉卜力风格古代照片 (3).png"),
    15: ("images2", "生成吉卜力风格古代照片 (4).png"),
    16: ("images2", "生成吉卜力风格古代照片 (5).png"),
    17: ("images2", "生成吉卜力风格古代照片 (6).png"),
    18: ("images2", "生成吉卜力风格古代照片 (7).png"),
    19: ("images2", "生成吉卜力风格古代照片 (8).png"),
    20: ("images2", "生成吉卜力风格古代照片 (9).png"),
    # 卷三・非洲尋古 - modern scenes holding ancient African artefacts
    21: ("images3", "生成吉卜力风格古代照片 (1).png"),
    22: ("images3", "生成吉卜力风格古代照片 (2).png"),
    23: ("images3", "生成吉卜力风格古代照片 (3).png"),
    24: ("images3", "生成吉卜力风格古代照片 (4).png"),
    25: ("images3", "生成吉卜力风格古代照片 (5).png"),
    26: ("images3", "生成吉卜力风格古代照片 (6).png"),
    27: ("images3", "生成吉卜力风格古代照片 (7).png"),
    28: ("images3", "生成吉卜力风格古代照片 (8).png"),
    29: ("images3", "生成吉卜力风格古代照片 (9).png"),
    30: ("images3", "生成吉卜力风格古代照片 (10).png"),
    # 卷四・遠古尋獸 - prehistoric creatures hidden among present-day wildlife
    31: ("images4", "生成吉卜力风格古代照片.png"),
    32: ("images4", "生成吉卜力风格古代照片 (1).png"),
    33: ("images4", "生成吉卜力风格古代照片 (2).png"),
    34: ("images4", "生成吉卜力风格古代照片 (3).png"),
    35: ("images4", "生成吉卜力风格古代照片 (4).png"),
    36: ("images4", "生成吉卜力风格古代照片 (5).png"),
    37: ("images4", "生成吉卜力风格古代照片 (6).png"),
    38: ("images4", "生成吉卜力风格古代照片 (7).png"),
    39: ("images4", "生成吉卜力风格古代照片 (8).png"),
    40: ("images4", "生成吉卜力风格古代照片 (9).png"),
    # 卷五・海底尋蹤 - reef scenes where the targets are the PRESENT-DAY sea creatures
    41: ("images5", "生成吉卜力风格古代照片.png"),
    42: ("images5", "生成吉卜力风格古代照片 (1).png"),
    43: ("images5", "生成吉卜力风格古代照片 (2).png"),
    44: ("images5", "生成吉卜力风格古代照片 (3).png"),
    45: ("images5", "生成吉卜力风格古代照片 (4).png"),
    46: ("images5", "生成吉卜力风格古代照片 (5).png"),
    47: ("images5", "生成吉卜力风格古代照片 (6).png"),
    48: ("images5", "生成吉卜力风格古代照片 (7).png"),
    49: ("images5", "生成吉卜力风格古代照片 (8).png"),
    50: ("images5", "生成吉卜力风格古代照片 (9).png"),
}

FULL_SIZE = (1440, 1920)
THUMB_SIZE = (360, 480)
SUFFIX = re.compile(r"\((\d+)\)\s*$")


def sort_key(path: Path) -> tuple[int, str]:
    """Order a volume: base file first, then (1), (2), (3) …"""
    match = SUFFIX.search(path.stem)
    return (int(match.group(1)) if match else 0, path.name)


def discover() -> list[tuple[int, Path]]:
    """Map every available source photo to its chapter number."""
    assigned: dict[int, Path] = {}
    for chapter, (folder, name) in PINNED.items():
        path = ROOT / folder / name
        if path.is_file():
            assigned[chapter] = path
        else:
            print(f"missing source for chapter {chapter}: {folder}/{name}")

    used = {p.resolve() for p in assigned.values()}
    for folder, first_chapter in VOLUMES:
        source_dir = ROOT / folder
        if not source_dir.is_dir():
            print(f"volume folder missing, skipped: {folder}/")
            continue
        extras = [
            p
            for p in sorted(
                (q for q in source_dir.iterdir() if q.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}),
                key=sort_key,
            )
            if p.resolve() not in used
        ]
        if extras:
            next_chapter = max((c for c, (f, _) in PINNED.items() if f == folder), default=first_chapter - 1) + 1
            for photo in extras:
                while next_chapter in assigned:
                    next_chapter += 1
                assigned[next_chapter] = photo
                used.add(photo.resolve())
                print(f"auto-assigned {folder}/{photo.name} -> chapter {next_chapter}")
            print(f"{folder}/: {len(extras)} new photo(s) appended")

    found = sorted(assigned.items())
    for folder, first_chapter in VOLUMES:
        count = sum(1 for _, p in found if p.parent.name == folder)
        if count:
            print(f"{folder}/ -> {count} photo(s) for volume starting at chapter {first_chapter}")
    return found


def check_declared_size(chapter: int, path: Path) -> str | None:
    """The apps use imageWidth/imageHeight for the aspect ratio, so it must match."""
    level_file = ROOT / "shared" / "levels" / f"level-{chapter:02d}.json"
    if not level_file.exists():
        return None
    declared = json.loads(level_file.read_text(encoding="utf-8-sig"))
    expected = (declared["imageWidth"], declared["imageHeight"])
    if expected != FULL_SIZE:
        return f"level-{chapter:02d}.json declares {expected[0]}x{expected[1]}, but the shipped asset is {FULL_SIZE[0]}x{FULL_SIZE[1]}"
    if declared["image"].replace(".jpg", "") != f"chapter-{chapter:02d}":
        return f"level-{chapter:02d}.json points at image '{declared['image']}', expected chapter-{chapter:02d}.jpg"
    return None


def build(strict: bool = False) -> int:
    FULL_DIR.mkdir(parents=True, exist_ok=True)
    sources = discover()
    if not sources:
        print("no source photos found")
        return 1

    chapters = [chapter for chapter, _ in sources]
    gaps = [n for n in range(1, max(chapters) + 1) if n not in chapters]
    if gaps:
        message = f"chapters without a source photo: {gaps}"
        print(("ERROR: " if strict else "warning: ") + message)

    total = 0
    problems: list[str] = []
    for chapter, src in sources:
        with Image.open(src) as im:
            im = im.convert("RGB")
            if (im.width, im.height) != FULL_SIZE:
                im = im.resize(FULL_SIZE, Image.LANCZOS)
            full = FULL_DIR / f"chapter-{chapter:02d}.jpg"
            im.save(full, "JPEG", quality=84, optimize=True, progressive=True)
            thumb = FULL_DIR / f"chapter-{chapter:02d}-thumb.jpg"
            im.resize(THUMB_SIZE, Image.LANCZOS).save(thumb, "JPEG", quality=78, optimize=True, progressive=True)

        for mirror in MIRRORS:
            mirror.mkdir(parents=True, exist_ok=True)
            shutil.copy2(full, mirror / full.name)
            shutil.copy2(thumb, mirror / thumb.name)

        issue = check_declared_size(chapter, src)
        if issue:
            problems.append(issue)
        size_kb = full.stat().st_size / 1024
        thumb_kb = thumb.stat().st_size / 1024
        total += full.stat().st_size
        print(f"chapter-{chapter:02d}: {src.parent.name}/{src.name} -> {full.name} ({size_kb:.0f} KB) + thumb ({thumb_kb:.0f} KB)")

    print(f"\n{len(sources)} chapters, main images total {total / 1024 / 1024:.1f} MB")
    print("mirrored into:", ", ".join(str(m.relative_to(ROOT)) for m in MIRRORS))
    for problem in problems:
        print("warning:", problem)
    if strict and (gaps or problems):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(build(strict="--strict" in sys.argv[1:]))
