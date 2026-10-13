/**
 * Browser-side image encoder for compress.js: decode a PDF image (JPEG
 * bytes or RGBA pixels), scale it so the longest side fits `maxSide`, and
 * re-encode it as JPEG with a canvas. Everything runs locally.
 */

async function toBitmap(input) {
  if (input.type === 'jpeg') {
    // 'none': PDF viewers ignore EXIF orientation, so must we (compress.js
    // also strips EXIF before handing the bytes over).
    return createImageBitmap(new Blob([input.bytes], { type: 'image/jpeg' }), {
      imageOrientation: 'none',
    });
  }
  const image = new ImageData(input.data, input.width, input.height);
  return createImageBitmap(image);
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encoding failed'))),
      'image/jpeg',
      quality
    );
  });
}

/** See compressPdf's `encodeImage`. Resolves null if the image can't be decoded. */
export async function encodeImageAsJpeg(input, { quality, maxSide }) {
  let bitmap;
  try {
    bitmap = await toBitmap(input);
  } catch {
    return null; // the browser can't decode it — leave it as it is
  }
  // Trust the decoded size; a JPEG's header wins over a mismatched PDF dict.
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  if (srcW !== input.width || srcH !== input.height) {
    bitmap.close?.();
    return null;
  }
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await canvasToJpeg(canvas, quality);
  canvas.width = 0; // release the backing store promptly
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}
