#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate the legacy (pre-API 26) launcher PNGs for the Android app.

API 26+ uses the adaptive icon in res/mipmap-anydpi-v26 (vector drawable), but
older devices still need real bitmaps in mipmap-<density>/, and shipping those
avoids a broken icon on a large slice of devices.

Design mirrors drawable/ic_launcher_foreground.xml: rice-paper photo card with a
vermilion seal and a gold magnifier, on the ink background.

Usage: py tools/generate_android_icons.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"

INK = (23, 19, 15, 255)
PAPER = (244, 233, 214, 255)
PAPER_LINE = (201, 184, 148, 255)
GOLD = (217, 164, 65, 255)
VERMILION = (192, 68, 47, 255)

# density bucket -> icon edge in px
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def draw_icon(size: int, rounded: bool) -> Image.Image:
    scale = 4  # supersample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = int(s * 0.22) if rounded else 0
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=INK)

    # photo card
    card = [s * 0.20, s * 0.26, s * 0.72, s * 0.74]
    d.rounded_rectangle(card, radius=int(s * 0.045), fill=PAPER)
    # ruled lines
    for i, (x0, x1) in enumerate([(0.27, 0.64), (0.27, 0.56), (0.27, 0.49)]):
        y = 0.36 + i * 0.085
        d.line([(s * x0, s * y), (s * x1, s * y)], fill=PAPER_LINE, width=max(2, int(s * 0.022)))
    # vermilion seal
    seal_r = s * 0.045
    d.ellipse([s * 0.30 - seal_r, s * 0.655 - seal_r, s * 0.30 + seal_r, s * 0.655 + seal_r], fill=VERMILION)

    # magnifier lens + handle, drawn last so it sits on top
    lens = [s * 0.44, s * 0.30, s * 0.86, s * 0.72]
    width = max(3, int(s * 0.055))
    d.ellipse(lens, outline=GOLD, width=width)
    d.line([(s * 0.75, s * 0.61), (s * 0.88, s * 0.74)], fill=GOLD, width=int(width * 1.3))

    return img.resize((size, size), Image.LANCZOS)


def main() -> int:
    count = 0
    for bucket, size in DENSITIES.items():
        target = RES / f"mipmap-{bucket}"
        target.mkdir(parents=True, exist_ok=True)
        draw_icon(size, rounded=True).save(target / "ic_launcher.png")
        # round icons use the same art; the launcher applies the mask
        draw_icon(size, rounded=False).save(target / "ic_launcher_round.png")
        count += 2
        print(f"mipmap-{bucket}: ic_launcher.png / ic_launcher_round.png ({size}x{size})")
    print(f"\n{count} launcher bitmaps written under {RES.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
