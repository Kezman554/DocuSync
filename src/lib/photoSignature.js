/**
 * Photo → transparent signature: the core image transform. Pure functions
 * over RGBA pixel buffers ({ data: Uint8ClampedArray, width, height }, the
 * shape of ImageData) — no DOM, so it's unit-tested directly.
 *
 * Pipeline (photoToSignature):
 *   1. grayscale            luminance; transparent input counts as white paper
 *   2. adaptive threshold   ink = clearly darker than its local mean (Bradley-
 *                           style, local means from an integral image), so
 *                           uneven lighting and soft shadows don't turn into ink;
 *                           a soft band gives anti-aliased stroke edges
 *   3. clean-up             drop specks (small blobs) and marks touching the
 *                           photo's edge (table edges, shadow bands) — unless
 *                           that would leave nothing
 *   4. compose + crop       uniform ink colour, paper alpha 0, crop to the ink
 */

export const DEFAULTS = {
  /** How much darker than its surroundings a pixel must be (fraction of the local mean). */
  sensitivity: 0.15,
  /** Local window as a fraction of the shorter side. */
  windowFraction: 1 / 10,
  /** Ignore differences smaller than this (grey levels) — paper grain, JPEG noise. */
  minContrast: 14,
  /** Blobs smaller than this fraction of the image area are specks… */
  speckFraction: 0.00003,
  /** …and never smaller than this many pixels (an i-dot is well above it). */
  minSpeckArea: 6,
  /** Drop marks touching the photo border (if anything else remains). */
  dropEdgeMarks: true,
  /** Transparent margin around the cropped ink, in px. */
  padding: 8,
  /** null = use the photo's own (averaged) ink colour, or [r, g, b]. */
  inkColour: null,
};

/** Luminance (Rec. 601), alpha-composited over white. */
export function toGrayscale({ data, width, height }) {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; p < gray.length; i += 4, p += 1) {
    const a = data[i + 3] / 255;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = lum * a + 255 * (1 - a);
  }
  return gray;
}

/** Summed-area table, (width+1) × (height+1), for O(1) box sums. */
export function integralImage(values, width, height) {
  const w1 = width + 1;
  const sat = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += values[y * width + x];
      sat[(y + 1) * w1 + (x + 1)] = sat[y * w1 + (x + 1)] + row;
    }
  }
  return sat;
}

/** Mean of each pixel's (2r+1)² neighbourhood, clipped at the edges. */
export function localMeans(gray, width, height, radius) {
  const sat = integralImage(gray, width, height);
  const w1 = width + 1;
  const means = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum = sat[y1 * w1 + x1] - sat[y0 * w1 + x1] - sat[y1 * w1 + x0] + sat[y0 * w1 + x0];
      means[y * width + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return means;
}

const smoothstep = (lo, hi, v) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * Ink opacity 0..1 per pixel. A pixel is ink when it's darker than its local
 * mean by more than `sensitivity` (relative) AND `minContrast` (absolute);
 * opacity ramps up smoothly around that threshold for soft edges.
 */
export function inkAlpha(gray, means, { sensitivity = DEFAULTS.sensitivity, minContrast = DEFAULTS.minContrast } = {}) {
  const alpha = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    const diff = means[i] - gray[i];
    if (diff < minContrast) continue;
    const relative = diff / Math.max(means[i], 1);
    alpha[i] = smoothstep(sensitivity * 0.6, sensitivity * 1.6, relative);
  }
  return alpha;
}

/**
 * Label 8-connected blobs of alpha > 0. Returns per-blob pixel lists, area,
 * and whether the blob touches the image border.
 */
export function inkComponents(alpha, width, height) {
  const label = new Int32Array(alpha.length).fill(-1);
  const blobs = [];
  const stack = [];
  for (let start = 0; start < alpha.length; start += 1) {
    if (alpha[start] <= 0 || label[start] !== -1) continue;
    const id = blobs.length;
    const pixels = [];
    let touchesEdge = false;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      pixels.push(p);
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (alpha[q] > 0 && label[q] === -1) {
            label[q] = id;
            stack.push(q);
          }
        }
      }
    }
    blobs.push({ pixels, area: pixels.length, touchesEdge });
  }
  return blobs;
}

/**
 * Zero out specks (area < minArea) and, if `dropEdgeMarks`, blobs touching
 * the border — but keep edge blobs if they're all that's left. Returns a new
 * alpha array.
 */
export function cleanUp(alpha, width, height, { minArea, dropEdgeMarks = true }) {
  const blobs = inkComponents(alpha, width, height).filter((b) => b.area >= minArea);
  const interior = blobs.filter((b) => !b.touchesEdge);
  const keep = dropEdgeMarks && interior.length > 0 ? interior : blobs;
  const out = new Float32Array(alpha.length);
  for (const blob of keep) for (const p of blob.pixels) out[p] = alpha[p];
  return out;
}

/** Bounding box of alpha > 0 grown by `padding`, clipped; null if empty. */
export function inkBounds(alpha, width, height, padding = 0) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  return {
    x,
    y,
    width: Math.min(width, maxX + 1 + padding) - x,
    height: Math.min(height, maxY + 1 + padding) - y,
  };
}

/** Average colour of the solid ink (alpha ≥ 0.9); black if there's none. */
export function estimateInkColour({ data }, alpha) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let p = 0; p < alpha.length; p += 1) {
    if (alpha[p] < 0.9) continue;
    r += data[p * 4];
    g += data[p * 4 + 1];
    b += data[p * 4 + 2];
    n += 1;
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
}

/** "#1f3fbf" → [31, 63, 191]; arrays pass through. */
export function parseColour(colour) {
  if (Array.isArray(colour)) return colour;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(colour ?? ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The whole transform. Returns the cropped transparent signature as RGBA
 * plus some stats, or null if no ink was found.
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} image
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export function photoToSignature(image, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const { width, height } = image;
  const gray = toGrayscale(image);
  const radius = Math.max(4, Math.round((Math.min(width, height) * opts.windowFraction) / 2));
  const means = localMeans(gray, width, height, radius);
  const raw = inkAlpha(gray, means, opts);
  const minArea = Math.max(opts.minSpeckArea, Math.round(width * height * opts.speckFraction));
  const alpha = cleanUp(raw, width, height, { minArea, dropEdgeMarks: opts.dropEdgeMarks });

  const bounds = inkBounds(alpha, width, height, opts.padding);
  if (!bounds) return null;

  const [r, g, b] = parseColour(opts.inkColour) ?? estimateInkColour(image, alpha);
  const out = new Uint8ClampedArray(bounds.width * bounds.height * 4); // all transparent
  let inkPixels = 0;
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const a = alpha[(y + bounds.y) * width + (x + bounds.x)];
      if (a <= 0) continue;
      const o = (y * bounds.width + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.round(a * 255);
      inkPixels += 1;
    }
  }
  return {
    data: out,
    width: bounds.width,
    height: bounds.height,
    bounds,
    inkColour: [r, g, b],
    inkPixels,
  };
}
