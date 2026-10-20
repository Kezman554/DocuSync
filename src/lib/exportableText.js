/**
 * Which characters of added text won't survive export. Pure.
 *
 * Text is baked into the PDF with pdf-lib's standard fonts, which can only
 * write the characters their encoding covers (WinAnsi for Helvetica, Times
 * and Courier — Western European; their own sets for Symbol and
 * ZapfDingbats). Anything else is written as "?" (encodable() in
 * exportPdf.js), while the on-screen preview uses browser fonts and looks
 * fine — so we say so up front.
 *
 * The encodings are pdf-lib's own (the same objects its standard-font
 * embedder uses), so this can't disagree with what export does.
 * Only the encodings module is imported, not the font metrics.
 */
import { Encodings } from '@pdf-lib/standard-fonts/es/Encoding.js';
import { formatPageRanges } from './pageRanges.js';

/** pdf-lib's choice of encoding for a standard font (StandardFontEmbedder). */
function encodingFor(fontName) {
  if (fontName === 'ZapfDingbats') return Encodings.ZapfDingbats;
  if (fontName === 'Symbol') return Encodings.Symbol;
  return Encodings.WinAnsi; // every other standard font, and export's Helvetica fallback
}

// Line breaks never reach the PDF: text layout splits lines before drawing.
const LINE_BREAKS = new Set([0x0a, 0x0d]);

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** User-perceived characters (an emoji with a skin tone is one), in order. */
const graphemes = (text) =>
  segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);

/**
 * The characters in `text` that `fontName` (a pdf-lib standard font name,
 * e.g. 'Helvetica', 'TimesRoman', 'ZapfDingbats') can't write — each once,
 * in the order they first appear. Empty if everything exports.
 */
export function unexportableChars(text, fontName) {
  if (!text) return [];
  const encoding = encodingFor(fontName);
  const found = [];
  for (const char of graphemes(text)) {
    if (found.includes(char)) continue;
    const ok = Array.from(char).every((c) => {
      const code = c.codePointAt(0);
      return LINE_BREAKS.has(code) || encoding.canEncodeUnicodeCodePoint(code);
    });
    if (!ok) found.push(char);
  }
  return found;
}

/** How to show a character in a message (invisible ones by their code). */
function show(char) {
  if (/^\s$/u.test(char) || /\p{C}/u.test(char)) {
    return `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return char;
}

/** "ł", "ł and →", "ł, → and 😀", "ł, →, 😀 and 3 more". */
export function listChars(chars, max = 4) {
  const shown = chars.slice(0, max).map(show);
  const rest = chars.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  if (shown.length < 2) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

/**
 * The inline warning while typing, e.g. "ł and → won't appear in the
 * exported PDF (they'll show as ?)". Null when everything exports.
 */
export function unexportableMessage(chars) {
  if (!chars.length) return null;
  const one = chars.length === 1;
  return `${listChars(chars)} won’t appear in the exported PDF (${one ? 'it’ll' : 'they’ll'} show as ?)`;
}

/**
 * Across everything an export will bake — `items` as { page, text, font },
 * page being the 1-based position — which pages have text that won't come
 * out, and which characters. { pages: [], chars: [] } if all is well.
 */
export function findMissingChars(items) {
  const pages = new Set();
  const chars = [];
  for (const { page, text, font } of items) {
    const missing = unexportableChars(text, font);
    if (!missing.length) continue;
    pages.add(page);
    for (const char of missing) if (!chars.includes(char)) chars.push(char);
  }
  return { pages: [...pages].sort((a, b) => a - b), chars };
}

/**
 * Said before an export, e.g. "On pages 2-4 and 7, ł and → won't appear in
 * the exported PDF (they'll show as ?)." Null if nothing is missing.
 */
export function missingCharsWarning({ pages, chars }, where = 'the exported PDF') {
  if (!chars.length) return null;
  const ranges = formatPageRanges(pages).split(', ');
  const pageList =
    ranges.length > 1 ? `${ranges.slice(0, -1).join(', ')} and ${ranges.at(-1)}` : ranges[0];
  const label = pages.length === 1 ? 'page' : 'pages';
  const one = chars.length === 1;
  return `On ${label} ${pageList}, ${listChars(chars)} won’t appear in ${where} (${
    one ? 'it’ll' : 'they’ll'
  } show as ?).`;
}
