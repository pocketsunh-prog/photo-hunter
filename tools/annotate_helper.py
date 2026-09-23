#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Image helpers for annotating photo-hunter levels.

Subcommands
-----------
info   <image>
       Print width/height/format.

grid   <image> <out.png> [--step 0.1] [--labels]
       Overlay a normalised coordinate grid (labels are 0..1 values) so you can
       read off approximate normalised positions.

crop   <image> <out.png> <x> <y> <w> <h> [--zoom 2] [--grid]
       Crop a pixel region (x,y,w,h in FULL-resolution pixels) and optionally
       upscale it, so small objects become readable. --grid draws lines every 10%
       OF THE CROP and labels each one with its full-image pixel coordinate (the
       printed header repeats the step in pixels) - the label spacing is NOT 10%
       of the whole image, so read the numbers rather than assuming a spacing.

overlay <image> <level.json> <out.png> [--numbers]
       Draw every bbox from a level JSON onto the image with an index label and
       a small centre cross. This is the mandatory self-check: eyeball it and
       fix boxes that are off-target.

one    <image> <level.json> <out.png> <objectId> [--pad 0.03]
       Zoom onto a single object (padded) so you can verify the box hugs it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Windows consoles here default to cp950; keep non-ASCII paths printable.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def save(img: Image.Image, out: str) -> None:
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    img.save(out)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msjh.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\arialbd.ttf",
]


def get_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def load(path: str) -> Image.Image:
    im = Image.open(path)
    im.load()
    return im.convert("RGB")


def cmd_info(args: argparse.Namespace) -> int:
    im = Image.open(args.image)
    print(f"path={args.image}\nformat={im.format}\nsize={im.width}x{im.height}\nmode={im.mode}")
    return 0


def cmd_grid(args: argparse.Namespace) -> int:
    im = load(args.image)
    d = ImageDraw.Draw(im, "RGBA")
    step = args.step
    font = get_font(max(14, im.width // 70))
    n = int(round(1 / step))
    for i in range(n + 1):
        v = i * step
        x = min(im.width - 1, round(v * im.width))
        y = min(im.height - 1, round(v * im.height))
        major = i % 2 == 0
        d.line([(x, 0), (x, im.height)], fill=(255, 0, 0, 170 if major else 80), width=3 if major else 1)
        d.line([(0, y), (im.width, y)], fill=(255, 0, 0, 170 if major else 80), width=3 if major else 1)
        if args.labels:
            d.text((x + 6, 8), f"x={v:.2f}", fill=(255, 255, 0, 255), font=font,
                   stroke_width=3, stroke_fill=(0, 0, 0, 255))
            d.text((8, y + 6), f"y={v:.2f}", fill=(0, 255, 255, 255), font=font,
                   stroke_width=3, stroke_fill=(0, 0, 0, 255))
    save(im, args.out)
    print(f"wrote {args.out} ({im.width}x{im.height})")
    return 0


def cmd_crop(args: argparse.Namespace) -> int:
    im = load(args.image)
    x, y, w, h = args.x, args.y, args.w, args.h
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(im.width, x + w), min(im.height, y + h)
    if x1 <= x0 or y1 <= y0:
        print("empty crop region", file=sys.stderr)
        return 2
    tile = im.crop((x0, y0, x1, y1))
    if args.zoom != 1:
        tile = tile.resize((int(tile.width * args.zoom), int(tile.height * args.zoom)), Image.LANCZOS)
    if args.grid:
        d = ImageDraw.Draw(tile, "RGBA")
        font = get_font(max(13, tile.width // 40))
        # Grid lines every 10% OF THIS CROP (not of the whole image), each labelled
        # with its full-image pixel coordinate. The header states the step in pixels
        # so the spacing can never be mistaken for 10% of the full image.
        step_px = round((x1 - x0) / 10)
        for i in range(1, 10):
            fx = x0 + (x1 - x0) * i / 10
            fy = y0 + (y1 - y0) * i / 10
            px = round((fx - x0) * args.zoom)
            py = round((fy - y0) * args.zoom)
            d.line([(px, 0), (px, tile.height)], fill=(255, 0, 0, 150), width=1)
            d.line([(0, py), (tile.width, py)], fill=(255, 0, 0, 150), width=1)
            d.text((px + 3, 3), str(round(fx)), fill=(255, 255, 0, 255), font=font,
                   stroke_width=2, stroke_fill=(0, 0, 0, 255))
            d.text((3, py + 3), str(round(fy)), fill=(0, 255, 255, 255), font=font,
                   stroke_width=2, stroke_fill=(0, 0, 0, 255))
        d.text((3, 3), f"crop x{x0} y{y0} w{x1-x0} h{y1-y0} | grid every {step_px}px (labels = full-image px)",
               fill=(255, 255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0, 255))
    save(tile, args.out)
    print(f"wrote {args.out} ({tile.width}x{tile.height}) from ({x0},{y0})-({x1},{y1})")
    return 0


def _draw_box(d: ImageDraw.ImageDraw, im: Image.Image, bbox, label: str, colour) -> None:
    x, y, w, h = bbox
    box = [x * im.width, y * im.height, (x + w) * im.width, (y + h) * im.height]
    d.rectangle(box, outline=colour, width=max(3, im.width // 250))
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    r = max(6, im.width // 150)
    d.line([(cx - r, cy), (cx + r, cy)], fill=colour, width=3)
    d.line([(cx, cy - r), (cx, cy + r)], fill=colour, width=3)
    font = get_font(max(20, im.width // 45))
    tx, ty = box[0], max(0, box[1] - font.size - 6)
    d.rectangle([tx, ty, tx + font.size * 1.6 + 8 * len(label), ty + font.size + 6],
                fill=(0, 0, 0, 200))
    d.text((tx + 4, ty + 3), label, fill=colour, font=font)


def cmd_overlay(args: argparse.Namespace) -> int:
    im = load(args.image)
    data = json.loads(open(args.level, encoding="utf-8-sig").read())
    d = ImageDraw.Draw(im, "RGBA")
    palette = [(255, 60, 60), (60, 220, 255), (255, 230, 60), (120, 255, 120), (255, 120, 255)]
    for i, obj in enumerate(data["objects"]):
        label = f"{obj['id']}" + (f" {obj['name']}" if args.numbers else "")
        _draw_box(d, im, obj["bbox"], label, palette[i % len(palette)] + (255,))
    save(im, args.out)
    print(f"wrote {args.out} with {len(data['objects'])} boxes")
    return 0


def cmd_one(args: argparse.Namespace) -> int:
    im = load(args.image)
    data = json.loads(open(args.level, encoding="utf-8-sig").read())
    obj = next((o for o in data["objects"] if o["id"] == args.objectId), None)
    if obj is None:
        print(f"no object with id {args.objectId}", file=sys.stderr)
        return 2
    x, y, w, h = obj["bbox"]
    pad = args.pad
    x0 = max(0.0, x - pad * w - pad * 0.5)
    y0 = max(0.0, y - pad * h - pad * 0.5)
    x1 = min(1.0, x + w + pad * w + pad * 0.5)
    y1 = min(1.0, y + h + pad * h + pad * 0.5)
    tile = im.crop((round(x0 * im.width), round(y0 * im.height), round(x1 * im.width), round(y1 * im.height)))
    scale = max(1, min(4, 900 // max(1, tile.width)))
    if scale > 1:
        tile = tile.resize((tile.width * scale, tile.height * scale), Image.LANCZOS)
    d = ImageDraw.Draw(tile, "RGBA")
    bx = [(x - x0) / (x1 - x0) * tile.width, (y - y0) / (y1 - y0) * tile.height,
          (x + w - x0) / (x1 - x0) * tile.width, (y + h - y0) / (y1 - y0) * tile.height]
    d.rectangle(bx, outline=(255, 0, 0, 255), width=4)
    save(tile, args.out)
    print(f"wrote {args.out} ({tile.width}x{tile.height}) zoom x{scale} for object {obj['id']} {obj['name']}")
    return 0


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("info"); s.add_argument("image"); s.set_defaults(func=cmd_info)

    s = sub.add_parser("grid")
    s.add_argument("image"); s.add_argument("out")
    s.add_argument("--step", type=float, default=0.1); s.add_argument("--labels", action="store_true")
    s.set_defaults(func=cmd_grid)

    s = sub.add_parser("crop")
    s.add_argument("image"); s.add_argument("out")
    s.add_argument("x", type=int); s.add_argument("y", type=int)
    s.add_argument("w", type=int); s.add_argument("h", type=int)
    s.add_argument("--zoom", type=float, default=2.0); s.add_argument("--grid", action="store_true")
    s.set_defaults(func=cmd_crop)

    s = sub.add_parser("overlay")
    s.add_argument("image"); s.add_argument("level"); s.add_argument("out")
    s.add_argument("--numbers", action="store_true", default=True)
    s.set_defaults(func=cmd_overlay)

    s = sub.add_parser("one")
    s.add_argument("image"); s.add_argument("level"); s.add_argument("out")
    s.add_argument("objectId", type=int); s.add_argument("--pad", type=float, default=0.6)
    s.set_defaults(func=cmd_one)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
