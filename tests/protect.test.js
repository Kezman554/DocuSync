// @vitest-environment node
// Real pdfstudio (qpdf wasm) + real pdf.js: locking must stop pdf.js opening
// the file without the password, and unlocking must give bytes that pdf.js
// opens and buildPdf can edit and export.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createPdfToolkit } from 'pdfstudio';
import {
  DEFAULT_PROTECTION,
  WrongPasswordError,
  lockOptions,
  lockPdf,
  looksEncrypted,
  protectedFileName,
  protectionError,
  unlockPdf,
} from '../src/lib/protect.js';
import { buildPdf, ExportError } from '../src/lib/exportPdf.js';
import { createPageModel, rotatePages } from '../src/lib/pageModel.js';
import { addAnnotation } from '../src/lib/annotations.js';

// tests/fixtures/encrypted-aes256.pdf: AES-256, open password "open-sesame",
// owner password "owner-key". encrypted-owner-only.pdf: empty open password,
// owner "owner-key", printing/copying/editing all forbidden. Both hold three
// pages reading "Locked page one/two/three".
const USER_LOCKED = new Uint8Array(readFileSync('tests/fixtures/encrypted-aes256.pdf'));
const OWNER_ONLY = new Uint8Array(readFileSync('tests/fixtures/encrypted-owner-only.pdf'));
const PAGES = ['Locked page one', 'Locked page two', 'Locked page three'];

let pdfjs;
let toolkit;

const open = (bytes, password) =>
  pdfjs.getDocument({ data: new Uint8Array(bytes), password, disableFontFace: true }).promise;

async function texts(bytes, password) {
  const pdf = await open(bytes, password);
  const out = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    out.push(content.items.map((i) => i.str).join(' ').trim());
  }
  await pdf.destroy();
  return out;
}

async function plainPdf(lines = ['Hello plain world', 'Second page']) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of lines) doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 18, font });
  return doc.save();
}

const protection = (fields) => ({ ...DEFAULT_PROTECTION, ...fields });

beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  toolkit = await createPdfToolkit();
});

describe('protection settings', () => {
  it('needs an open password, typed twice', () => {
    expect(protectionError(protection({}))).toMatch(/Enter a password/);
    expect(protectionError(protection({ openPassword: 'abc', repeatPassword: 'abd' }))).toMatch(
      /don’t match/
    );
    expect(protectionError(protection({ openPassword: 'abc', repeatPassword: 'abc' }))).toBeNull();
  });

  it('is always AES-256, and only sends restrictions with an owner password', () => {
    const base = { openPassword: 'pw', repeatPassword: 'pw', allowPrinting: false };
    expect(lockOptions(protection(base))).toEqual({ userPassword: 'pw', keyLength: 256 });
    // Same as the open password = no real owner password.
    expect(lockOptions(protection({ ...base, ownerPassword: 'pw' }))).toEqual({
      userPassword: 'pw',
      keyLength: 256,
    });
    expect(
      lockOptions(protection({ ...base, ownerPassword: 'boss', allowCopying: false }))
    ).toEqual({
      userPassword: 'pw',
      keyLength: 256,
      ownerPassword: 'boss',
      permissions: { print: 'none', extract: false, modify: 'all' },
    });
  });

  it('names protected downloads', () => {
    expect(protectedFileName('report.pdf')).toBe('report-protected.pdf');
    expect(protectedFileName('')).toBe('document-protected.pdf');
  });
});

describe('looksEncrypted (no wasm)', () => {
  it('spots /Encrypt in the trailer of encrypted files only', async () => {
    expect(looksEncrypted(USER_LOCKED)).toBe(true);
    expect(looksEncrypted(OWNER_ONLY)).toBe(true);
    expect(looksEncrypted(await plainPdf())).toBe(false);
  });

  it('ignores names that merely start with Encrypt', () => {
    const bytes = new TextEncoder().encode('<< /EncryptMetadata false /Encrypted 1 >>');
    expect(looksEncrypted(bytes)).toBe(false);
    expect(looksEncrypted(new TextEncoder().encode('trailer<</Encrypt 9 0 R>>'))).toBe(true);
    expect(looksEncrypted(new TextEncoder().encode('/Encrypt<<'))).toBe(true);
  });
});

describe('lock round trip (real qpdf wasm + pdf.js)', () => {
  it('pdf.js can’t open a locked file without the password, and can with it', async () => {
    const plain = await plainPdf();
    const locked = await lockPdf(
      toolkit,
      plain,
      protection({ openPassword: 'correct horse battery', repeatPassword: 'correct horse battery' })
    );
    expect(looksEncrypted(locked)).toBe(true);

    await expect(open(locked)).rejects.toMatchObject({ name: 'PasswordException', code: 1 });
    await expect(open(locked, 'wrong')).rejects.toMatchObject({ name: 'PasswordException', code: 2 });
    expect(await texts(locked, 'correct horse battery')).toEqual(['Hello plain world', 'Second page']);

    const info = await toolkit.getInfo(locked, { password: 'correct horse battery' });
    expect(info.encryption).toMatchObject({ bits: 256, method: 'AESv3' });
  });

  it('applies restrictions with an owner password', async () => {
    const locked = await lockPdf(
      toolkit,
      await plainPdf(),
      protection({
        openPassword: 'open-pw',
        repeatPassword: 'open-pw',
        ownerPassword: 'owner-pw',
        allowPrinting: false,
        allowCopying: false,
        allowEditing: true,
      })
    );
    const { permissions } = (await toolkit.getInfo(locked, { password: 'open-pw' })).encryption;
    expect(permissions).toMatchObject({ print: false, extract: false, modify: true });
    // pdf.js reports the restrictions too (null would mean "no restrictions").
    const pdf = await open(locked, 'open-pw');
    const flags = await pdf.getPermissions();
    expect(flags).not.toContain(pdfjs.PermissionFlag.PRINT);
    expect(flags).not.toContain(pdfjs.PermissionFlag.COPY);
    expect(flags).toContain(pdfjs.PermissionFlag.MODIFY_CONTENTS);
    await pdf.destroy();
    // The owner password opens it as well.
    expect((await texts(locked, 'owner-pw'))[0]).toBe('Hello plain world');
  });

  it('refuses to lock without a valid open password', async () => {
    await expect(lockPdf(toolkit, await plainPdf(), protection({}))).rejects.toThrow(
      /Enter a password/
    );
  });

  it('locks after a redaction-free export, so the export itself can be protected', async () => {
    const exported = await buildPdf({ s1: { name: 'a.pdf', bytes: await plainPdf() } }, createPageModel(2));
    const locked = await lockPdf(toolkit, exported, protection({ openPassword: 'x', repeatPassword: 'x' }));
    expect(await texts(locked, 'x')).toEqual(['Hello plain world', 'Second page']);
  });
});

describe('unlock on open (encrypted fixtures)', () => {
  it('today’s export refuses an encrypted source — the reason unlock exists', async () => {
    await expect(
      buildPdf({ s1: { name: 'locked.pdf', bytes: USER_LOCKED } }, createPageModel(3))
    ).rejects.toThrow(ExportError);
  });

  it('rejects a wrong or missing password with WrongPasswordError', async () => {
    await expect(unlockPdf(toolkit, USER_LOCKED, 'nope')).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(unlockPdf(toolkit, USER_LOCKED, '')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('opens, edits and exports a file locked with an open password', async () => {
    const unlocked = await unlockPdf(toolkit, USER_LOCKED, 'open-sesame');
    expect(looksEncrypted(unlocked)).toBe(false);
    // pdf.js opens it without a password.
    expect(await texts(unlocked)).toEqual(PAGES);

    // Edit: drop page 2, rotate page 3, add a text annotation to page 1.
    let pages = createPageModel(3);
    pages = rotatePages(pages, new Set([pages[2].id]), 90);
    pages = addAnnotation(pages, pages[0].id, {
      id: 't',
      type: 'text',
      text: 'Edited after unlock',
      font: 'Helvetica',
      fontSize: 12,
      color: '#000000',
      rotate: 0,
      rect: { x: 72, y: 600, width: 150, height: 14 },
    });
    pages = [pages[0], pages[2]];
    const out = await buildPdf({ s1: { name: 'locked.pdf', bytes: unlocked } }, pages);
    const exported = await texts(out);
    expect(exported[0]).toContain('Locked page one');
    expect(exported[0]).toContain('Edited after unlock');
    expect(exported[1]).toBe('Locked page three');
    expect((await PDFDocument.load(out)).getPage(1).getRotation().angle).toBe(90);
  });

  it('unlocks a file that only has an owner password without asking', async () => {
    // pdf.js opens it without a password already…
    expect(await texts(OWNER_ONLY)).toEqual(PAGES);
    // …and the empty open password decrypts it, restrictions and all.
    const unlocked = await unlockPdf(toolkit, OWNER_ONLY, '');
    expect(looksEncrypted(unlocked)).toBe(false);
    expect(await toolkit.isEncrypted(unlocked)).toBe(false);
    const out = await buildPdf({ s1: { name: 'owner.pdf', bytes: unlocked } }, createPageModel(3));
    expect(await texts(out)).toEqual(PAGES);
  });

  it('returns null for a file that only looked encrypted', async () => {
    expect(await unlockPdf(toolkit, await plainPdf(), '')).toBeNull();
  });
});
