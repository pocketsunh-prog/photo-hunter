# Level data contract (shared by Web + Android)

Every chapter is one JSON file in this folder: `level-01.json` … `level-10.json`.

```jsonc
{
  "id": 1,                          // 1..N, also the chapter number
  "slug": "chapter-01-market-office",
  "collection": "卷一・古畫尋穿越",   // which volume the chapter belongs to (illustrated on the map)
  "title": "第一章・市集衙前",        // Traditional Chinese chapter title
  "subtitle": "一句話副標",           // one-line flavour text
  "era": "唐代",                     // the era the PHOTO pretends to be from
  "image": "chapter-01.jpg",         // file name inside assets/images
  "imageWidth": 1440,                // pixel size of the shipped asset
  "imageHeight": 1920,
  "objects": [                       // EXACTLY 10 entries
    {
      "id": 1,
      "name": "平板電腦",
      "nameEn": "Tablet computer",
      "reason": "唐代不可能出現電子顯示器。",
      "hint": "木桌右前方，靠在卷軸旁邊那塊扁平的黑色方塊。",
      "bbox": [0.60, 0.69, 0.20, 0.06], // [x, y, w, h] normalised 0..1, origin = top-left
      "confidence": "high"
    }
  ]
}
```

## The two volumes

| Volume | Chapters | Photo | The ten objects are |
|---|---|---|---|
| `卷一・古畫尋穿越` | 1–10 | an ancient scene | modern things that should not exist yet |
| `卷二・今世覓古物` | 11–20 | a modern photo | ancient artefacts being worn / carried / placed in the modern world |

`era` always describes **the photo**, never the targets, so for volume 2 it is a
modern era (e.g. `現代（約 2020 年代）`) and each `reason` explains why such an
ancient object cannot be there.

Rules enforced by `tools/validate_levels.py`:

* exactly 10 objects, `id` 1..10 in order, unique `name`
* `bbox` = `[x, y, w, h]` normalised to the **full image**, `x`/`y` are the top-left corner
* `0 < w,h <= 0.60` and `w,h >= 0.008` (smaller regions are un-tappable on a phone)
* two targets may not overlap by more than 55% of the smaller box
* `hint` must be Traditional Chinese and must not leak the object name

Tap resolution at runtime: a tap anywhere inside the bbox counts as found; both apps
expand every bbox to at least 44 dp / 40 css px and to a minimum 2.5% of the image
width so small objects stay reachable on phones.
