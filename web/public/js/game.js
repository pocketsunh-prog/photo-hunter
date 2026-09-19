/**
 * Pure geometry + rules helpers for hit testing.
 *
 * A tap lands inside an object when it falls in that object's bbox grown by a
 * finger-sized tolerance; tiny objects are first grown to a minimum tappable
 * size. When several boxes match (a small object sitting on a big one) the
 * SMALLEST wins, because the player clearly aimed at the specific thing.
 */

export const HIT = {
  /** extra tolerance around every box, in normalised units */
  padX: 0.014,
  padY: 0.012,
  /** minimum tappable size of a target, in normalised units */
  minW: 0.026,
  minH: 0.022,
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Grow a bbox to the minimum tappable size, keeping it inside the photo. */
export function tappableBox(bbox, { minW = HIT.minW, minH = HIT.minH } = {}) {
  let [x, y, w, h] = bbox;
  if (w < minW) {
    x -= (minW - w) / 2;
    w = minW;
  }
  if (h < minH) {
    y -= (minH - h) / 2;
    h = minH;
  }
  x = clamp(x, 0, Math.max(0, 1 - w));
  y = clamp(y, 0, Math.max(0, 1 - h));
  return [x, y, Math.min(w, 1), Math.min(h, 1)];
}

export function boxCenter(bbox) {
  const [x, y, w, h] = bbox;
  return [x + w / 2, y + h / 2];
}

/**
 * @param {Array<{id:number, bbox:number[]}>} objects  candidates (already unfound)
 * @param {number} nx normalised x inside the photo (0..1)
 * @param {number} ny normalised y inside the photo (0..1)
 * @returns the hit object, or null
 */
export function hitTest(objects, nx, ny) {
  let best = null;
  let bestArea = Infinity;
  for (const object of objects) {
    const [x, y, w, h] = tappableBox(object.bbox);
    if (nx < x - HIT.padX || nx > x + w + HIT.padX) continue;
    if (ny < y - HIT.padY || ny > y + h + HIT.padY) continue;
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      best = object;
    }
  }
  return best;
}

export function formatTime(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
