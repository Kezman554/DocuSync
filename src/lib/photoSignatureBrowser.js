/**
 * Browser-side glue for the photo → signature pipeline: decode a photo into
 * pixels and encode the result as PNG. The transform itself is pure and
 * lives in photoSignature.js. Everything runs locally.
 */
import { pngHasAlpha } from './signature.js';

/** Longest side photos are scaled down to before processing (px). */
export const MAX_PHOTO_SIDE = 1600;

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    // 'from-image' applies the camera's EXIF orientation, so phone photos
    // come out upright (we're producing a new PNG, so that's what we want).
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  // Fallback: decode through an <img>.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode a photo File into RGBA pixels, scaled so its longest side is at
 * most `maxSide`. Rejects with a friendly message for undecodable files
 * (e.g. HEIC in most browsers).
 */
export async function decodePhoto(file, maxSide = MAX_PHOTO_SIDE) {
  let bitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    throw new Error('That photo couldn’t be read. Try a JPG or PNG.');
  }
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

/** Draw RGBA pixels into a canvas (also used for the on-screen preview). */
export function paintPixels(canvas, { data, width, height }) {
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
}

/** Encode RGBA pixels as PNG bytes (keeping transparency). */
export async function encodePng(pixels) {
  const canvas = document.createElement('canvas');
  paintPixels(canvas, pixels);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!pngHasAlpha(bytes)) throw new Error('This browser exported the signature without transparency');
  return bytes;
}
