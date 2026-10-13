import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { openPdf, setupDom } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)), loadPdfData: vi.fn() };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

const { downloadBytes } = await import('../src/lib/download.js');
const { default: App } = await import('../src/App.jsx');

let pdfjs;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});

async function letterPdf() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i += 1) doc.addPage([612, 792]);
  return new File([await doc.save()], 'report.pdf', { type: 'application/pdf' });
}

async function openWatermark(user) {
  await user.click(screen.getByRole('button', { name: /^Watermark…/ }));
  return screen.getByRole('dialog', { name: 'Watermark' });
}

/** Export and read back, per page: text (with angle), fill opacities, image paints. */
async function exportAndRead(user) {
  await user.click(screen.getByRole('button', { name: 'Export PDF' }));
  await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(downloadBytes.mock.calls[0][0]),
    disableFontFace: true,
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
  }).promise;
  const { OPS } = pdfjs;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const { items } = await page.getTextContent();
    const { fnArray, argsArray } = await page.getOperatorList();
    const opacity = [];
    let images = 0;
    fnArray.forEach((fn, i) => {
      if (fn === OPS.setGState) {
        for (const [key, value] of argsArray[i][0]) if (key === 'ca') opacity.push(value);
      }
      if (fn === OPS.paintImageXObject) images += 1;
    });
    pages.push({
      text: items
        .filter((it) => it.str.trim())
        .map((it) => ({
          str: it.str,
          angle: Math.round((Math.atan2(it.transform[1], it.transform[0]) * 180) / Math.PI),
        })),
      opacity,
      images,
    });
  }
  await pdf.destroy();
  return pages;
}

describe('watermark', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('applies a DRAFT watermark to every page at 25% opacity and 45°', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    const dialog = await openWatermark(user);
    expect(within(dialog).getByLabelText('Watermark text')).toHaveValue('DRAFT');
    expect(within(dialog).getByText('Opacity: 25%')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add watermark' }));

    // Previewed on the page, see-through and angled.
    const preview = await screen.findByRole('note', { name: 'Watermark: DRAFT' });
    expect(preview.style.opacity).toBe('0.25');
    expect(preview.style.transform).toBe('rotate(-45deg)'); // CSS turns clockwise
    expect(screen.getByRole('button', { name: /^Watermark…/ })).toHaveTextContent('On');

    const pages = await exportAndRead(user);
    expect(pages).toHaveLength(4);
    for (const page of pages) {
      expect(page.text).toEqual([{ str: 'DRAFT', angle: 45 }]);
      expect(page.opacity).toContain(0.25);
    }
  });

  it('uses custom text, opacity and angle on chosen pages only', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    const dialog = await openWatermark(user);
    const text = within(dialog).getByLabelText('Watermark text');
    await user.clear(text);
    await user.type(text, 'COPY');
    fireEvent.change(within(dialog).getByLabelText(/^Opacity/), { target: { value: '50' } });
    const angle = within(dialog).getByLabelText('Angle (°)');
    await user.clear(angle);
    await user.type(angle, '30');
    await user.click(within(dialog).getByLabelText('Watermark pages'));
    await user.type(within(dialog).getByLabelText('Watermark pages'), '2-3');
    expect(within(dialog).getByText('On 2 of 4 pages.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add watermark' }));

    // Page 1 isn't watermarked: no preview there.
    await waitFor(() => expect(screen.queryByRole('note', { name: /^Watermark/ })).toBeNull());

    const pages = await exportAndRead(user);
    expect(pages.map((p) => p.text.map((t) => `${t.str}@${t.angle}`))).toEqual([
      [],
      ['COPY@30'],
      ['COPY@30'],
      [],
    ]);
    expect(pages[1].opacity).toContain(0.5);
    expect(pages[0].opacity).toEqual([]);
  });

  it('applies an image watermark', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    const dialog = await openWatermark(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Image' }));
    expect(within(dialog).getByRole('button', { name: 'Add watermark' })).toBeDisabled();
    await user.upload(
      within(dialog).getByLabelText('Watermark image'),
      new File([readFileSync(resolve('tests/fixtures/logo-200x100.png'))], 'logo.png', { type: 'image/png' })
    );
    expect(await within(dialog).findByText('logo.png (200 × 100)')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add watermark' }));
    expect(await screen.findByRole('note', { name: 'Watermark: logo.png' })).toBeInTheDocument();

    const pages = await exportAndRead(user);
    for (const page of pages) {
      expect(page.images).toBe(1);
      expect(page.opacity).toContain(0.25);
      expect(page.text).toEqual([]);
    }
  });

  it('validates the settings and can be removed', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    let dialog = await openWatermark(user);
    const add = within(dialog).getByRole('button', { name: 'Add watermark' });
    await user.clear(within(dialog).getByLabelText('Watermark text'));
    expect(add).toBeDisabled(); // no text
    await user.type(within(dialog).getByLabelText('Watermark text'), 'DRAFT');
    await user.click(within(dialog).getByLabelText('Watermark pages'));
    await user.type(within(dialog).getByLabelText('Watermark pages'), '9');
    expect(within(dialog).getByText('Choose at least one page.')).toBeInTheDocument();
    expect(add).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: 'All pages' }));
    await user.click(add);
    expect(await screen.findByRole('note', { name: 'Watermark: DRAFT' })).toBeInTheDocument();

    dialog = await openWatermark(user);
    await user.click(within(dialog).getByRole('button', { name: 'Remove watermark' }));
    expect(screen.queryByRole('note', { name: /^Watermark/ })).toBeNull();
    const pages = await exportAndRead(user);
    expect(pages.every((p) => p.text.length === 0 && p.opacity.length === 0)).toBe(true);
  });
});
