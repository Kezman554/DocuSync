/**
 * Flatten pages for redaction: render each page with pdf.js, paint its
 * redaction boxes solid black on the canvas, and encode the pixels.
 *
 * The caller (exportPdf.buildPdf) hands over a staging PDF holding only the
 * pages to flatten, already carrying DocuSync's annotations, watermark and
 * page number, so those are baked into the pixels and covered by the boxes
 * like everything else. Pages are rendered UNROTATED; the export sets the
 * page's rotation on the rebuilt page.
 *
 * pdf.js and the canvas are injected (`env`) so the same code runs in the
 * browser (flattenBrowser.js) and under Node in tests.
 */
import { pageBoxFromView } from './coords.js';
import { renderScale } from './imageExport.js';
import { REDACTION_DPI, redactionPixelRect } from './redaction.js';

// pdf.js AnnotationMode.ENABLE: draw every annotation's appearance (form
// field values, stamps, link borders) into the pixels, so a box covers
// those too. Nothing of the annotations survives except as pixels.
const ANNOTATIONS_AS_PIXELS = 1;

/**
 * @param {Uint8Array} pdfBytes staging PDF, one page per job, in order
 * @param {{ rects: { x, y, width, height }[] }[]} jobs each page's boxes,
 *   in that page's PDF space
 * @param {{ loadPdf: (bytes) => Promise<object>,
 *           createCanvas: (width, height) => object,
 *           encode: (canvas) => Promise<{ bytes: Uint8Array, mime: string }[]>,
 *           dpi?: number }} env
 *   `encode` returns candidate encodings (e.g. PNG and JPEG); the smallest is kept
 * @returns {Promise<{ bytes: Uint8Array, mime: string, width: number, height: number }[]>}
 *   one image per job; width/height are the page's visible size in points
 */
export async function flattenPages(pdfBytes, jobs, env) {
  const { loadPdf, createCanvas, encode, dpi = REDACTION_DPI } = env;
  const pdf = await loadPdf(pdfBytes);
  const images = [];
  try {
    if (pdf.numPages !== jobs.length) {
      throw new Error(`Expected ${jobs.length} pages to flatten, got ${pdf.numPages}`);
    }
    for (const [k, job] of jobs.entries()) {
      const page = await pdf.getPage(k + 1);
      const pageBox = pageBoxFromView(page.view);
      const scale = renderScale(pageBox.width, pageBox.height, dpi);
      const viewport = page.getViewport({ scale, rotation: 0 });

      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: ctx,
        viewport,
        background: 'rgb(255,255,255)',
        annotationMode: ANNOTATIONS_AS_PIXELS,
      }).promise;
      page.cleanup();

      ctx.fillStyle = '#000000';
      for (const rect of job.rects) {
        const px = redactionPixelRect(rect, pageBox, scale, canvas);
        if (px) ctx.fillRect(px.x, px.y, px.width, px.height);
      }

      const candidates = await encode(canvas);
      const best = candidates.reduce((a, b) => (b.bytes.length < a.bytes.length ? b : a));
      images.push({ ...best, width: pageBox.width, height: pageBox.height });
      // Free the backing store before the next page.
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    pdf.destroy();
  }
  return images;
}
