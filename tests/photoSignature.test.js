// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  cleanUp,
  estimateInkColour,
  inkAlpha,
  inkBounds,
  inkComponents,
  integralImage,
  localMeans,
  parseColour,
  photoToSignature,
  toGrayscale,
} from '../src/lib/photoSignature.js';

// Synthetic "photos" with known ground truth (paper, lighting, grain, ink).
import { SIGNATURE, makePhoto } from './helpers/syntheticPhoto.js';

/** Truth bounding box of the strokes. */
function truthBounds(truth, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < truth.length; i += 1) {
    if (!truth[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** Pixels the pipeline made opaque-ish that are NOT ink (≥2px from any stroke). */
function strayInk(result, truth, width) {
  let stray = 0;
  for (let y = 0; y < result.height; y += 1) {
    for (let x = 0; x < result.width; x += 1) {
      if (result.data[(y * result.width + x) * 4 + 3] === 0) continue;
      const sx = x + result.bounds.x;
      const sy = y + result.bounds.y;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy += 1) {
        for (let dx = -2; dx <= 2 && !near; dx += 1) {
          if (truth[(sy + dy) * width + (sx + dx)]) near = true;
        }
      }
      if (!near) stray += 1;
    }
  }
  return stray;
}

const alphaAt = (result, x, y) => result.data[(y * result.width + x) * 4 + 3];

// ---------------------------------------------------------------------------

describe('building blocks', () => {
  it('converts to luminance, treating transparency as white paper', () => {
    const gray = toGrayscale({
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 100, 100, 100, 128]),
      width: 4,
      height: 1,
    });
    expect(gray[0]).toBeCloseTo(76.245, 3); // pure red
    expect(gray[1]).toBe(0);
    expect(gray[2]).toBe(255); // fully transparent → paper
    expect(gray[3]).toBeCloseTo(100 * (128 / 255) + 255 * (127 / 255), 3);
  });

  it('computes box sums and clipped local means', () => {
    const v = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]); // 3×3
    const sat = integralImage(v, 3, 3);
    expect(sat[4 * 4 - 1]).toBe(45); // whole image
    const means = localMeans(v, 3, 3, 1);
    expect(means[4]).toBeCloseTo(5, 6); // centre: all nine
    expect(means[0]).toBeCloseTo((1 + 2 + 4 + 5) / 4, 6); // corner: clipped window
  });

  it('marks pixels darker than their surroundings, ignoring small differences', () => {
    const gray = Float32Array.from([200, 120, 195, 160]);
    const means = Float32Array.from([200, 200, 200, 200]);
    const a = inkAlpha(gray, means, { sensitivity: 0.15, minContrast: 14 });
    expect(a[0]).toBe(0); // paper
    expect(a[1]).toBe(1); // 40% darker → solid ink
    expect(a[2]).toBe(0); // 5 levels darker: below minContrast (noise)
    expect(a[3]).toBeGreaterThan(0); // 20% darker → partial (soft edge)
    expect(a[3]).toBeLessThan(1);
  });

  it('labels 8-connected blobs and flags border contact', () => {
    // 5×3:  X . . . X
    //       . X . . X
    //       . . . . .
    const alpha = Float32Array.from([1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0]);
    const blobs = inkComponents(alpha, 5, 3).map((b) => ({ area: b.area, edge: b.touchesEdge }));
    expect(blobs).toEqual([
      { area: 2, edge: true }, // diagonal pair joined by 8-connectivity
      { area: 2, edge: true },
    ]);
  });

  it('removes specks and edge marks, but keeps edge marks if nothing else remains', () => {
    // 7×7 with a 3×3 interior blob, a 1px speck, and a border strip.
    const w = 7;
    const alpha = new Float32Array(49);
    for (let y = 2; y <= 4; y += 1) for (let x = 2; x <= 4; x += 1) alpha[y * w + x] = 1;
    alpha[0 * w + 5] = 1; // speck (touches edge too)
    for (let x = 0; x < 7; x += 1) alpha[6 * w + x] = 1; // bottom edge strip (7px)
    const cleaned = cleanUp(alpha, 7, 7, { minArea: 4 });
    expect(Array.from(cleaned).filter((v) => v > 0)).toHaveLength(9); // only the interior blob

    const onlyEdge = new Float32Array(49);
    for (let x = 0; x < 7; x += 1) onlyEdge[6 * w + x] = 1;
    expect(Array.from(cleanUp(onlyEdge, 7, 7, { minArea: 4 })).filter((v) => v > 0)).toHaveLength(7);
  });

  it('finds padded, clipped ink bounds', () => {
    const alpha = new Float32Array(100); // 10×10
    alpha[3 * 10 + 4] = 1;
    alpha[6 * 10 + 7] = 0.5;
    expect(inkBounds(alpha, 10, 10, 2)).toEqual({ x: 2, y: 1, width: 8, height: 8 });
    expect(inkBounds(alpha, 10, 10, 5)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(inkBounds(new Float32Array(4), 2, 2)).toBeNull();
  });

  it('estimates ink colour from solid ink and parses hex colours', () => {
    const image = { data: new Uint8ClampedArray([10, 20, 200, 255, 30, 40, 100, 255, 250, 250, 250, 255]) };
    expect(estimateInkColour(image, Float32Array.from([1, 1, 0]))).toEqual([20, 30, 150]);
    expect(estimateInkColour(image, Float32Array.from([0.5, 0, 0]))).toEqual([0, 0, 0]);
    expect(parseColour('#1f3fbf')).toEqual([31, 63, 191]);
    expect(parseColour([1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseColour('blue')).toBeNull();
  });
});

describe('photoToSignature', () => {
  it('returns null for blank paper, even with grain and lighting falloff', () => {
    const { image } = makePhoto({ light: (x) => 1 - x / 800, noise: 8 });
    expect(photoToSignature(image)).toBeNull();
  });

  it('extracts the ink under strong uneven lighting where a global threshold fails', () => {
    // Bright on the left, dim on the right: paper drops to ~45% brightness,
    // darker than the ink on the bright side.
    const light = (x) => 1 - 0.55 * (x / 400);
    const { image, truth } = makePhoto({ strokes: SIGNATURE, light });

    // A naive global cut-off at mid-grey marks the dim paper as ink…
    const gray = toGrayscale(image);
    const dimPaper = gray[100 * 400 + 395];
    const brightInk = gray[100 * 400 + 75]; // on the first stroke
    expect(dimPaper).toBeLessThan(128);
    expect(dimPaper).toBeGreaterThan(brightInk);

    // …but the adaptive pipeline keeps only the strokes.
    const result = photoToSignature(image);
    expect(result).not.toBeNull();
    expect(strayInk(result, truth, 400)).toBe(0);

    // Cropped to the strokes plus the 8px padding (±1px for soft edges).
    const t = truthBounds(truth, 400, 200);
    expect(Math.abs(result.bounds.x - (t.minX - 8))).toBeLessThanOrEqual(1);
    expect(Math.abs(result.bounds.y - (t.minY - 8))).toBeLessThanOrEqual(1);
    expect(Math.abs(result.bounds.x + result.bounds.width - (t.maxX + 1 + 8))).toBeLessThanOrEqual(1);
    expect(Math.abs(result.bounds.y + result.bounds.height - (t.maxY + 1 + 8))).toBeLessThanOrEqual(1);
  });

  it('makes the paper fully transparent and the stroke cores solid', () => {
    const { image } = makePhoto({ strokes: SIGNATURE });
    const result = photoToSignature(image);
    const { width: w, height: h } = result;
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
      expect(alphaAt(result, x, y)).toBe(0);
    }
    // Middle of the long second stroke: (260, 80) in the photo.
    expect(alphaAt(result, 260 - result.bounds.x, 80 - result.bounds.y)).toBe(255);
    // Soft, anti-aliased edges exist (not a jagged 0/255 mask).
    let partial = 0;
    for (let i = 3; i < result.data.length; i += 4) {
      if (result.data[i] > 0 && result.data[i] < 255) partial += 1;
    }
    expect(partial).toBeGreaterThan(0);
  });

  it('ignores a soft shadow across the paper', () => {
    const shadow = (x, y) => 1 - 0.35 * Math.exp(-((x - 330) ** 2 + (y - 40) ** 2) / (2 * 45 ** 2));
    const { image, truth } = makePhoto({ strokes: SIGNATURE, light: shadow, seed: 7 });
    const result = photoToSignature(image);
    expect(strayInk(result, truth, 400)).toBe(0);
  });

  it('drops dust specks and the edge of a table, keeping the signature and an i-dot', () => {
    const { image, truth } = makePhoto({
      strokes: [...SIGNATURE, [[345, 70], [347, 72]]], // small i-dot
      extraDark: [
        { x: 30, y: 30, w: 2, h: 2, value: 40 }, // dust speck
        { x: 370, y: 170, w: 1, h: 2, value: 40 }, // dust speck
        { x: 0, y: 188, w: 400, h: 12, value: 60 }, // table edge along the bottom
      ],
    });
    const result = photoToSignature(image);
    expect(strayInk(result, truth, 400)).toBe(0);
    expect(result.bounds.y + result.bounds.height).toBeLessThan(188); // table not included
    expect(alphaAt(result, 346 - result.bounds.x, 71 - result.bounds.y)).toBeGreaterThan(0); // i-dot kept
  });

  it('keeps the ink’s own colour by default, or recolours it', () => {
    const { image } = makePhoto({ strokes: SIGNATURE, ink: [35, 50, 125] });
    const own = photoToSignature(image);
    const [r, g, b] = own.inkColour;
    expect(b).toBeGreaterThan(r + 40); // still blue ink
    expect(Math.abs(r - 35)).toBeLessThan(15);

    const black = photoToSignature(image, { inkColour: '#111111' });
    expect(black.inkColour).toEqual([17, 17, 17]);
    const i = black.data.findIndex((v, k) => k % 4 === 3 && v === 255);
    expect(Array.from(black.data.slice(i - 3, i))).toEqual([17, 17, 17]);
  });

  it('lets sensitivity control how strongly faint ink comes through', () => {
    // A faint pencil-like stroke: only ~14% darker than the paper.
    const { image } = makePhoto({ strokes: SIGNATURE, ink: [205, 202, 194], noise: 3 });
    const meanAlpha = (result) => {
      let sum = 0;
      let n = 0;
      for (let i = 3; i < result.data.length; i += 4) {
        if (result.data[i] > 0) {
          sum += result.data[i];
          n += 1;
        }
      }
      return sum / n / 255;
    };
    // Default: faint ink comes through semi-transparent (soft-edge band).
    const normal = photoToSignature(image);
    expect(meanAlpha(normal)).toBeLessThan(0.6);
    // More sensitive (lower value): the same strokes come out solid.
    expect(meanAlpha(photoToSignature(image, { sensitivity: 0.06, minContrast: 8 }))).toBeGreaterThan(0.85);
    // Less sensitive (higher value): ignored entirely.
    expect(photoToSignature(image, { sensitivity: 0.3 })).toBeNull();
  });

  it('handles a phone-sized photo in reasonable time', () => {
    const { image } = makePhoto({
      width: 1600,
      height: 1200,
      strokes: SIGNATURE.map((line) => line.map(([x, y]) => [x * 4, y * 6])),
      strokeWidth: 14,
      noise: 4,
    });
    const started = performance.now();
    const result = photoToSignature(image);
    expect(result.inkPixels).toBeGreaterThan(10000);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
