/**
 * Browser-side export of a drawn signature to a transparent PNG.
 *
 * The pad canvas has a transparent background (signature_pad's default), so
 * only the ink is opaque. We copy just the inked region (lib/signature.js
 * strokeBounds) at the pad's backing resolution into a fresh canvas and
 * encode it with the browser's PNG encoder. Nothing leaves the device.
 */
import { pngHasAlpha, strokeBounds } from './signature.js';

/**
 * @param {HTMLCanvasElement} padCanvas   the signature_pad canvas
 * @param {Array} data                    signature_pad toData()
 * @param {number} ratio                  backing pixels per CSS pixel
 * @returns {Promise<Uint8Array>} PNG bytes, cropped to the signature
 */
export async function exportSignaturePng(padCanvas, data, ratio) {
  const cssWidth = padCanvas.width / ratio;
  const cssHeight = padCanvas.height / ratio;
  const bounds = strokeBounds(data, { width: cssWidth, height: cssHeight });
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Draw your signature first');
  }

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(bounds.width * ratio));
  out.height = Math.max(1, Math.round(bounds.height * ratio));
  const ctx = out.getContext('2d');
  ctx.clearRect(0, 0, out.width, out.height); // stays transparent
  ctx.drawImage(
    padCanvas,
    Math.round(bounds.x * ratio),
    Math.round(bounds.y * ratio),
    out.width,
    out.height,
    0,
    0,
    out.width,
    out.height
  );

  const blob = await new Promise((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!pngHasAlpha(bytes)) {
    // Every current browser keeps alpha here; refuse rather than save a white box.
    throw new Error('This browser exported the signature without transparency');
  }
  return bytes;
}
