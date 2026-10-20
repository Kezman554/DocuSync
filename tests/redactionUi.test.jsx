import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { openPdf, setupDom, thumb } from './helpers/fakePdf.jsx';
import { chooseFromMenu, EXPORT_MENU } from './helpers/menus.js';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));
// jsdom can't render pages: stand in for the browser flattener with a real
// PNG per page. tests/redaction.test.js covers real flattening.
vi.mock('../src/lib/flattenBrowser.js', () => ({ flattenInBrowser: vi.fn() }));

const { downloadBytes } = await import('../src/lib/download.js');
const { flattenInBrowser } = await import('../src/lib/flattenBrowser.js');
const { default: App } = await import('../src/App.jsx');

const PNG = new Uint8Array(readFileSync('tests/fixtures/opaque-rgb-20x10.png'));

// Pages are US Letter (612 × 792 pt) at 100%; jsdom puts the layer at (0, 0).
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

const layer = (page = 1) => screen.findByRole('group', { name: `Annotations on page ${page}` });
const box = (el) => ['left', 'top', 'width', 'height'].map((k) => parseFloat(el.style[k]));

async function drag(from, to, page = 1) {
  const el = await layer(page);
  pointer('pointerDown', el, ...from);
  pointer('pointerMove', el, ...to);
  pointer('pointerUp', el, ...to);
}

async function realPdfFile() {
  const doc = await PDFDocument.create();
  doc.setTitle('Secret merger');
  for (let i = 0; i < 4; i += 1) doc.addPage([612, 792]);
  return new File([await doc.save()], 'sample.pdf', { type: 'application/pdf' });
}

describe('redaction tool', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
    flattenInBrowser.mockReset();
    flattenInBrowser.mockImplementation(async (_bytes, jobs) =>
      jobs.map(() => ({ bytes: PNG, mime: 'image/png', width: 612, height: 792 }))
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws boxes by dragging, stays armed, and ignores a bare click', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    const tool = screen.getByRole('button', { name: 'Redact' });
    await user.click(tool);
    expect(tool).toHaveAttribute('aria-pressed', 'true');

    await drag([100, 200], [300, 240]);
    const first = screen.getByRole('button', { name: 'Redaction 1' });
    expect(box(first)).toEqual([100, 200, 200, 40]);
    expect(first).toHaveClass('annotation--redaction');

    // A click without a drag doesn't redact anything.
    const el = await layer();
    pointer('pointerDown', el, 400, 500);
    pointer('pointerUp', el, 400, 500);
    expect(screen.queryByRole('button', { name: 'Redaction 2' })).toBeNull();

    // Still armed: a second box.
    expect(tool).toHaveAttribute('aria-pressed', 'true');
    await drag([50, 600], [20, 650]); // dragged up-left: normalised
    expect(box(screen.getByRole('button', { name: 'Redaction 2' }))).toEqual([20, 600, 30, 50]);

    await user.keyboard('{Escape}');
    expect(tool).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves, resizes and deletes a box like other annotations', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Redact' }));
    await drag([100, 200], [300, 240]);
    await user.keyboard('{Escape}'); // back to select

    const el = await layer();
    const redaction = screen.getByRole('button', { name: 'Redaction 1' });
    pointer('pointerDown', redaction, 150, 210);
    pointer('pointerMove', el, 160, 230);
    pointer('pointerUp', el, 160, 230);
    expect(box(redaction)).toEqual([110, 220, 200, 40]);

    const se = redaction.querySelector('[data-handle="se"]');
    pointer('pointerDown', se, 310, 260);
    pointer('pointerMove', el, 330, 300);
    pointer('pointerUp', el, 330, 300);
    // Free resize (not aspect-locked).
    expect(box(screen.getByRole('button', { name: 'Redaction 1' }))).toEqual([110, 220, 220, 80]);

    await user.click(screen.getByRole('button', { name: 'Delete redaction 1' }));
    expect(screen.queryByRole('button', { name: /^Redaction/ })).toBeNull();
  });

  it('marks redacted pages in the thumbnail sidebar', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    expect(thumb(1)).not.toHaveAccessibleName(/redacted/);
    await user.click(screen.getByRole('button', { name: 'Redact' }));
    await drag([100, 200], [300, 240]);
    expect(thumb(1)).toHaveAccessibleName(/, redacted$/);
    expect(within(thumb(1)).getByText('Redacted')).toBeInTheDocument();
    expect(thumb(2)).not.toHaveAccessibleName(/redacted/);

    await user.click(screen.getByRole('button', { name: 'Delete redaction 1' }));
    expect(thumb(1)).not.toHaveAccessibleName(/redacted/);
  });

  it('warns before exporting, then flattens only the redacted pages', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdfFile());
    await user.click(screen.getByRole('button', { name: 'Redact' }));
    await drag([100, 200], [300, 240]);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Export with redactions?' });
    expect(dialog).toHaveTextContent(/1 redacted page\. It becomes an image/);
    expect(dialog).toHaveTextContent(/no longer be selectable or searchable/);
    expect(dialog).toHaveTextContent(/title, author, subject and keywords won’t be copied/);
    expect(downloadBytes).not.toHaveBeenCalled();

    // Cancel exports nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(downloadBytes).not.toHaveBeenCalled();
    expect(flattenInBrowser).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Export PDF' })
    );
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));

    // One job: page 1, with its box in PDF space (y flipped from the top).
    expect(flattenInBrowser).toHaveBeenCalledTimes(1);
    const [, jobs] = flattenInBrowser.mock.calls[0];
    expect(jobs).toEqual([{ rects: [{ x: 100, y: 552, width: 200, height: 40 }] }]);

    const doc = await PDFDocument.load(downloadBytes.mock.calls[0][0], { updateMetadata: false });
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getTitle()).toBeUndefined();
  });

  it('exports straight away when nothing is redacted', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdfFile());
    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(flattenInBrowser).not.toHaveBeenCalled();
  });

  it('warns in Extract pages only when the chosen pages include a redacted one', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Redact' }));
    await drag([100, 200], [300, 240]);
    await user.keyboard('{Escape}');

    await chooseFromMenu(user, EXPORT_MENU, 'Extract pages…');
    const dialog = screen.getByRole('dialog', { name: 'Extract pages' });
    const input = within(dialog).getByLabelText(/^Pages/);
    await user.clear(input);
    await user.type(input, '2-3');
    expect(within(dialog).queryByRole('note')).toBeNull();
    await user.clear(input);
    await user.type(input, '1-3');
    expect(within(dialog).getByRole('note')).toHaveTextContent(/1 redacted page/);
  });

  it('warns in the Compress dialog when the document has redactions', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Redact' }));
    await drag([100, 200], [300, 240]);
    await user.keyboard('{Escape}');

    await chooseFromMenu(user, EXPORT_MENU, 'Compress…');
    const dialog = screen.getByRole('dialog', { name: 'Compress PDF' });
    expect(within(dialog).getByRole('note')).toHaveTextContent(/become|becomes an image/);
  });
});
