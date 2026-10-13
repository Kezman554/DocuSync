/**
 * Browser-side preparation of uploaded image files for images → PDF.
 *
 * PNG and JPEG are used as-is (no recompression; JPEG EXIF orientation is
 * read and applied when drawing). Any other format the browser can decode
 * (WebP, GIF, BMP, AVIF…) is converted to PNG via a canvas — decoded with
 * EXIF orientation already applied.
 */
import { sniffImage } from './imageInfo.js';
import { exifOrientation } from './imagesToPdf.js';

/**
 * @returns {Promise<{ name, bytes, mime, width, height, orientation }>}
 *   width/height are the STORED pixel size
 */
export async function prepareImageFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = sniffImage(bytes);
  if (info) {
    return {
      name: file.name,
      bytes,
      mime: info.mime,
      width: info.width,
      height: info.height,
      orientation: info.mime === 'image/jpeg' ? exifOrientation(bytes) : 1,
    };
  }
  return convertToPng(file, bytes);
}

async function convertToPng(file, bytes) {
  let bitmap;
  try {
    if (typeof createImageBitmap !== 'function') throw new Error('unsupported');
    bitmap = await createImageBitmap(new Blob([bytes], { type: file.type }), {
      imageOrientation: 'from-image',
    });
  } catch {
    throw new Error('isn’t an image this browser can read');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('couldn’t be converted'))), 'image/png');
  });
  return {
    name: file.name,
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mime: 'image/png',
    width: canvas.width,
    height: canvas.height,
    orientation: 1,
  };
}
