import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { openPdf, setupDom, thumb } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)), loadPdfData: vi.fn() };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

const { downloadBytes } = await import('../src/lib/download.js');
const { default: App } = await import('../src/App.jsx');

let pdfjs;
let helvetica;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  helvetica = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
});

async function letterPdf() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i += 1) doc.addPage([612, 792]);
  return new File([await doc.save()], 'report.pdf', { type: 'application/pdf' });
}

// Helvetica 10pt, ½-ish inch margin: baseline 8.555pt below the box top.
const BASELINE = (12 - 9.25) / 2 + 7.18;
const BOTTOM_Y = 28 + 12 - BASELINE;

async function openNumbers(user) {
  await user.click(screen.getByRole('button', { name: /^Page numbers…/ }));
  return screen.getByRole('dialog', { name: 'Page numbers' });
}

/** Configure and apply numbering. */
async function applyNumbers(user, { format, position, start, skipFirst } = {}) {
  const dialog = await openNumbers(user);
  if (format) await user.selectOptions(within(dialog).getByLabelText('Format'), format);
  if (position) {
    await user.click(within(dialog).getByRole('radio', { name: position }).closest('label'));
  }
  if (start !== undefined) {
    const input = within(dialog).getByLabelText('Start at');
    await user.clear(input);
    await user.type(input, String(start));
  }
  if (skipFirst) await user.click(within(dialog).getByLabelText(/Don’t number the first page/));
  await user.click(within(dialog).getByRole('button', { name: /(Add page numbers|Update numbers)/ }));
}

/** Export (or extract) and return each page's text items from pdf.js. */
async function readDownload(index = 0) {
  await waitFor(() => expect(downloadBytes.mock.calls.length).toBeGreaterThan(index));
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(downloadBytes.mock.calls[index][0]),
    disableFontFace: true,
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
  }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const { items } = await (await pdf.getPage(n)).getTextContent();
    pages.push(items.filter((i) => i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] })));
  }
  await pdf.destroy();
  return pages;
}

describe('page numbering', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('numbers every page in the chosen format and position, previewed and exported', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await applyNumbers(user, { format: 'page-n-of-total', position: 'Bottom right' });

    expect(screen.getByRole('button', { name: /^Page numbers…/ })).toHaveTextContent('On');
    // Preview on the page being viewed.
    expect(await screen.findByRole('note', { name: 'Page number: Page 1 of 4' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('note', { name: 'Page number: Page 2 of 4' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const pages = await readDownload();
    expect(pages).toHaveLength(4);
    pages.forEach((items, i) => {
      const label = `Page ${i + 1} of 4`;
      expect(items.map((it) => it.str)).toEqual([label]);
      // Bottom right: right edge 28pt in, box bottom 28pt up.
      expect(items[0].x).toBeCloseTo(612 - 28 - helvetica.widthOfTextAtSize(label, 10), 2);
      expect(items[0].y).toBeCloseTo(BOTTOM_Y, 2);
    });
  });

  it('renumbers when pages are deleted', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await applyNumbers(user, { format: 'n-slash-total' });

    await user.click(thumb(2));
    await user.keyboard('{Delete}');
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete page' }));

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const pages = await readDownload();
    expect(pages.map((items) => items.map((it) => it.str))).toEqual([['1 / 3'], ['2 / 3'], ['3 / 3']]);
    // Bottom centre by default.
    expect(pages[0][0].x).toBeCloseTo((612 - helvetica.widthOfTextAtSize('1 / 3', 10)) / 2, 2);
  });

  it('starts from a chosen number and can skip the cover page', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await applyNumbers(user, { start: 5, skipFirst: true, position: 'Top centre' });

    // Page 1 is the cover: no number shown.
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const pages = await readDownload();
    expect(pages.map((items) => items.map((it) => it.str))).toEqual([[], ['6'], ['7'], ['8']]);
    expect(pages[1][0].y).toBeCloseTo(792 - 28 - BASELINE, 2); // top
  });

  it('keeps document numbering on extracted pages', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await applyNumbers(user, { format: 'page-n-of-total' });

    await user.click(screen.getByRole('button', { name: 'Extract pages…' }));
    const dialog = screen.getByRole('dialog', { name: 'Extract pages' });
    const input = within(dialog).getByLabelText(/^Pages/);
    await user.clear(input);
    await user.type(input, '3-4{Enter}');
    const pages = await readDownload();
    expect(pages.map((items) => items.map((it) => it.str))).toEqual([['Page 3 of 4'], ['Page 4 of 4']]);
  });

  it('can be removed, and rejects an invalid start number', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await applyNumbers(user, {});
    expect(await screen.findByRole('note', { name: 'Page number: 1' })).toBeInTheDocument();

    const dialog = await openNumbers(user);
    await user.clear(within(dialog).getByLabelText('Start at'));
    expect(within(dialog).getByRole('button', { name: 'Update numbers' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Remove page numbers' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: /^Page numbers…/ })).not.toHaveTextContent('On');

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect((await readDownload()).every((items) => items.length === 0)).toBe(true);
  });
});
