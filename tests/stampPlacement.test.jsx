import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { openPdf, setupDom } from './helpers/fakePdf.jsx';
import { createStampStore } from '../src/lib/stampStore.js';
import { createImageStamp } from '../src/lib/stamps.js';

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

// A transparent RGBA signature, 260 × 90 px (as saved by draw/photo input).
const SIGNATURE_PNG = new Uint8Array(readFileSync(resolve('tests/fixtures/signature-260x90.png')));
// Placed at the realistic signing width: 160pt wide → 160 × 55.3846 pt.
const SIG_W = 160;
const SIG_H = (160 * 90) / 260;

async function letterPdf() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i += 1) doc.addPage([612, 792]);
  return new File([await doc.save()], 'contract.pdf', { type: 'application/pdf' });
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
const click = (el, x, y) => {
  pointer('pointerDown', el, x, y);
  pointer('pointerUp', el, x, y);
};
function drag(handleOrBox, layer, from, to) {
  pointer('pointerDown', handleOrBox, from.x, from.y);
  pointer('pointerMove', layer, to.x, to.y);
  pointer('pointerUp', layer, to.x, to.y);
}

const box = (el) => ({
  left: parseFloat(el.style.left),
  top: parseFloat(el.style.top),
  width: parseFloat(el.style.width),
  height: parseFloat(el.style.height),
});
const expectBox = (el, expected) => {
  const actual = box(el);
  for (const k of Object.keys(expected)) expect(actual[k]).toBeCloseTo(expected[k], 4);
};
const expectMatrix = (actual, expected) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 3));

/** Open the PDF and the stamps panel; return the page's annotation layer. */
async function setUp(user) {
  await openPdf(App, user, await letterPdf());
  await user.click(screen.getByRole('button', { name: 'Stamps' }));
  const panel = screen.getByRole('complementary', { name: 'Stamps' });
  await within(panel).findByRole('button', { name: 'My signature' });
  const layer = await screen.findByRole('group', { name: /^Annotations on page/ });
  return { panel, layer };
}

/** Export, then return the downloaded bytes. */
async function exportBytes(user) {
  await user.click(screen.getByRole('button', { name: 'Export PDF' }));
  await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
  return downloadBytes.mock.calls[0][0];
}

/** Matrices mapping each drawn image's unit square onto page 1 (via pdf.js). */
async function imageMatrices(bytes) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await pdf.getPage(1);
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
  const found = [];
  fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, argsArray[i]);
    else if (fn === OPS.paintImageXObject) found.push(ctm);
  });
  await pdf.destroy();
  return found;
}

/**
 * The distinct image objects on page 1, with their soft-mask (alpha) bytes.
 * (pdf-lib adds a resource name per drawImage call; names can share one
 * stored image, so dedupe by object reference.)
 */
async function pageImages(bytes) {
  const doc = await PDFDocument.load(bytes);
  const xobjects = doc.getPages()[0].node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  const refs = [...new Map(xobjects.values().map((ref) => [String(ref), ref])).values()];
  return refs.map((ref) => {
    const stream = doc.context.lookup(ref);
    const smaskRef = stream.dict.get(PDFName.of('SMask'));
    const smask = smaskRef && doc.context.lookup(smaskRef);
    return {
      width: stream.dict.get(PDFName.of('Width')).asNumber(),
      height: stream.dict.get(PDFName.of('Height')).asNumber(),
      alpha: smask && new Uint8Array(inflateSync(smask.contents)),
    };
  });
}

describe('placing stamps', () => {
  beforeEach(async () => {
    setupDom();
    downloadBytes.mockClear();
    globalThis.indexedDB = new IDBFactory();
    // A saved signature in the library, as a previous session would leave it.
    const store = createStampStore(globalThis.indexedDB);
    await store.add(createImageStamp(SIGNATURE_PNG, { name: 'My signature' }));
    await store.close();
  });
  afterEach(() => vi.restoreAllMocks());

  it('places a saved signature and exports it at the right spot, transparent', async () => {
    const user = userEvent.setup();
    const { panel, layer } = await setUp(user);

    await user.click(within(panel).getByRole('button', { name: 'My signature' }));
    click(layer, 300, 500);

    // Realistic signing width, centred on the click.
    const placed = screen.getByRole('button', { name: 'Signature 1: My signature' });
    expectBox(placed, { left: 300 - SIG_W / 2, top: 500 - SIG_H / 2, width: SIG_W, height: SIG_H });

    const bytes = await exportBytes(user);

    // Position & size: unit square → x 220…380, bottom at 792 − 472.31 − 55.38.
    const [m] = await imageMatrices(bytes);
    expectMatrix(m, [SIG_W, 0, 0, SIG_H, 220, 792 - (500 - SIG_H / 2) - SIG_H]);

    // Transparency: embedded at full resolution with an alpha soft mask —
    // paper fully transparent (corners), ink fully opaque.
    const [image] = await pageImages(bytes);
    expect([image.width, image.height]).toEqual([260, 90]);
    expect(image.alpha).toHaveLength(260 * 90);
    for (const i of [0, 259, 260 * 89, 260 * 90 - 1]) expect(image.alpha[i]).toBe(0);
    const opaque = image.alpha.filter((a) => a === 255).length;
    const clear = image.alpha.filter((a) => a === 0).length;
    expect(opaque).toBeGreaterThan(500);
    expect(clear / image.alpha.length).toBeGreaterThan(0.8);
  });

  it('moves and resizes a placed signature proportionally; the export follows', async () => {
    const user = userEvent.setup();
    const { panel, layer } = await setUp(user);
    await user.click(within(panel).getByRole('button', { name: 'My signature' }));
    click(layer, 300, 500); // 220, 472.31, 160 × 55.38
    const sig = () => screen.getByRole('button', { name: 'Signature 1: My signature' });

    drag(sig(), layer, { x: 300, y: 500 }, { x: 340, y: 560 }); // move +40, +60
    expectBox(sig(), { left: 260, top: 532.3077 });

    // Drag the bottom-right handle 80px right: ×1.5, top-left stays put.
    const se = sig().querySelector('[data-handle="se"]');
    drag(se, layer, { x: 420, y: 587.69 }, { x: 500, y: 587.69 });
    expectBox(sig(), { left: 260, top: 532.3077, width: SIG_W * 1.5, height: SIG_H * 1.5 });

    const [m] = await imageMatrices(await exportBytes(user));
    expectMatrix(m, [SIG_W * 1.5, 0, 0, SIG_H * 1.5, 260, 792 - 532.3077 - SIG_H * 1.5]);
  });

  it('embeds a signature placed twice only once', async () => {
    const user = userEvent.setup();
    const { panel, layer } = await setUp(user);
    await user.click(within(panel).getByRole('button', { name: 'My signature' }));
    click(layer, 200, 200);
    await user.click(within(panel).getByRole('button', { name: 'My signature' })); // one-shot: re-select
    click(layer, 400, 600);
    expect(screen.getByRole('button', { name: 'Signature 2: My signature' })).toBeInTheDocument();

    const bytes = await exportBytes(user);
    expect(await imageMatrices(bytes)).toHaveLength(2); // drawn twice…
    expect(await pageImages(bytes)).toHaveLength(1); // …stored once
  });

  it('places a signature upright on a rotated page', async () => {
    const user = userEvent.setup();
    const { panel } = await setUp(user);
    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));
    const layer = await screen.findByRole('group', { name: /^Annotations on page/ });
    await user.click(within(panel).getByRole('button', { name: 'My signature' }));
    click(layer, 300, 200);

    // Shown sideways (792 × 612): same signing width, centred. At 90° px
    // (x, y) ↔ PDF (y, x); the image is drawn rotated 90° CCW about its own
    // bottom-left, which is PDF (227.69, 220).
    const [m] = await imageMatrices(await exportBytes(user));
    expectMatrix(m, [0, SIG_W, -SIG_H, 0, 200 + SIG_H / 2, 220]);
  });

  it('resizes a tick stamp by scaling its font size, and exports it at that size', async () => {
    const user = userEvent.setup();
    const { panel, layer } = await setUp(user);
    await user.click(within(panel).getByRole('button', { name: 'Tick' }));
    click(layer, 100, 100);
    layer.focus();
    await user.keyboard('{Escape}'); // stop placing ticks

    // 24pt ZapfDingbats: 20.4 × 28.8 (jsdom width estimate), centred.
    const tick = () => screen.getByRole('button', { name: 'Tick 1' });
    expectBox(tick(), { left: 89.8, top: 85.6, width: 20.4, height: 28.8 });
    pointer('pointerDown', tick(), 100, 100); // select
    pointer('pointerUp', layer, 100, 100);
    const se = tick().querySelector('[data-handle="se"]');
    expect(se).not.toBeNull();
    drag(se, layer, { x: 110.2, y: 114.4 }, { x: 130.6, y: 114.4 }); // twice as wide
    expectBox(tick(), { left: 89.8, top: 85.6, width: 40.8, height: 57.6 });

    const bytes = await exportBytes(user);
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
    }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items;
    const glyph = items.find((i) => i.str === '4'); // ZapfDingbats code for ✔
    // 48pt now; baseline from the top-left (89.8, 706.4): (57.6 − 46.224)/2 + 39.36.
    expect(glyph.transform[0]).toBeCloseTo(48, 3);
    expect(glyph.transform[4]).toBeCloseTo(89.8, 2);
    expect(glyph.transform[5]).toBeCloseTo(706.4 - 45.048, 2);
    await pdf.destroy();
  });

  it('keeps tick and initials stamps from being edited as text', async () => {
    const user = userEvent.setup();
    const { panel, layer } = await setUp(user);
    await user.click(within(panel).getByRole('button', { name: 'Cross' }));
    click(layer, 150, 150);
    layer.focus();
    await user.keyboard('{Escape}');

    const cross = screen.getByRole('button', { name: 'Cross 1' });
    await user.dblClick(cross);
    expect(screen.queryByRole('textbox', { name: 'Text' })).toBeNull();
    cross.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('textbox', { name: 'Text' })).toBeNull();
    // Selected, but no font controls (they'd break the symbol).
    expect(cross).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('group', { name: 'Text formatting' })).toBeNull();
  });
});
