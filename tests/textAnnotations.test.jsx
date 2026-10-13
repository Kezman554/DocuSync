import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { openPdf, setupDom } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

const { downloadBytes } = await import('../src/lib/download.js');
const { default: App } = await import('../src/App.jsx');

// Real pdf.js reads the exported bytes back, as a PDF viewer would.
let pdfjs;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});

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

/** Pick the Text tool, click at (x, y) and type `text`, then press Escape. */
async function addText(user, x, y, text) {
  await user.click(screen.getByRole('button', { name: 'Add text' }));
  const el = await layer();
  pointer('pointerDown', el, x, y);
  pointer('pointerUp', el, x, y);
  const editor = screen.getByRole('textbox', { name: 'Text' });
  expect(editor).toHaveFocus();
  if (text) await user.type(editor, text);
  await user.keyboard('{Escape}');
}

/** Export, then return the text items pdf.js finds on `pageNumber`. */
async function exportAndRead(user, pageNumber = 1) {
  await user.click(screen.getByRole('button', { name: 'Export PDF' }));
  await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
  const [bytes] = downloadBytes.mock.calls[0];
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
  }).promise;
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const ops = await page.getOperatorList();
  const fills = ops.fnArray
    .map((fn, i) => (fn === pdfjs.OPS.setFillRGBColor ? ops.argsArray[i] : null))
    .filter(Boolean)
    .map((c) => `#${Array.from(c, (v) => v.toString(16).padStart(2, '0')).join('')}`);
  const items = content.items
    .filter((i) => i.str.trim())
    .map((i) => ({
      str: i.str,
      transform: i.transform,
      family: content.styles[i.fontName]?.fontFamily,
    }));
  const rotate = page.rotate;
  await pdf.destroy();
  return { items, fills, rotate };
}

const expectBaseline = (item, { size, x, y, rotated = false }) => {
  const [a, b, c, d, e, f] = item.transform.map((v) => +v.toFixed(3));
  expect([a, b, c, d]).toEqual(rotated ? [0, size, -size, 0] : [size, 0, 0, size]);
  expect(e).toBeCloseTo(x, 2);
  expect(f).toBeCloseTo(y, 2);
};

// Helvetica 16pt: line 19.2, glyphs (718+207)/1000·16 = 14.8, ascent 11.488
// → first baseline (19.2 − 14.8)/2 + 11.488 = 13.688pt below the click.
const H16 = 13.688;

describe('text annotations', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('places editable text and exports it at the clicked position', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());

    await addText(user, 100, 150, 'Hello PDF');
    expect(screen.getByRole('button', { name: 'Text 1: Hello PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull(); // editing finished

    const { items, fills } = await exportAndRead(user);
    const hello = items.find((i) => i.str === 'Hello PDF');
    expect(hello).toBeDefined(); // real, selectable text
    // Click (100, 150) px at 100% → PDF (100, 792 − 150 = 642) = text top-left.
    expectBaseline(hello, { size: 16, x: 100, y: 642 - H16 });
    expect(hello.family).toBe('sans-serif');
    expect(fills).toContain('#000000');
  });

  it('exports the same position whatever the zoom when it was placed', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' })); // 150%

    await addText(user, 150, 225, 'Zoomed'); // same page spot as (100, 150) at 100%
    const { items } = await exportAndRead(user);
    expectBaseline(
      items.find((i) => i.str === 'Zoomed'),
      { size: 16, x: 100, y: 642 - H16 }
    );
  });

  it('applies font, size and colour, keeping the top-left anchored', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await addText(user, 100, 150, 'Styled');

    const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
    await user.selectOptions(within(bar).getByLabelText('Font'), 'TimesRoman');
    const size = within(bar).getByLabelText('Size');
    await user.clear(size);
    await user.type(size, '24');
    fireEvent.input(within(bar).getByLabelText('Colour'), { target: { value: '#1a7f37' } });

    const { items, fills } = await exportAndRead(user);
    const styled = items.find((i) => i.str === 'Styled');
    // Times 24pt: line 28.8, glyphs 21.6, ascent 16.392 → baseline 3.6 + 16.392.

    expectBaseline(styled, { size: 24, x: 100, y: 642 - 19.992 });
    expect(styled.family).toBe('serif');
    expect(fills).toContain('#1a7f37');
  });

  it('remembers the style for the next text box', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await user.click(screen.getByRole('button', { name: 'Add text' }));
    const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
    await user.selectOptions(within(bar).getByLabelText('Font'), 'Courier');

    const el = await layer();
    pointer('pointerDown', el, 50, 60);
    pointer('pointerUp', el, 50, 60);
    await user.type(screen.getByRole('textbox', { name: 'Text' }), 'Mono');
    await user.keyboard('{Escape}');

    const { items } = await exportAndRead(user);
    expect(items.find((i) => i.str === 'Mono').family).toBe('monospace');
  });

  it('exports multi-line text one line-height apart', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await addText(user, 100, 150, 'Line one{Enter}Line two');

    const { items } = await exportAndRead(user);
    const one = items.find((i) => i.str === 'Line one');
    const two = items.find((i) => i.str === 'Line two');
    expectBaseline(one, { size: 16, x: 100, y: 642 - H16 });
    expectBaseline(two, { size: 16, x: 100, y: 642 - H16 - 19.2 });
  });

  it('places text upright on a rotated page and exports it rotated to match', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));

    // At 90° the viewport is 792 × 612; (100, 150) px ↔ PDF (150, 692 → 100).
    await addText(user, 100, 150, 'Upright');
    const { items, rotate } = await exportAndRead(user);
    expect(rotate).toBe(90);
    // Text runs up the page (PDF +y); its baseline sits 13.688pt to the right.
    expectBaseline(
      items.find((i) => i.str === 'Upright'),
      { size: 16, x: 150 + H16, y: 100, rotated: true }
    );
  });

  it('turns with the page if the page is rotated afterwards', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await addText(user, 100, 150, 'Turns');
    const content = () =>
      screen.getByRole('button', { name: /^Text 1/ }).querySelector('.annotation__content');
    expect(content().dataset.turn).toBe('0');

    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));
    expect(content().dataset.turn).toBe('90');

    const { items } = await exportAndRead(user);
    // Same PDF position as unrotated — only the page's /Rotate changed.
    expectBaseline(items.find((i) => i.str === 'Turns'), { size: 16, x: 100, y: 642 - H16 });
  });

  it('moves text by dragging, and the export follows', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await addText(user, 100, 150, 'Moved');
    const box = screen.getByRole('button', { name: 'Text 1: Moved' });
    const el = await layer();

    pointer('pointerDown', box, 110, 160);
    pointer('pointerMove', el, 160, 260);
    pointer('pointerUp', el, 160, 260);

    const { items } = await exportAndRead(user);
    expectBaseline(items.find((i) => i.str === 'Moved'), { size: 16, x: 150, y: 542 - H16 });
  });

  it('re-edits with Enter or double-click, and removes text left empty', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await addText(user, 100, 150, 'Draft');

    const box = screen.getByRole('button', { name: 'Text 1: Draft' });
    box.focus();
    await user.keyboard('{Enter}');
    const editor = screen.getByRole('textbox', { name: 'Text' });
    expect(editor).toHaveValue('Draft');
    await user.type(editor, ' v2');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Text 1: Draft v2' })).toBeInTheDocument();

    await user.dblClick(screen.getByRole('button', { name: 'Text 1: Draft v2' }));
    await user.clear(screen.getByRole('textbox', { name: 'Text' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /^Text/ })).toBeNull();
  });

  it('discards a text box if nothing is typed', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    await addText(user, 100, 150, '');
    expect(screen.queryByRole('button', { name: /^Text/ })).toBeNull();
  });
});
