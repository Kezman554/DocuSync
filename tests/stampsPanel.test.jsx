import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
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

const fixtureFile = (name, type) =>
  new File([readFileSync(resolve('tests/fixtures', name))], name, { type });

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
const click = (el, x, y) => {
  pointer('pointerDown', el, x, y);
  pointer('pointerUp', el, x, y);
};

/** Open the stamps panel and wait for saved stamps to load. */
async function openPanel(user) {
  await user.click(screen.getByRole('button', { name: 'Stamps' }));
  const panel = screen.getByRole('complementary', { name: 'Stamps' });
  await waitFor(() => expect(within(panel).queryByText('Loading your stamps…')).toBeNull());
  return panel;
}

const section = (panel, title) => within(panel).getByRole('region', { name: title });

/** Simulate a page reload: tear the app down and start a fresh one. */
async function reload(user) {
  cleanup();
  render(<App />);
  return openPanel(user);
}

async function createInitials(user, panel, initials, style = 'Script') {
  const form = within(panel).getByRole('form', { name: 'New initials stamp' });
  await user.type(within(form).getByLabelText('Initials'), initials);
  // Click the visible style card (the radio itself is visually hidden).
  await user.click(within(form).getByRole('radio', { name: style }).closest('label'));
  expect(within(form).getByRole('radio', { name: style })).toBeChecked();
  await user.click(within(form).getByRole('button', { name: 'Save initials' }));
}

describe('stamps library', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
    globalThis.indexedDB = new IDBFactory(); // fresh, empty browser storage
  });
  afterEach(() => vi.restoreAllMocks());

  it('ships built-in tick presets that can’t be renamed or deleted', async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = await openPanel(user);

    const ticks = section(panel, 'Ticks');
    for (const name of ['Tick', 'Light tick', 'Cross', 'Dot']) {
      expect(within(ticks).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(ticks).queryByRole('button', { name: /^(Delete|Rename)/ })).toBeNull();
    expect(within(panel).getByText('Open a PDF to place stamps.')).toBeInTheDocument();
  });

  it('adds an initials stamp that persists across a reload', async () => {
    const user = userEvent.setup();
    render(<App />);
    let panel = await openPanel(user);

    await createInitials(user, panel, 'n.y.');
    expect(await within(section(panel, 'Initials')).findByRole('button', { name: 'N.Y.' })).toBeInTheDocument();

    panel = await reload(user);
    expect(within(section(panel, 'Initials')).getByRole('button', { name: 'N.Y.' })).toBeInTheDocument();
  });

  it('validates initials before saving', async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = await openPanel(user);
    const form = within(panel).getByRole('form', { name: 'New initials stamp' });
    const save = within(form).getByRole('button', { name: 'Save initials' });
    expect(save).toBeDisabled();
    await user.type(within(form).getByLabelText('Initials'), 'ABCDE');
    expect(save).toBeDisabled();
    expect(within(form).getByLabelText('Initials')).toHaveAccessibleDescription('Up to 4 letters');
  });

  it('renames a stamp and the new name persists', async () => {
    const user = userEvent.setup();
    render(<App />);
    let panel = await openPanel(user);
    await createInitials(user, panel, 'NY');

    await user.click(await within(panel).findByRole('button', { name: 'Rename NY' }));
    const input = within(panel).getByLabelText('New name for NY');
    await user.clear(input);
    await user.type(input, 'My initials{Enter}');
    expect(await within(panel).findByRole('button', { name: 'My initials' })).toBeInTheDocument();

    panel = await reload(user);
    expect(within(panel).getByRole('button', { name: 'My initials' })).toBeInTheDocument();
  });

  it('deletes a stamp after confirmation, and it stays deleted after a reload', async () => {
    const user = userEvent.setup();
    render(<App />);
    let panel = await openPanel(user);
    await createInitials(user, panel, 'AB');
    await createInitials(user, panel, 'CD', 'Plain');
    await within(panel).findByRole('button', { name: 'CD' });

    // Cancel keeps it.
    await user.click(within(panel).getByRole('button', { name: 'Delete AB' }));
    await user.click(
      within(screen.getByRole('alertdialog', { name: 'Delete stamp “AB”?' })).getByRole('button', {
        name: 'Cancel',
      })
    );
    expect(within(panel).getByRole('button', { name: 'AB' })).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Delete AB' }));
    await user.click(screen.getByRole('button', { name: 'Delete stamp' }));
    await waitFor(() => expect(within(panel).queryByRole('button', { name: 'AB' })).toBeNull());

    panel = await reload(user);
    expect(within(panel).queryByRole('button', { name: 'AB' })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'CD' })).toBeInTheDocument();
  });

  it('adds a signature from an image file and keeps it across a reload', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<App />);
    let panel = await openPanel(user);

    await user.upload(within(panel).getByLabelText('Choose signature image'), fixtureFile('logo-200x100.png', 'image/png'));
    expect(await within(section(panel, 'Signatures')).findByRole('button', { name: 'logo-200x100' })).toBeInTheDocument();

    // Not an image: explained, nothing saved.
    await user.upload(within(panel).getByLabelText('Choose signature image'), fixtureFile('not-supported.gif', 'image/png'));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('couldn’t be added');

    panel = await reload(user);
    const sigs = section(panel, 'Signatures');
    expect(within(sigs).getByRole('button', { name: 'logo-200x100' })).toBeInTheDocument();
    expect(within(sigs).getAllByRole('button', { name: /^Delete/ })).toHaveLength(1); // GIF not saved
  });

  it('selects a tick and places it repeatedly; it exports as vector text', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    const panel = await openPanel(user);

    await user.click(within(panel).getByRole('button', { name: 'Tick' }));
    expect(within(panel).getByRole('button', { name: 'Tick' })).toHaveAttribute('aria-pressed', 'true');
    const layer = await screen.findByRole('group', { name: /^Annotations on page/ });

    click(layer, 300, 400);
    click(layer, 100, 100);
    expect(screen.getAllByRole('button', { name: /^Text \d: ✔$/ })).toHaveLength(2);

    // Escape stops the stamp tool.
    layer.focus();
    await user.keyboard('{Escape}');
    click(layer, 500, 500);
    expect(screen.getAllByRole('button', { name: /^Text \d: ✔$/ })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(downloadBytes.mock.calls[0][0]),
      disableFontFace: true,
      standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
    }).promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    // pdf-lib embeds ZapfDingbats without a Unicode map, so extraction reports
    // the font's own code: "4" is glyph a20, the heavy check mark ✔.
    const ticks = content.items.filter((i) => i.str === '4');
    expect(ticks).toHaveLength(2);
    expect(content.styles[ticks[0].fontName]).toBeDefined();
    // Centred on the click: 24pt ZapfDingbats, box 20.4 × 28.8 pt here
    // (jsdom has no canvas, so the width is the 0.85em estimate). Top-left
    // (289.8, 385.6) px → PDF (289.8, 406.4); baseline 22.524pt lower.
    const first = ticks.find((t) => Math.abs(t.transform[4] - 289.8) < 0.01);
    expect(first.transform[5]).toBeCloseTo(406.4 - 22.524, 2);
    expect(first.transform[0]).toBeCloseTo(24, 3);
    await pdf.destroy();
  });

  it('places saved initials and image stamps on the page', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await letterPdf());
    const panel = await openPanel(user);
    await createInitials(user, panel, 'NY');
    await user.upload(within(panel).getByLabelText('Choose signature image'), fixtureFile('photo-400x300.jpg', 'image/jpeg'));
    await within(panel).findByRole('button', { name: 'photo-400x300' });
    const layer = await screen.findByRole('group', { name: /^Annotations on page/ });

    await user.click(within(panel).getByRole('button', { name: 'NY' }));
    click(layer, 200, 200);
    expect(screen.getByRole('button', { name: 'Text 1: NY' })).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'photo-400x300' }));
    expect(screen.getByRole('button', { name: 'Add image' })).toHaveAttribute('aria-pressed', 'true');
    click(layer, 300, 500);
    expect(screen.getByRole('button', { name: 'Image 1' })).toBeInTheDocument();
  });

  it('still works for the session when IndexedDB is unavailable', async () => {
    globalThis.indexedDB = undefined;
    const user = userEvent.setup();
    render(<App />);
    const panel = await openPanel(user);
    expect(within(panel).getByText(/isn’t letting DocuSync save stamps/)).toBeInTheDocument();

    await createInitials(user, panel, 'XY');
    expect(await within(panel).findByRole('button', { name: 'XY' })).toBeInTheDocument();
  });
});
