/**
 * Identify PNG/JPEG data and read its pixel size from the file header —
 * by content, not file name, and without decoding (pure, no DOM).
 * These are the two formats pdf-lib can embed (embedPng / embedJpg).
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// JPEG start-of-frame markers carry the image size (excludes DHT C4, JPG C8, DAC CC).
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

function pngInfo(b) {
  if (b.length < 24 || !PNG_SIGNATURE.every((v, i) => b[i] === v)) return null;
  // First chunk must be IHDR: width and height follow its type.
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  return { mime: 'image/png', width: u32(b, 16), height: u32(b, 20) };
}

function jpegInfo(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null; // lost sync: not a well-formed JPEG
    let marker = b[i + 1];
    while (marker === 0xff && i + 2 < b.length) {
      i += 1; // fill bytes
      marker = b[i + 1];
    }
    // Markers without a length segment.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / scan before any SOF
    if (SOF_MARKERS.has(marker)) {
      if (i + 8 >= b.length) return null;
      return { mime: 'image/jpeg', height: u16(b, i + 5), width: u16(b, i + 7) };
    }
    i += 2 + u16(b, i + 2);
  }
  return null;
}

/**
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {{ mime: 'image/png'|'image/jpeg', width: number, height: number } | null}
 *   null for anything else (GIF, WebP, SVG, truncated or corrupt data).
 */
export function sniffImage(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const info = pngInfo(bytes) ?? jpegInfo(bytes);
  return info && info.width > 0 && info.height > 0 ? info : null;
}

/**
 * Default placed size in points for an image of `width` × `height` px:
 * 1px = 1pt (72 dpi), shrunk to fit within `fraction` of the page.
 */
export function defaultImageSize({ width, height }, pageSize, fraction = 0.4) {
  const scale = Math.min(
    1,
    (pageSize.width * fraction) / width,
    (pageSize.height * fraction) / height
  );
  return { width: width * scale, height: height * scale };
}
