import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { openPdf, setupDom } from './helpers/fakePdf.jsx';
import { NUMBER_FORMATS, pageNumberLabels } from '../src/lib/pageNumbering.js';
import { STANDARD_FONTS } from '../src/lib/textLayout.js';
import { missingCharsWarning, unexportableChars } from '../src/lib/exportableText.js';
import { chooseFromMenu, EXPORT_MENU } from './helpers/menus.js';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)), loadPdfData: vi.fn() };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

const { downloadBytes } = await import('../src/lib/download.js');
const { default: App } = await import('../src/App.jsx');

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

/** Text tool, click on the current page; returns the editor. */
async function startText(user) {
  await user.click(screen.getByRole('button', { name: 'Add text' }));
  const layer = await screen.findByRole('group', { name: /^Annotations on page/ });
  pointer('pointerDown', layer, 100, 100);
  pointer('pointerUp', layer, 100, 100);
  return screen.getByRole('textbox', { name: 'Text' });
}

const formatBar = () => screen.getByRole('group', { name: 'Text formatting' });
const barWarning = () => within(formatBar()).getByRole('status');

describe('warning while typing text', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('appears as a character that won’t export is typed, and goes when it’s deleted', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    const editor = await startText(user);

    await user.type(editor, 'Café crème £5');
    expect(barWarning()).toBeEmptyDOMElement();

    await user.type(editor, ' ł');
    expect(barWarning()).toHaveTextContent('ł won’t appear in the exported PDF (it’ll show as ?)');

    await user.type(editor, ' →');
    expect(barWarning()).toHaveTextContent(
      'ł and → won’t appear in the exported PDF (they’ll show as ?)'
    );

    await user.type(editor, '{Backspace}{Backspace}{Backspace}{Backspace}');
    expect(editor).toHaveValue('Café crème £5');
    expect(barWarning()).toBeEmptyDOMElement();
  });

  it('is shown again when an existing box with such text is selected', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    const editor = await startText(user);
    await user.type(editor, 'Привет');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /^Text 1/ })).toHaveAttribute('aria-pressed', 'true');
    expect(barWarning()).toHaveTextContent('П, р, и, в and 2 more won’t appear');
  });
});

describe('page numbers and watermark', () => {
  beforeEach(setupDom);
  afterEach(() => vi.restoreAllMocks());

  it('no page-number format has a character that won’t export, in any font offered', () => {
    for (const format of NUMBER_FORMATS) {
      for (const font of Object.keys(STANDARD_FONTS).filter((f) => !STANDARD_FONTS[f].symbols)) {
        const text = pageNumberLabels(12, { format: format.id, start: 1 }).join(' ');
        expect({ format: format.id, font, missing: unexportableChars(text, font) }).toEqual({
          format: format.id,
          font,
          missing: [],
        });
      }
    }
  });

  it('the watermark text field warns as it’s typed and cleared', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: /^Watermark/ }));
    const dialog = screen.getByRole('dialog', { name: /Watermark/ });
    const field = within(dialog).getByLabelText('Watermark text');
    const warning = () => within(dialog).getByRole('status');

    await user.clear(field);
    await user.type(field, 'BROUILLON');
    expect(warning()).toBeEmptyDOMElement();
    await user.type(field, ' → ΣΧΕΔΙΟ');
    expect(warning()).toHaveTextContent('→, Σ, Χ, Ε and 3 more won’t appear in the exported PDF');
    await user.clear(field);
    await user.type(field, 'DRAFT');
    expect(warning()).toBeEmptyDOMElement();
  });
});

describe('before an export', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  /** Open a real 4-page PDF and put `text` on page 2. */
  async function withTextOnPage2(user, text) {
    await openPdf(App, user, await letterPdf());
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    const editor = await startText(user);
    await user.type(editor, text);
    await user.keyboard('{Escape}');
  }

  it('Export PDF names the pages and lets the user go back or carry on', async () => {
    const user = userEvent.setup();
    await withTextOnPage2(user, 'Gdańsk → Kraków');

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Some characters won’t export' });
    expect(dialog).toHaveTextContent(
      'On page 2, ń and → won’t appear in the exported PDF (they’ll show as ?).'
    );
    // Go back: nothing downloads.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(downloadBytes).not.toHaveBeenCalled();

    // Carry on: exports anyway (not blocked).
    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    dialog = screen.getByRole('alertdialog', { name: 'Some characters won’t export' });
    await user.click(within(dialog).getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
  });

  it('Export PDF asks nothing when all the text exports', async () => {
    const user = userEvent.setup();
    await withTextOnPage2(user, 'Café — “fine”');
    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Extract pages and Export images warn only when the chosen pages are affected', async () => {
    const user = userEvent.setup();
    await withTextOnPage2(user, 'łódka');

    for (const [button, title, where] of [
      ['Extract pages…', 'Extract pages', 'the exported PDF'],
      ['Export images…', 'Export pages as images', 'the exported images'],
    ]) {
      await chooseFromMenu(user, EXPORT_MENU, button);
      const dialog = screen.getByRole('dialog', { name: title });
      const input = within(dialog).getByLabelText(/^Pages/);
      await user.clear(input);
      await user.type(input, '1, 3-4');
      expect(dialog).not.toHaveTextContent('won’t appear');
      await user.clear(input);
      await user.type(input, '1-3');
      expect(within(dialog).getByRole('note')).toHaveTextContent(
        `On page 2, ł won’t appear in ${where} (it’ll show as ?).`
      );
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    }
  });

  it('Compress and Export with password say so too', async () => {
    const user = userEvent.setup();
    await withTextOnPage2(user, 'łódka');
    for (const [button, title] of [
      ['Compress…', 'Compress PDF'],
      ['Export with password…', 'Export with password'],
    ]) {
      await chooseFromMenu(user, EXPORT_MENU, button);
      const dialog = screen.getByRole('dialog', { name: title });
      expect(dialog).toHaveTextContent('On page 2, ł won’t appear in the exported PDF');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    }
  });
});

describe('missingCharsWarning', () => {
  it('lists pages as ranges', () => {
    expect(missingCharsWarning({ pages: [], chars: [] })).toBeNull();
    expect(missingCharsWarning({ pages: [2, 3, 4, 7], chars: ['ł', '→'] })).toBe(
      'On pages 2-4 and 7, ł and → won’t appear in the exported PDF (they’ll show as ?).'
    );
    expect(missingCharsWarning({ pages: [1, 3, 5], chars: ['ł'] })).toBe(
      'On pages 1, 3 and 5, ł won’t appear in the exported PDF (it’ll show as ?).'
    );
  });
});
