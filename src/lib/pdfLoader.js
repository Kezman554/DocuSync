/**
 * Thin wrapper around pdf.js document loading.
 *
 * pdf.js is imported lazily so the (DOM-heavy) library and its worker are only
 * pulled in when a PDF is actually opened — keeping it out of the synchronous
 * module graph that unit tests render through.
 */

let pdfjsPromise = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      const workerUrl = (
        await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

/**
 * Read a File into memory and return a pdf.js PDFDocumentProxy.
 * All processing is local — the bytes never leave the browser.
 */
export async function loadPdfDocument(file) {
  const pdfjsLib = await getPdfjs();
  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data });
  return loadingTask.promise;
}
