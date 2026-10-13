/**
 * Pure helpers for drawn signatures (signature_pad stroke data → PNG stamp).
 *
 * signature_pad's `toData()` is an array of stroke groups:
 *   [{ penColor, minWidth, maxWidth, dotSize, points: [{ x, y, pressure, time }] }]
 * with coordinates in the pad canvas's CSS pixels.
 */

/**
 * Bounding box (CSS px) of everything drawn, grown by each stroke's maximum
 * pen width (lines extend beyond their centre points) plus `padding`, and
 * clipped to the pad. Returns null when nothing has been drawn.
 */
export function strokeBounds(data, { padding = 8, width = Infinity, height = Infinity } = {}) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const group of data ?? []) {
    const reach = Math.max(group.maxWidth ?? 2.5, group.dotSize ?? 0) + padding;
    for (const p of group.points ?? []) {
      minX = Math.min(minX, p.x - reach);
      minY = Math.min(minY, p.y - reach);
      maxX = Math.max(maxX, p.x + reach);
      maxY = Math.max(maxY, p.y + reach);
    }
  }
  if (minX === Infinity) return null;
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const right = Math.min(width, Math.ceil(maxX));
  const bottom = Math.min(height, Math.ceil(maxY));
  return { x, y, width: right - x, height: bottom - y };
}

/** Whether there's anything worth saving (at least one point). */
export const hasInk = (data) => (data ?? []).some((group) => group.points?.length > 0);

/**
 * Whether PNG bytes can carry transparency: an alpha colour type
 * (4 = grey + alpha, 6 = RGBA) or a tRNS chunk. Header-only, no decoding.
 */
export function pngHasAlpha(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 33 || b[0] !== 0x89 || b[1] !== 0x50) return false;
  const colourType = b[25];
  if (colourType === 4 || colourType === 6) return true;
  // Walk chunks looking for tRNS before the image data.
  let i = 8;
  while (i + 8 <= b.length) {
    const length = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    i += 12 + length;
  }
  return false;
}

/** Pen colours offered for signing (ink-like, readable when printed). */
export const PEN_COLOURS = [
  { id: 'black', label: 'Black', value: '#111111' },
  { id: 'blue', label: 'Blue', value: '#1f3fbf' },
];
