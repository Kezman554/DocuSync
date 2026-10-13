import { render, screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';

/**
 * Fake pdf.js documents shared by the integration tests. Each records its
 * getViewport calls so tests can assert what rotation each source page was
 * rendered with, without loading real pdf.js in jsdom.
 *
 * The mocked loader returns a fake per file name (see pdfFor):
 *   vi.mock('../src/lib/pdfLoader.js', async () => {
 *     const { pdfFor } = await import('./helpers/fakePdf.jsx');
 *     return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
 *   });
 */
export const NUM_PAGES = 4;
export const viewportCalls = [];

export function makeFakePdf(name, numPages) {
  return {
    name,
    numPages,
    getPage: vi.fn(async (pageNumber) => ({
      pageNumber,
      view: [0, 0, 612, 792], // US Letter, like the viewports below
      rotate: 0, // intrinsic /Rotate of the source page — must never change
      getViewport: ({ scale, rotation = 0 }) => {
        viewportCalls.push({ doc: name, pageNumber, rotation });
        const landscape = rotation % 180 !== 0;
        return {
          width: (landscape ? 792 : 612) * scale,
          height: (landscape ? 612 : 792) * scale,
        };
      },
      render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    })),
    destroy: vi.fn(),
  };
}

/** The primary fake: 4 pages, used for any file name not registered below. */
export const fakePdf = makeFakePdf('sample.pdf', NUM_PAGES);

/** Extra fakes keyed by file name, for merge tests. */
export const extraPdfs = {
  'extra.pdf': makeFakePdf('extra.pdf', 2),
  'broken.pdf': null, // loader rejects
  'images.pdf': makeFakePdf('images.pdf', 2), // made by images → PDF
};

export function pdfFor(file) {
  if (file.name in extraPdfs) {
    const pdf = extraPdfs[file.name];
    if (!pdf) return Promise.reject(new Error('Invalid PDF structure'));
    return pdf;
  }
  return fakePdf;
}

/** Rotation most recently rendered for a source page, or undefined. */
export const lastRotation = (pageNumber, doc = 'sample.pdf') =>
  viewportCalls
    .filter((c) => c.pageNumber === pageNumber && c.doc === doc)
    .at(-1)?.rotation;

/** Stub what jsdom lacks; call from beforeEach (restore with vi.restoreAllMocks). */
export function setupDom() {
  viewportCalls.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
  Element.prototype.scrollIntoView ??= () => {};
  // jsdom's Blob/File lacks arrayBuffer(); export re-reads the file with it.
  Blob.prototype.arrayBuffer ??= function arrayBuffer() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

/**
 * Render the app, open a PDF and wait for the first renders. pdf.js is mocked,
 * so `file` only matters to code that re-reads it (export).
 */
export async function openPdf(
  App,
  user,
  file = new File(['%PDF-1.7'], 'sample.pdf', { type: 'application/pdf' })
) {
  const utils = render(<App />);
  const input = utils.container.querySelector('input[type="file"]');
  await user.upload(input, file);
  await screen.findByText(`Page 1 of ${NUM_PAGES}`);
  // IntersectionObserver is absent in jsdom → thumbnails render eagerly.
  await waitFor(() => {
    for (let n = 1; n <= NUM_PAGES; n += 1) expect(lastRotation(n)).toBe(0);
  });
  return utils;
}

/** Thumbnail button at 1-based position `n` in the sidebar. */
export const thumb = (n) =>
  screen.getByRole('button', { name: new RegExp(`^Page ${n}\\b`) });

/** Source page numbers in current sidebar order. */
export const sidebarOrder = () =>
  Array.from(document.querySelectorAll('[data-source-page]')).map((el) =>
    Number(el.dataset.sourcePage)
  );
