// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { listChars, unexportableChars, unexportableMessage } from '../src/lib/exportableText.js';
import { STANDARD_FONTS } from '../src/lib/textLayout.js';

describe('unexportableChars', () => {
  it('passes Western European text, including curly quotes', () => {
    for (const text of ['é', 'ü', 'ñ', 'ç', '£', '“quoted” ‘text’', 'Crème brûlée, Ñandú, Größe — 12 £ €']) {
      expect({ text, missing: unexportableChars(text, 'Helvetica') }).toEqual({ text, missing: [] });
    }
  });

  it('reports what the fonts can’t write', () => {
    // ó is in the Western European set; Ł, ź, ł and ą aren't.
    expect(unexportableChars('Łódź łąka', 'Helvetica')).toEqual(['Ł', 'ź', 'ł', 'ą']);
    expect(unexportableChars('Привет', 'Helvetica')).toEqual(['П', 'р', 'и', 'в', 'е', 'т']);
    expect(unexportableChars('Καλημέρα', 'TimesRoman')).toEqual(['Κ', 'α', 'λ', 'η', 'μ', 'έ', 'ρ']);
    expect(unexportableChars('Done 👍', 'Helvetica')).toEqual(['👍']);
    expect(unexportableChars('A → B', 'Courier')).toEqual(['→']);
    expect(unexportableChars('東京', 'Helvetica')).toEqual(['東', '京']);
  });

  it('lists each character once, in the order it first appears', () => {
    expect(unexportableChars('→a→b←', 'Helvetica')).toEqual(['→', '←']);
  });

  it('treats an emoji with a skin tone as one character', () => {
    expect(unexportableChars('👍🏽 ok', 'Helvetica')).toEqual(['👍🏽']);
  });

  it('ignores line breaks (layout splits lines before drawing)', () => {
    expect(unexportableChars('one\ntwo\r\nthree', 'Helvetica')).toEqual([]);
  });

  it('uses each font’s own set: a ✓ is fine in ZapfDingbats (tick stamps), not in Helvetica', () => {
    expect(unexportableChars('✓', 'ZapfDingbats')).toEqual([]);
    expect(unexportableChars('✓', 'Helvetica')).toEqual(['✓']);
    expect(unexportableChars('α→', 'Symbol')).toEqual([]);
  });

  it('agrees with export for every standard font: same characters as pdf-lib’s embedded font', async () => {
    const doc = await PDFDocument.create();
    const names = new Set([...Object.keys(STANDARD_FONTS), 'Symbol', 'ZapfDingbats']);
    for (const name of names) {
      const font = await doc.embedFont(StandardFonts[name]);
      // export replaces anything outside this set with "?" (encodable() in exportPdf.js)
      const exportable = new Set(font.getCharacterSet());
      // Every code point in the Basic Multilingual Plane plus a few emoji.
      const disagreements = [];
      for (let code = 0x20; code <= 0xffff; code += 1) {
        if (code >= 0xd800 && code <= 0xdfff) continue; // lone surrogates aren't characters
        const char = String.fromCodePoint(code);
        const reported = unexportableChars(char, name).length > 0;
        if (reported === exportable.has(code)) disagreements.push(code.toString(16));
      }
      for (const code of [0x1f44d, 0x1f600, 0x1d400]) {
        if (unexportableChars(String.fromCodePoint(code), name).length === 0) disagreements.push(code.toString(16));
      }
      expect({ name, disagreements }).toEqual({ name, disagreements: [] });
    }
  });
});

describe('the message', () => {
  it('names the characters in plain words', () => {
    expect(unexportableMessage([])).toBeNull();
    expect(unexportableMessage(['ł'])).toBe('ł won’t appear in the exported PDF (it’ll show as ?)');
    expect(unexportableMessage(['ł', '→'])).toBe(
      'ł and → won’t appear in the exported PDF (they’ll show as ?)'
    );
  });

  it('keeps long lists short, and shows invisible characters by code', () => {
    expect(listChars(['a', 'b', 'c'])).toBe('a, b and c');
    expect(listChars(['П', 'р', 'и', 'в', 'е', 'т'])).toBe('П, р, и, в and 2 more');
    expect(listChars(['\t'])).toBe('U+0009');
    expect(listChars(['​'])).toBe('U+200B');
  });
});
