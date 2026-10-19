/**
 * Browser environment for flatten.js: pdf.js from pdfLoader.js, a DOM
 * canvas, and the browser's PNG/JPEG encoders. Nothing leaves the device.
 */
import { loadPdfData } from './pdfLoader.js';
import { flattenPages } from './flatten.js';

/**
 * JPEG quality for flattened pages. Text pages usually come out smaller as
 * PNG (and crisper); scans and photos as JPEG — both are tried per page.
 */
const JPEG_QUALITY = 0.85;

function toBytes(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? blob.arrayBuffer().then((buf) => resolve({ bytes: new Uint8Array(buf), mime }))
          : reject(new Error('The page was too large to flatten')),
      mime,
      quality
    );
  });
}

const browserEnv = {
  loadPdf: (bytes) => loadPdfData(bytes),
  createCanvas: (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  encode: (canvas) =>
    Promise.all([toBytes(canvas, 'image/png'), toBytes(canvas, 'image/jpeg', JPEG_QUALITY)]),
};

/** buildPdf's `flatten` option, for the browser. */
export const flattenInBrowser = (pdfBytes, jobs) => flattenPages(pdfBytes, jobs, browserEnv);
