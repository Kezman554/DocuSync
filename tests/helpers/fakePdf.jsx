import { render, screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';

/**
 * Fake pdf.js document shared by the integration tests. Records every
 * getViewport call so tests can assert what rotation each source page was
 * rendered with, without loading real pdf.js in jsdom.
 *
 * Use with:
 *   vi.mock('../src/lib/pdfLoader.js', async () => {
 *     const { fakePdf } = await import('./helpers/fakePdf.jsx');
 *     return { loadPdfDocument: async () => fakePdf };
 *   });
 */
export const NUM_PAGES = 4;
export const viewportCalls = [];

export const fakePdf = {
  numPages: NUM_PAGES,
  getPage: vi.fn(async (pageNumber) => ({
    pageNumber,
    rotate: 0, // intrinsic /Rotate of the source page — must never change
    getViewport: ({ scale, rotation = 0 }) => {
      viewportCalls.push({ pageNumber, rotation });
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

/** Rotation most recently rendered for a source page, or undefined. */
export const lastRotation = (pageNumber) =>
  viewportCalls.filter((c) => c.pageNumber === pageNumber).at(-1)?.rotation;

/** Stub what jsdom lacks; call from beforeEach (restore with vi.restoreAllMocks). */
export function setupDom() {
  viewportCalls.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
  Element.prototype.scrollIntoView ??= () => {};
}

/** Render the app, open the fake PDF and wait for the first renders. */
export async function openPdf(App, user) {
  const utils = render(<App />);
  const input = utils.container.querySelector('input[type="file"]');
  await user.upload(
    input,
    new File(['%PDF-1.7'], 'sample.pdf', { type: 'application/pdf' })
  );
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
