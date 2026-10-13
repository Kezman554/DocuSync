import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PDFDocument,
  PDFName,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib';
import { openPdf, setupDom } from './helpers/fakePdf.jsx';
import { rng } from './helpers/syntheticPhoto.js';

const PHOTO = new Uint8Array(readFileSync(resolve(__dirname, 'fixtures', 'photo-400x300.jpg')));

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)), loadPdfData: vi.fn() };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));
// jsdom has no canvas: stand in for the browser encoder with a real JPEG.
vi.mock('../src/lib/compressBrowser.js', () => ({ encodeImageAsJpeg: vi.fn() }));

const { downloadBytes } = await import('../src/lib/download.js');
const { encodeImageAsJpeg } = await import('../src/lib/compressBrowser.js');
const { default: App } = await import('../src/App.jsx');

/** Four pages, each with a large noisy (photo-like) RGB image. */
async function scannedPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Scan');
  const random = rng(9);
  for (let i = 0; i < 4; i += 1) {
    const page = doc.addPage([612, 792]);
    const data = Uint8Array.from({ length: 600 * 400 * 3 }, () => Math.floor(random() * 256));
    const ref = doc.context.register(
      doc.context.flateStream(data, {
        Type: 'XObject', Subtype: 'Image', Width: 600, Height: 400,
        ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
      })
    );
    const name = page.node.newXObject('Im', ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(500, 0, 0, 333, 56, 400),
      drawObject(name),
      popGraphicsState()
    );
  }
  return new File([await doc.save()], 'scan.pdf', { type: 'application/pdf' });
}

async function openCompress(user) {
  await user.click(screen.getByRole('button', { name: 'Compress…' }));
  return screen.getByRole('dialog', { name: 'Compress PDF' });
}

describe('compress dialog', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
    encodeImageAsJpeg.mockReset();
    encodeImageAsJpeg.mockImplementation(async (input, { maxSide }) => {
      const scale = Math.min(1, maxSide / Math.max(input.width, input.height));
      return {
        bytes: PHOTO,
        width: Math.round(input.width * scale),
        height: Math.round(input.height * scale),
      };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('compresses with the chosen preset, downloads, and reports before/after', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await scannedPdf());
    const dialog = await openCompress(user);
    expect(within(dialog).getByRole('radio', { name: /Balanced/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Remove metadata/ })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: /Strong/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Compress & download' }));

    const done = await screen.findByRole('dialog', { name: 'Compressed copy downloaded' });
    expect(encodeImageAsJpeg).toHaveBeenCalledTimes(4);
    expect(encodeImageAsJpeg.mock.calls[0][1]).toEqual({ quality: 0.5, maxSide: 1400 });

    expect(downloadBytes).toHaveBeenCalledTimes(1);
    const [bytes, fileName] = downloadBytes.mock.calls[0];
    expect(fileName).toBe('scan-compressed.pdf');
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(out.getPageCount()).toBe(4);
    expect(out.context.trailerInfo.Info).toBeUndefined();
    const filters = out.context
      .enumerateIndirectObjects()
      .map(([, o]) => o.dict?.get(PDFName.of('Filter'))?.toString())
      .filter((f) => f === '/DCTDecode');
    expect(filters).toHaveLength(4);

    const values = within(done).getAllByRole('definition').map((d) => d.textContent);
    // Before ≈ 4 × 720 KB of noise; after ≈ 4 × 3.7 KB of JPEG.
    expect(values[0]).toMatch(/^2\.\d MB$/);
    expect(values[1]).toMatch(/KB$/);
    expect(values[2]).toBe('99%');
    expect(within(done).getByText('4 of 4 images re-encoded.')).toBeInTheDocument();

    await user.click(within(done).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps metadata when unticked', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await scannedPdf());
    const dialog = await openCompress(user);
    await user.click(within(dialog).getByRole('checkbox', { name: /Remove metadata/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Compress & download' }));
    await screen.findByRole('dialog', { name: 'Compressed copy downloaded' });
    const out = await PDFDocument.load(downloadBytes.mock.calls[0][0], { updateMetadata: false });
    expect(out.getTitle()).toBe('Scan');
  });

  it('saves the plain export when compression can’t help', async () => {
    encodeImageAsJpeg.mockResolvedValue(null); // e.g. the browser can't decode
    const user = userEvent.setup();
    await openPdf(App, user, await scannedPdf());
    const dialog = await openCompress(user);
    await user.click(within(dialog).getByRole('checkbox', { name: /Remove metadata/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Compress & download' }));
    const done = await screen.findByRole('dialog', { name: 'Compressed copy downloaded' });
    expect(within(done).getByText(/already compact/)).toBeInTheDocument();
    expect(within(done).getByText('0 of 4 images re-encoded.')).toBeInTheDocument();
    const values = within(done).getAllByRole('definition').map((d) => d.textContent);
    expect(values[0]).toBe(values[1]);
    expect(values[2]).toBe('—');
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
  });
});
