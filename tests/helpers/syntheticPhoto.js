/**
 * Synthetic "photos" of ink on paper with exact ground truth, for testing the
 * photo → signature transform: paper colour, lighting (gradient / shadow),
 * grain, soft-edged ink strokes, and extra dark marks (specks, table edges).
 */

/** Deterministic PRNG (mulberry32) so noise is the same every run. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const distToSegment = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/**
 * Paper with lighting `light(x, y)` (0..1 brightness factor), grain, and ink
 * strokes (polylines) with soft edges. Returns the image and a truth mask of
 * pixels that are (at least partly) ink.
 */
export function makePhoto({
  width = 400,
  height = 200,
  paper = [238, 234, 224],
  ink = [35, 50, 125],
  strokes = [],
  strokeWidth = 5,
  light = () => 1,
  noise = 6,
  extraDark = [], // [{ x, y, w, h, value }] solid dark rects (specks, edges)
  seed = 1,
}) {
  const random = rng(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  const truth = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let d = Infinity;
      for (const line of strokes) {
        for (let i = 1; i < line.length; i += 1) d = Math.min(d, distToSegment(x, y, line[i - 1], line[i]));
      }
      // Ink coverage: 1 inside the stroke, fading over 1px at the edge.
      const cover = Math.max(0, Math.min(1, strokeWidth / 2 + 0.5 - d));
      if (cover > 0) truth[y * width + x] = 1;
      const f = light(x, y);
      const n = (random() - 0.5) * 2 * noise;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const base = paper[c] * (1 - cover) + ink[c] * cover;
        data[o + c] = base * f + n;
      }
      data[o + 3] = 255;
    }
  }
  for (const r of extraDark) {
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) {
        const o = (y * width + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = r.value;
      }
    }
  }
  return { image: { data, width, height }, truth };
}

export const SIGNATURE = [
  [[60, 140], [90, 60], [120, 140], [150, 70], [185, 135]],
  [[200, 120], [260, 80], [330, 110]],
];

