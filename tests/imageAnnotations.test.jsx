import { createEvent, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { openPdf, setupDom } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

const { downloadBytes } = await import('../src/lib/download.js');
const { default: App } = await import('../src/App.jsx');

let pdfjs;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});

// jsdom's import.meta.url isn't a file: URL, so resolve from the project root.
const fixtureFile = (name, type) =>
  new File([readFileSync(resolve('tests/fixtures', name))], name, { type });
const PHOTO = () => fixtureFile('photo-400x300.jpg', 'image/jpeg'); // 4:3
const LOGO = () => fixtureFile('logo-200x100.png', 'image/png');

/** 4 blank US Letter pages — matching the fake pdf.js page geometry. */
async function letterPdf() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i += 1) doc.addPage([612, 792]);
  return new File([await doc.save()], 'sample.pdf', { type: 'application/pdf' });
}

function pointer(type, el, x, y) {
  const event = createEvent[type](el, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    pointerId: { value: 1 },
    button: { value: 0 },
  });
  fireEvent(el, event);
}

const layer = () => screen.findByRole('group', { name: /^Annotations on page/ });
const imageBox = (n = 1) => screen.getByRole('button', { name: `Image ${n}` });
const box = (el) => ({
  left: parseFloat(el.style.left),
  top: parseFloat(el.style.top),
  width: parseFloat(el.style.width),
  height: parseFloat(el.style.height),
});
const expectBox = (el, expected) => {
  const actual = box(el);
  for (const k of Object.keys(expected)) expect(actual[k]).toBeCloseTo(expected[k], 6);
};

async function chooseImage(user, file) {
  await user.upload(screen.getByLabelText('Choose image'), file);
}

/** Choose an image, then click (or drag from → to) on the page to place it. */
async function placeImage(user, file, from, to = from) {
  await chooseImage(user, file);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Add image' })).toHaveAttribute('aria-pressed', 'true')
  );
  const el = await layer();
  pointer('pointerDown', el, from.x, from.y);
  if (to !== from) pointer('pointerMove', el, to.x, to.y);
  pointer('pointerUp', el, to.x, to.y);
}

/**
 * Export and return, per image drawn on `pageNumber`, the matrix mapping the
 * image's unit square onto the page ([a b c d e f]) — recovered by replaying
 * pdf.js's operator list — plus the page's /Rotate.
 */
async function exportedImages(user, pageNumber = 1) {
  await user.click(screen.getByRole('button', { name: 'Export PDF' }));
  await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
  const [bytes] = downloadBytes.mock.calls[0];
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await pdf.getPage(pageNumber);
  const { fnArray, argsArray } = await page.getOperatorList();
  const { OPS } = pdfjs;
  const mul = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [
    A * a + B * c,
    A * b + B * d,
    C * a + D * c,
    C * b + D * d,
    E * a + F * c + e,
    E * b + F * d + f,
  ];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const matrices = [];
  fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, argsArray[i]);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) matrices.push(ctm);
  });
  const rotate = page.rotate;
  await pdf.destroy();
  return { matrices, rotate };
}

const expectMatrix = (actual, expected) => {
  expect(actual).toHaveLength(6);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 3));
};

describe('image annotations', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('places an image by click at its default size and exports it there', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());

    // 400×300 px at 1px = 1pt, shrunk to 40% of the page width: ×0.612
    // → 244.8 × 183.6 pt, centred on the click at (300, 400).
    await placeImage(user, PHOTO(), { x: 300, y: 400 });
    expectBox(imageBox(), { left: 177.6, top: 308.2, width: 244.8, height: 183.6 });
    expect(imageBox()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Add image' })).toHaveAttribute('aria-pressed', 'false');

    const { matrices } = await exportedImages(user);
    // Bottom-left at PDF (177.6, 792 − 308.2 − 183.6 = 300.2), same size.
    expect(matrices).toHaveLength(1);
    expectMatrix(matrices[0], [244.8, 0, 0, 183.6, 177.6, 300.2]);
  });

  it('draws an image to size by dragging, keeping its aspect ratio', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());

    // Drag 200 × 300 px: at 4:3 the taller drag wins → 400 × 300.
    await placeImage(user, PHOTO(), { x: 100, y: 100 }, { x: 300, y: 400 });
    expectBox(imageBox(), { left: 100, top: 100, width: 400, height: 300 });

    const { matrices } = await exportedImages(user);
    expectMatrix(matrices[0], [400, 0, 0, 300, 100, 392]);
  });

  it('scales proportionally from a corner handle and exports the new size', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await placeImage(user, PHOTO(), { x: 100, y: 100 }, { x: 300, y: 400 }); // 100,100 400×300
    const el = await layer();

    const se = document.querySelector('[data-handle="se"]');
    pointer('pointerDown', se, 500, 400);
    pointer('pointerMove', el, 600, 410); // +100 wide → ×1.25
    pointer('pointerUp', el, 600, 410);
    expectBox(imageBox(), { left: 100, top: 100, width: 500, height: 375 });

    const { matrices } = await exportedImages(user);
    expectMatrix(matrices[0], [500, 0, 0, 375, 100, 792 - 100 - 375]);
  });

  it('moves an image by dragging and stays anchored across zoom', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await placeImage(user, LOGO(), { x: 200, y: 200 }); // 200×100 pt, at 100,150
    expectBox(imageBox(), { left: 100, top: 150, width: 200, height: 100 });
    const el = await layer();

    pointer('pointerDown', imageBox(), 150, 175);
    pointer('pointerMove', el, 200, 275);
    pointer('pointerUp', el, 200, 275);
    expectBox(imageBox(), { left: 150, top: 250 });

    await user.click(screen.getByRole('button', { name: 'Zoom in' })); // 125%
    expectBox(imageBox(), { left: 187.5, top: 312.5, width: 250, height: 125 });

    const { matrices } = await exportedImages(user);
    expectMatrix(matrices[0], [200, 0, 0, 100, 150, 792 - 250 - 100]);
  });

  it('places an image upright on a rotated page and exports it rotated to match', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));

    // Shown 792 × 612: default 400×300 × 0.792 = 316.8 × 237.6, centred on
    // (300, 200) → px rect 141.6, 81.2. At 90° px (x, y) ↔ PDF (y, x), so
    // PDF bounds x 81.2–318.8, y 141.6–458.4.
    await placeImage(user, PHOTO(), { x: 300, y: 200 });
    expectBox(imageBox(), { left: 141.6, top: 81.2, width: 316.8, height: 237.6 });

    const { matrices, rotate } = await exportedImages(user);
    expect(rotate).toBe(90);
    // Own bottom-left at (318.8, 141.6); width runs up the page, height −x.
    expectMatrix(matrices[0], [0, 316.8, -237.6, 0, 318.8, 141.6]);
  });

  it('turns with the page when the page is rotated after placing', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await placeImage(user, LOGO(), { x: 200, y: 200 });
    const content = () => imageBox().querySelector('.annotation__content');
    expect(content().dataset.turn).toBe('0');

    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));
    expect(content().dataset.turn).toBe('90');
    // Sideways now: on-screen bounds swap.
    expect(box(imageBox())).toMatchObject({ width: 100, height: 200 });

    const { matrices } = await exportedImages(user);
    expectMatrix(matrices[0], [200, 0, 0, 100, 100, 792 - 150 - 100]); // PDF unchanged
  });

  it('rejects files that aren’t PNG or JPG, whatever their name', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await openPdf(App, user, await letterPdf());
    await chooseImage(user, fixtureFile('not-supported.gif', 'image/png'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('isn’t a PNG or JPG image');
    expect(screen.getByRole('button', { name: 'Add image' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Escape cancels placing; Delete removes a placed image', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await chooseImage(user, PHOTO());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add image' })).toHaveAttribute('aria-pressed', 'true')
    );
    (await layer()).focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Add image' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /^Image/ })).toBeNull();

    await placeImage(user, PHOTO(), { x: 300, y: 400 });
    imageBox().focus();
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('button', { name: /^Image/ })).toBeNull();
  });
});
