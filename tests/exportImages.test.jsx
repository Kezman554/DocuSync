import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { openPdf, setupDom, thumb } from './helpers/fakePdf.jsx';
import { readZip } from './helpers/zip.js';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)), loadPdfData: vi.fn() };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

// jsdom can't rasterise, so the renderer is stood in for by one that reads
// the PDF it's given with pdf-lib and "renders" each page as a small JSON
// record of what it saw — page size, rotation, format and dpi. That checks
// the right pages reach the right files. (Real pdf.js rendering was checked
// in headless Edge: PNG output pixel-identical to the viewer's rendering.)
let gate = null; // optional promise to hold rendering mid-way
vi.mock('../src/lib/renderPages.js', () => ({
  renderPdfToImages: vi.fn(async (pdfBytes, { format, dpi, onProgress }) => {
    const doc = await PDFDocument.load(pdfBytes);
    const pages = doc.getPages();
    const images = [];
    for (const [i, page] of pages.entries()) {
      const record = {
        size: [Math.round(page.getWidth()), Math.round(page.getHeight())],
        rotate: page.getRotation().angle,
        format,
        dpi,
      };
      images.push({ bytes: new TextEncoder().encode(JSON.stringify(record)) });
      onProgress?.(i + 1, pages.length);
      if (gate && i === 0) await gate;
    }
    return images;
  }),
}));

const { downloadBytes } = await import('../src/lib/download.js');
const { renderPdfToImages } = await import('../src/lib/renderPages.js');
const { default: App } = await import('../src/App.jsx');

// Four pages with distinct sizes, so each can be recognised.
const SIZES = [
  [595, 842],
  [612, 792],
  [500, 700],
  [420, 595],
];
async function sizedPdf() {
  const doc = await PDFDocument.create();
  SIZES.forEach((s) => doc.addPage(s));
  return new File([await doc.save()], 'sample.pdf', { type: 'application/pdf' });
}

const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

async function openDialog(user) {
  await user.click(screen.getByRole('button', { name: 'Export images…' }));
  const dialog = screen.getByRole('dialog', { name: 'Export pages as images' });
  return { dialog, pagesInput: within(dialog).getByLabelText(/^Pages/) };
}

describe('export pages as images', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
    renderPdfToImages.mockClear();
    gate = null;
  });
  afterEach(() => vi.restoreAllMocks());

  it('downloads one page as a single image', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await sizedPdf());
    await user.click(thumb(3));

    const { dialog, pagesInput } = await openDialog(user);
    expect(pagesInput).toHaveValue('3'); // the selection
    expect(within(dialog).getByText('1 page → one PNG image')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: /^JPG/ }));
    await user.selectOptions(within(dialog).getByLabelText('Resolution'), '72');
    await user.click(within(dialog).getByRole('button', { name: 'Export image' }));

    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    const [bytes, name, mime] = downloadBytes.mock.calls[0];
    expect(name).toBe('sample-page-03.jpg');
    expect(mime).toBe('image/jpeg');
    expect(decode(bytes)).toEqual({ size: SIZES[2], rotate: 0, format: 'jpeg', dpi: 72 });
  });

  it('downloads several pages as a ZIP, in order, with edits applied', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await sizedPdf());
    // Rotate page 2, then export pages 2–4 at the default 150 dpi.
    await user.click(thumb(2));
    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));

    const { dialog, pagesInput } = await openDialog(user);
    await user.clear(pagesInput);
    await user.type(pagesInput, '2-4');
    expect(within(dialog).getByText('3 pages → a ZIP of 3 PNG images')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Export 3 images' }));

    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    const [zip, name, mime] = downloadBytes.mock.calls[0];
    expect(name).toBe('sample-pages-2-4-png.zip');
    expect(mime).toBe('application/zip');

    const files = readZip(zip); // validates headers + CRCs
    expect(files.map((f) => f.name)).toEqual([
      'sample-page-02.png',
      'sample-page-03.png',
      'sample-page-04.png',
    ]);
    expect(files.map((f) => decode(f.bytes))).toEqual([
      { size: SIZES[1], rotate: 90, format: 'png', dpi: 150 },
      { size: SIZES[2], rotate: 0, format: 'png', dpi: 150 },
      { size: SIZES[3], rotate: 0, format: 'png', dpi: 150 },
    ]);
  });

  it('numbers files by their position after reordering', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await sizedPdf());
    await user.click(thumb(4));
    await user.keyboard('{Alt>}{ArrowUp}{ArrowUp}{ArrowUp}{/Alt}'); // page 4 → first

    const { dialog, pagesInput } = await openDialog(user);
    await user.clear(pagesInput);
    await user.type(pagesInput, '1-2');
    await user.click(within(dialog).getByRole('button', { name: 'Export 2 images' }));

    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    const files = readZip(downloadBytes.mock.calls[0][0]);
    expect(files.map((f) => [f.name, decode(f.bytes).size])).toEqual([
      ['sample-page-01.png', SIZES[3]],
      ['sample-page-02.png', SIZES[0]],
    ]);
  });

  it('shows rendering progress on the export button', async () => {
    let release;
    gate = new Promise((r) => {
      release = r;
    });
    const user = userEvent.setup();
    await openPdf(App, user, await sizedPdf());
    const { dialog, pagesInput } = await openDialog(user);
    await user.clear(pagesInput);
    await user.type(pagesInput, '1-2');
    await user.click(within(dialog).getByRole('button', { name: 'Export 2 images' }));

    expect(await screen.findByRole('button', { name: 'Rendering 1/2…' })).toBeDisabled();
    release();
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
  });

  it('validates ranges and reports rendering failures', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openPdf(App, user, await sizedPdf());
    let { dialog, pagesInput } = await openDialog(user);
    await user.clear(pagesInput);
    await user.type(pagesInput, '9');
    expect(within(dialog).getByRole('button', { name: /^Export/ })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    renderPdfToImages.mockRejectedValueOnce(new Error('The page was too large to save as an image'));
    ({ dialog, pagesInput } = await openDialog(user));
    await user.click(within(dialog).getByRole('button', { name: 'Export image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t export images: The page was too large to save as an image'
    );
    expect(downloadBytes).not.toHaveBeenCalled();
  });
});
