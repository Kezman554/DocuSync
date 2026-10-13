import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setupDom } from './helpers/fakePdf.jsx';
import { createStampStore } from '../src/lib/stampStore.js';
import { pngHasAlpha } from '../src/lib/signature.js';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});

const { default: App } = await import('../src/App.jsx');

// jsdom can't rasterise, so the browser's PNG encoder (canvas.toBlob) is
// stood in by a real transparent RGBA PNG. Everything else is real: the
// signature_pad library capturing strokes, our crop maths, the transparency
// check, the stamp model and IndexedDB storage. (The real encoder was also
// checked once in headless Edge: RGBA output, transparent corners, ink
// pixels in the pen colour.)
const SIGNATURE_PNG = new Uint8Array(readFileSync(resolve('tests/fixtures/signature-260x90.png')));
const OPAQUE_PNG = new Uint8Array(readFileSync(resolve('tests/fixtures/opaque-rgb-20x10.png')));

/** A 2D context that accepts every drawing call and records them. */
function recordingContext(log) {
  return new Proxy(
    {},
    {
      get: (target, prop) => (prop in target ? target[prop] : (...args) => log.push([prop, ...args])),
      set: (target, prop, value) => {
        target[prop] = value;
        return true;
      },
    }
  );
}

let encoded; // PNG the stand-in encoder returns
let exports; // canvases passed to toBlob
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

function installCanvasStandIns() {
  HTMLCanvasElement.prototype.getContext.mockImplementation(function getContext() {
    this.__log ??= [];
    this.__ctx ??= recordingContext(this.__log);
    return this.__ctx;
  });
  exports = [];
  encoded = SIGNATURE_PNG;
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
    exports.push({ canvas: this, type });
    callback(new Blob([encoded], { type: 'image/png' }));
  };
}

/** Draw one stroke through the given points with the mouse. */
function drawStroke(canvas, points) {
  const [[x0, y0], ...rest] = points;
  fireEvent.mouseDown(canvas, { clientX: x0, clientY: y0, buttons: 1 });
  for (const [x, y] of rest) fireEvent.mouseMove(canvas, { clientX: x, clientY: y, buttons: 1 });
  const [xn, yn] = points.at(-1);
  fireEvent.mouseUp(canvas, { clientX: xn, clientY: yn, buttons: 0 });
}

const DIAGONAL = [[50, 150], [100, 132], [150, 114], [200, 96], [250, 78], [300, 60]];

async function openSignatureDialog(user) {
  await user.click(screen.getByRole('button', { name: 'Stamps' }));
  const panel = screen.getByRole('complementary', { name: 'Stamps' });
  await waitFor(() => expect(within(panel).queryByText('Loading your stamps…')).toBeNull());
  await user.click(within(panel).getByRole('button', { name: 'Draw signature…' }));
  const dialog = screen.getByRole('dialog', { name: 'Draw your signature' });
  return { panel, dialog, canvas: within(dialog).getByLabelText('Signature drawing area') };
}

describe('draw a signature', () => {
  beforeEach(() => {
    setupDom();
    installCanvasStandIns();
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
    vi.restoreAllMocks();
  });

  it('saves a drawn signature to the library as a transparent PNG stamp, kept across reloads', async () => {
    const user = userEvent.setup();
    render(<App />);
    const { panel, dialog, canvas } = await openSignatureDialog(user);
    const save = within(dialog).getByRole('button', { name: 'Save signature' });
    expect(save).toBeDisabled(); // nothing drawn yet

    drawStroke(canvas, DIAGONAL);
    await waitFor(() => expect(save).toBeEnabled());

    const name = within(dialog).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'My signature');
    await user.click(save);

    // Dialog closes; the stamp appears under Signatures.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sigs = within(panel).getByRole('region', { name: 'Signatures' });
    expect(within(sigs).getByRole('button', { name: 'My signature' })).toBeInTheDocument();

    // Exported as PNG, cropped from the pad's backing store at 2× (jsdom's
    // devicePixelRatio is 1, raised to 2): strokes span x 50–300, y 60–150,
    // plus 2.6px pen + 8px padding → CSS 39,49 272×112 → backing 78,98 544×224.
    expect(exports).toHaveLength(1);
    expect(exports[0].type).toBe('image/png');
    const out = exports[0].canvas;
    expect([out.width, out.height]).toEqual([544, 224]);
    const drawImage = out.__log.find(([op]) => op === 'drawImage');
    expect(drawImage).toEqual(['drawImage', canvas, 78, 98, 544, 224, 0, 0, 544, 224]);
    expect(out.__log.find(([op]) => op === 'fillRect')).toBeUndefined(); // no background fill

    // Stored in IndexedDB as a transparent PNG signature stamp…
    const [stored] = await createStampStore(globalThis.indexedDB).list();
    expect(stored).toMatchObject({
      kind: 'signature',
      name: 'My signature',
      content: { type: 'image', mime: 'image/png', width: 260, height: 90 },
    });
    expect(pngHasAlpha(stored.content.bytes)).toBe(true);
    expect(Array.from(stored.content.bytes)).toEqual(Array.from(SIGNATURE_PNG));

    // …and still there after a reload.
    cleanup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Stamps' }));
    const panel2 = screen.getByRole('complementary', { name: 'Stamps' });
    expect(await within(panel2).findByRole('button', { name: 'My signature' })).toBeInTheDocument();
  });

  it('undo removes the last stroke and clear empties the pad', async () => {
    const user = userEvent.setup();
    render(<App />);
    const { dialog, canvas } = await openSignatureDialog(user);
    const save = within(dialog).getByRole('button', { name: 'Save signature' });
    const undo = within(dialog).getByRole('button', { name: 'Undo' });
    const clear = within(dialog).getByRole('button', { name: 'Clear' });

    drawStroke(canvas, DIAGONAL);
    drawStroke(canvas, [[60, 170], [280, 170]]);
    await waitFor(() => expect(save).toBeEnabled());

    await user.click(undo); // one stroke left
    expect(save).toBeEnabled();
    await user.click(undo); // none left
    expect(save).toBeDisabled();
    expect(undo).toBeDisabled();

    drawStroke(canvas, DIAGONAL);
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(clear);
    expect(save).toBeDisabled();
    expect(within(dialog).getByText('Sign here')).toBeInTheDocument();
  });

  it('switches pen colour for new strokes', async () => {
    const user = userEvent.setup();
    render(<App />);
    const { dialog, canvas } = await openSignatureDialog(user);

    await user.click(within(dialog).getByRole('radio', { name: 'Blue pen' }).closest('label'));
    drawStroke(canvas, DIAGONAL);
    // signature_pad records the pen colour with the stroke.
    const ctx = canvas.getContext('2d');
    await waitFor(() => expect(ctx.fillStyle).toBe('#1f3fbf'));
  });

  it('refuses to save if the browser’s PNG has no transparency', async () => {
    const user = userEvent.setup();
    encoded = OPAQUE_PNG;
    render(<App />);
    const { dialog, canvas } = await openSignatureDialog(user);
    drawStroke(canvas, DIAGONAL);
    const save = within(dialog).getByRole('button', { name: 'Save signature' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('without transparency');
    expect(await createStampStore(globalThis.indexedDB).list()).toHaveLength(0);
  });

  it('cancel closes without saving', async () => {
    const user = userEvent.setup();
    render(<App />);
    const { dialog, canvas } = await openSignatureDialog(user);
    drawStroke(canvas, DIAGONAL);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await createStampStore(globalThis.indexedDB).list()).toHaveLength(0);
  });
});
