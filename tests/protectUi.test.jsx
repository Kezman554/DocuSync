import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extraPdfs, makeFakePdf, openPdf, setupDom, thumb } from './helpers/fakePdf.jsx';
import { looksEncrypted } from '../src/lib/protect.js';
import { chooseFromMenu, EXPORT_MENU } from './helpers/menus.js';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)), loadPdfData: vi.fn() };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));
// jsdom has no Worker: run the worker's code (protect.js + the real
// pdfstudio wasm) in place, so encryption and decryption here are real.
vi.mock('../src/lib/protectClient.js', async () => {
  const { createPdfToolkit } = await import('pdfstudio');
  const { lockPdf, unlockPdf } = await import('../src/lib/protect.js');
  let toolkit;
  const ready = async (onStage) => {
    onStage?.('loading');
    toolkit ??= createPdfToolkit();
    const pdf = await toolkit;
    onStage?.('working');
    return pdf;
  };
  return {
    lockInBrowser: vi.fn(async (bytes, protection, onStage) =>
      lockPdf(await ready(onStage), bytes, protection)
    ),
    unlockInBrowser: vi.fn(async (bytes, password, onStage) =>
      unlockPdf(await ready(onStage), bytes, password)
    ),
  };
});

const { downloadBytes } = await import('../src/lib/download.js');
const { loadPdfDocument } = await import('../src/lib/pdfLoader.js');
const { lockInBrowser, unlockInBrowser } = await import('../src/lib/protectClient.js');
const { default: App } = await import('../src/App.jsx');

// Fixtures (see tests/protect.test.js): 3 pages; open password "open-sesame".
const fixture = (name, as = name) =>
  new File([readFileSync(`tests/fixtures/${name}`)], as, { type: 'application/pdf' });
extraPdfs['locked.pdf'] = makeFakePdf('locked.pdf', 3);
extraPdfs['owner.pdf'] = makeFakePdf('owner.pdf', 3);

async function plainPdfFile() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 4; i += 1) doc.addPage([612, 792]).drawText(`Plain ${i + 1}`, { x: 72, y: 700, size: 14, font });
  return new File([await doc.save()], 'sample.pdf', { type: 'application/pdf' });
}

async function upload(user, file) {
  const utils = render(<App />);
  await user.upload(utils.container.querySelector('input[type="file"]'), file);
  return utils;
}

const bytesOf = async (file) => new Uint8Array(await file.arrayBuffer());

describe('unlock on open', () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it('doesn’t touch the encryption engine for a plain PDF', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await plainPdfFile());
    expect(unlockInBrowser).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Password needed' })).toBeNull();
  });

  it('asks for the password, retries a wrong one, then opens, edits and exports', async () => {
    const user = userEvent.setup();
    await upload(user, fixture('encrypted-aes256.pdf', 'locked.pdf'));

    const dialog = await screen.findByRole('dialog', { name: 'Password needed' });
    expect(dialog).toHaveTextContent('“locked.pdf” is password-protected');
    expect(screen.getByText('Waiting for the password for “locked.pdf”…')).toHaveAttribute(
      'role',
      'status'
    );
    const input = within(dialog).getByLabelText('Password');

    await user.type(input, 'wrong-guess{Enter}');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That password didn’t work. Check it and try again.'
    );
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();

    await user.type(input, 'open-sesame');
    await user.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    await screen.findByText('Page 1 of 3');
    expect(screen.queryByRole('dialog', { name: 'Password needed' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      '“locked.pdf” is unlocked for editing. Exports won’t have its password'
    );
    // Information, not an error: a neutral outlined note, announced politely.
    const strip = screen.getByRole('status');
    expect(strip).toHaveClass('notice-strip');
    expect(strip.querySelector('.notice-strip__item--info')).not.toBeNull();
    expect(strip.querySelector('.notice-strip__item--error')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    // pdf.js was handed the decrypted bytes, not the encrypted file.
    const [opened] = loadPdfDocument.mock.calls.at(-1);
    expect(looksEncrypted(await bytesOf(opened))).toBe(false);

    // Edit (delete page 2) and export: the export builds from the decrypted source.
    await user.click(thumb(2));
    await user.keyboard('{Delete}');
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Delete/ })
    );
    // The source had a password: plain export says this one won't, then exports.
    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const warning = screen.getByRole('alertdialog', { name: 'Export without a password?' });
    await user.click(within(warning).getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    const [bytes, name] = downloadBytes.mock.calls[0];
    expect(name).toBe('locked-edited.pdf');
    expect(looksEncrypted(bytes)).toBe(false);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it('accepts the owner password too', async () => {
    const user = userEvent.setup();
    await upload(user, fixture('encrypted-aes256.pdf', 'locked.pdf'));
    const dialog = await screen.findByRole('dialog', { name: 'Password needed' });
    await user.type(within(dialog).getByLabelText('Password'), 'owner-key{Enter}');
    await screen.findByText('Page 1 of 3');
  });

  it('leaves the file unopened if the prompt is cancelled', async () => {
    const user = userEvent.setup();
    await upload(user, fixture('encrypted-aes256.pdf', 'locked.pdf'));
    const dialog = await screen.findByRole('dialog', { name: 'Password needed' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Couldn’t open that PDF.')).toBeInTheDocument();
    expect(screen.getByText('it needs a password to open')).toBeInTheDocument();
    expect(loadPdfDocument).not.toHaveBeenCalled();
  });

  describe('a file with only an owner password', () => {
    const RESTRICTIONS_NOTICE =
      '“owner.pdf” had restrictions on printing, copying or editing, removed so it can be edited. Exports won’t have them unless you use Export with password….';

    async function openRestricted(user) {
      await upload(user, fixture('encrypted-owner-only.pdf', 'owner.pdf'));
      const dialog = await screen.findByRole('dialog', { name: 'Restricted PDF' });
      expect(dialog).toHaveTextContent(
        '“owner.pdf” has restrictions on printing, copying or editing set by its owner.'
      );
      return dialog;
    }

    const expectOpenedDecrypted = async () => {
      await screen.findByText('Page 1 of 3');
      expect(screen.queryByRole('dialog', { name: 'Restricted PDF' })).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent(RESTRICTIONS_NOTICE);
      const [opened] = loadPdfDocument.mock.calls.at(-1);
      expect(looksEncrypted(await bytesOf(opened))).toBe(false);
    };

    it('asks first, and unlocks with the owner password after a wrong one', async () => {
      const user = userEvent.setup();
      const dialog = await openRestricted(user);
      expect(loadPdfDocument).not.toHaveBeenCalled(); // nothing opened before the user chose
      const input = within(dialog).getByLabelText('Owner password');

      await user.type(input, 'not-the-owner{Enter}');
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'That password didn’t work. Check it and try again.'
      );
      expect(input).toHaveValue('');

      await user.type(input, 'owner-key');
      await user.click(within(dialog).getByRole('button', { name: 'Unlock' }));
      await expectOpenedDecrypted();
      expect(unlockInBrowser).toHaveBeenLastCalledWith(
        expect.any(Uint8Array),
        'owner-key',
        expect.any(Function)
      );
    });

    it('unlocks on confirmation that the user may edit it', async () => {
      const user = userEvent.setup();
      const dialog = await openRestricted(user);
      await user.click(
        within(dialog).getByRole('button', {
          name: 'I don’t have the owner password, and I have the right to edit this file',
        })
      );
      await expectOpenedDecrypted();
    });

    it('stays closed on Cancel', async () => {
      const user = userEvent.setup();
      const dialog = await openRestricted(user);
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByText('Couldn’t open that PDF.')).toBeInTheDocument();
      expect(loadPdfDocument).not.toHaveBeenCalled();
    });
  });
});

describe('exporting a once-protected file without a password', () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  const SENTENCE = 'The original was password-protected, but this new file won’t be.';

  async function openLocked(user) {
    await upload(user, fixture('encrypted-aes256.pdf', 'locked.pdf'));
    const dialog = await screen.findByRole('dialog', { name: 'Password needed' });
    await user.type(within(dialog).getByLabelText('Password'), 'open-sesame{Enter}');
    await screen.findByText('Page 1 of 3');
  }

  it('Export PDF shows all three warnings together, each in its own note', async () => {
    const user = userEvent.setup();
    await openLocked(user);
    const pointer = (type, el, x, y) => {
      const event = createEvent[type](el, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: x },
        clientY: { value: y },
        pointerId: { value: 1 },
        button: { value: 0 },
      });
      fireEvent(el, event);
    };
    const layer = () => screen.findByRole('group', { name: 'Annotations on page 1' });

    // A character the standard fonts can't write…
    await user.click(screen.getByRole('button', { name: 'Add text' }));
    let el = await layer();
    pointer('pointerDown', el, 100, 100);
    pointer('pointerUp', el, 100, 100);
    await user.type(screen.getByRole('textbox', { name: 'Text' }), 'łódka');
    await user.keyboard('{Escape}');
    // …and a redaction box.
    await user.click(screen.getByRole('button', { name: 'Redact' }));
    el = await layer();
    pointer('pointerDown', el, 100, 300);
    pointer('pointerMove', el, 300, 360);
    pointer('pointerUp', el, 300, 360);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Export with redactions?' });
    const notes = within(dialog).getAllByRole('note');
    expect(notes).toHaveLength(3);
    expect(notes[0]).toHaveTextContent(/1 redacted page. It becomes an image/);
    expect(notes[1]).toHaveTextContent('On page 1, ł won’t appear in the exported PDF');
    expect(notes[2]).toHaveTextContent(SENTENCE);
    expect(notes[2]).toHaveClass('protect-offer');
    expect(within(notes[2]).getByRole('button', { name: 'Export with password…' })).toBeInTheDocument();
    // Each is its own note: no note holds another's wording.
    expect(notes[0]).not.toHaveTextContent('won’t appear');
    expect(notes[1]).not.toHaveTextContent(SENTENCE);
    expect(dialog).toHaveAccessibleDescription(/redacted page.*won’t appear.*password-protected/);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(downloadBytes).not.toHaveBeenCalled();
  });

  it('Export PDF says so first, offers Export with password, and still exports', async () => {
    const user = userEvent.setup();
    await openLocked(user);
    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Export without a password?' });
    expect(dialog).toHaveTextContent(SENTENCE);
    expect(downloadBytes).not.toHaveBeenCalled();

    // The offer swaps to Export with password.
    await user.click(within(dialog).getByRole('button', { name: 'Export with password…' }));
    expect(screen.getByRole('dialog', { name: 'Export with password' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Plain export is not blocked.
    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Export PDF' })
    );
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(looksEncrypted(downloadBytes.mock.calls[0][0])).toBe(false);
  });

  it('Extract pages and Compress say so in their dialogs', async () => {
    const user = userEvent.setup();
    await openLocked(user);

    await chooseFromMenu(user, EXPORT_MENU, 'Extract pages…');
    const extract = screen.getByRole('dialog', { name: 'Extract pages' });
    expect(within(extract).getByRole('note')).toHaveTextContent(SENTENCE);
    // Its own checkbox replaces the Export with password… button (which
    // would export every page, not the extract).
    expect(within(extract).queryByRole('button', { name: 'Export with password…' })).toBeNull();
    await user.click(within(extract).getByRole('checkbox', { name: /Password protect/ }));
    expect(extract).not.toHaveTextContent(SENTENCE);
    await user.click(within(extract).getByRole('button', { name: 'Cancel' }));

    await chooseFromMenu(user, EXPORT_MENU, 'Compress…');
    const compress = screen.getByRole('dialog', { name: 'Compress PDF' });
    expect(compress).toHaveTextContent(SENTENCE);
    // Choosing to password-protect the compressed copy removes the warning.
    await user.click(within(compress).getByRole('checkbox', { name: /Password protect/ }));
    expect(compress).not.toHaveTextContent(SENTENCE);
  });

  it('Extract pages encrypts just the chosen pages', async () => {
    const user = userEvent.setup();
    await openLocked(user); // three pages: "Locked page one/two/three"
    await chooseFromMenu(user, EXPORT_MENU, 'Extract pages…');
    const dialog = screen.getByRole('dialog', { name: 'Extract pages' });
    const pagesInput = within(dialog).getByLabelText(/^Pages/);
    await user.clear(pagesInput);
    await user.type(pagesInput, '1-2');

    await user.click(within(dialog).getByRole('checkbox', { name: /Password protect/ }));
    const confirm = within(dialog).getByRole('button', { name: 'Extract 2 pages' });
    expect(confirm).toBeDisabled(); // needs a password first
    await user.type(within(dialog).getByLabelText('Password to open the file'), 'extract-secret');
    await user.type(within(dialog).getByLabelText('Type it again'), 'extract-secret');
    await user.click(confirm);

    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Extract pages' })).toBeNull();
    const [bytes, name] = downloadBytes.mock.calls[0];
    expect(name).toBe('locked-pages-1-2.pdf');
    // Encrypted from the extract itself, as the last step.
    expect(looksEncrypted(lockInBrowser.mock.calls[0][0])).toBe(false);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const open = (password) =>
      pdfjs.getDocument({ data: new Uint8Array(bytes), password, disableFontFace: true }).promise;
    await expect(open()).rejects.toMatchObject({ name: 'PasswordException' });
    const pdf = await open('extract-secret');
    expect(pdf.numPages).toBe(2);
    const texts = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const content = await (await pdf.getPage(n)).getTextContent();
      texts.push(content.items.map((i) => i.str).join(' ').trim());
    }
    await pdf.destroy();
    expect(texts).toEqual(['Locked page one', 'Locked page two']);
    expect(texts.join(' ')).not.toContain('three');
  });

  it('says nothing for a file that never had a password', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await plainPdfFile());
    await chooseFromMenu(user, EXPORT_MENU, 'Extract pages…');
    expect(screen.getByRole('dialog', { name: 'Extract pages' })).not.toHaveTextContent(SENTENCE);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await chooseFromMenu(user, EXPORT_MENU, 'Compress…');
    expect(screen.getByRole('dialog', { name: 'Compress PDF' })).not.toHaveTextContent(SENTENCE);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('export with password', () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  async function openProtect(user) {
    await openPdf(App, user, await plainPdfFile());
    await chooseFromMenu(user, EXPORT_MENU, 'Export with password…');
    return screen.getByRole('dialog', { name: 'Export with password' });
  }

  it('is honest about what a password does and doesn’t do', async () => {
    const user = userEvent.setup();
    const dialog = await openProtect(user);
    const note = within(dialog).getByRole('note');
    expect(note).toHaveTextContent('only obeyed by reader apps that choose to respect them');
    expect(note).toHaveTextContent('can’t be recovered');
    expect(note).toHaveTextContent('a short one can be guessed');
    expect(unlockInBrowser).not.toHaveBeenCalled();
    expect(lockInBrowser).not.toHaveBeenCalled(); // nothing loaded until export
  });

  it('needs the open password typed twice; restrictions need an owner password', async () => {
    const user = userEvent.setup();
    const dialog = await openProtect(user);
    const confirm = within(dialog).getByRole('button', { name: 'Export protected PDF' });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Password to open the file'), 'short');
    expect(dialog).toHaveTextContent('Short passwords can be guessed');
    await user.type(within(dialog).getByLabelText('Type it again'), 'shirt');
    expect(dialog).toHaveTextContent('The two passwords don’t match.');
    expect(confirm).toBeDisabled();

    const print = within(dialog).getByRole('checkbox', { name: 'Print' });
    expect(print).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Owner password/), 'boss-password');
    expect(print).toBeEnabled();
  });

  it('exports an AES-256 file that won’t open without its password', async () => {
    const user = userEvent.setup();
    const dialog = await openProtect(user);
    const pw = 'a long enough passphrase';
    await user.type(within(dialog).getByLabelText('Password to open the file'), pw);
    await user.type(within(dialog).getByLabelText('Type it again'), pw);
    await user.type(within(dialog).getByLabelText(/Owner password/), 'boss-password');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Copy text and images' }));
    await user.click(within(dialog).getByRole('button', { name: 'Export protected PDF' }));

    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Export with password' })).toBeNull();
    const [bytes, name] = downloadBytes.mock.calls[0];
    expect(name).toBe('sample-protected.pdf');
    expect(looksEncrypted(bytes)).toBe(true);
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);

    // Locked last, from the finished (unencrypted) export, with the settings.
    const [input, protection] = lockInBrowser.mock.calls[0];
    expect(looksEncrypted(input)).toBe(false);
    expect(protection).toMatchObject({
      openPassword: pw,
      ownerPassword: 'boss-password',
      allowCopying: false,
      allowPrinting: true,
    });
  });

  it('can protect the compressed result, encrypting after compression', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await plainPdfFile());
    await chooseFromMenu(user, EXPORT_MENU, 'Compress…');
    const dialog = screen.getByRole('dialog', { name: 'Compress PDF' });
    expect(within(dialog).queryByLabelText('Password to open the file')).toBeNull();

    await user.click(within(dialog).getByRole('checkbox', { name: /Password protect/ }));
    const confirm = within(dialog).getByRole('button', { name: 'Compress' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Password to open the file'), 'pw-for-compress');
    await user.type(within(dialog).getByLabelText('Type it again'), 'pw-for-compress');
    await user.click(confirm);

    await waitFor(() => expect(lockInBrowser).toHaveBeenCalledTimes(1));
    expect(looksEncrypted(lockInBrowser.mock.calls[0][0])).toBe(false);
    // A text-only PDF can't be made smaller, so nothing downloads either way.
    await screen.findByRole('dialog', { name: 'Couldn’t make this PDF smaller' });
    expect(downloadBytes).not.toHaveBeenCalled();
  });
});
