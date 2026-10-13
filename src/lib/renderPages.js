/**
 * Browser-side: rasterise PDF pages to PNG/JPG with pdf.js.
 *
 * Takes the bytes of a built PDF (see exportPdf.buildPdf), so the images
 * show exactly what an export would — page order, rotation, and baked-in
 * text, images and stamps. Pages are rendered one at a time onto a white
 * background and encoded with the browser's image encoder; nothing leaves
 * the device.
 */
import { loadPdfData } from './pdfLoader.js';
import { IMAGE_FORMATS, renderScale } from './imageExport.js';

/**
 * @param {Uint8Array} pdfBytes
 * @param {{ format: 'png'|'jpeg', dpi: number, onProgress?: (done, total) => void,
 *           signal?: AbortSignal }} options
 * @returns {Promise<{ bytes: Uint8Array, width: number, height: number }[]>}
 */
export async function renderPdfToImages(pdfBytes, { format, dpi, onProgress, signal }) {
  const { mime, quality } = IMAGE_FORMATS[format];
  const pdf = await loadPdfData(pdfBytes);
  const images = [];
  try {
    for (let n = 1; n <= pdf.numPages; n += 1) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 }); // includes the page's /Rotate
      const viewport = page.getViewport({ scale: renderScale(base.width, base.height, dpi) });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      // Paper: white, so JPG has no black background and PNG isn't see-through.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, background: 'rgb(255,255,255)' }).promise;
      page.cleanup();

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('The page was too large to save as an image'))),
          mime,
          quality
        );
      });
      images.push({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: canvas.width,
        height: canvas.height,
      });
      // Free the backing store before the next page.
      canvas.width = 0;
      canvas.height = 0;
      onProgress?.(n, pdf.numPages);
    }
  } finally {
    pdf.destroy();
  }
  return images;
}
