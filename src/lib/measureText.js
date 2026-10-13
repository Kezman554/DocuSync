/**
 * Measure text width in points for sizing text-annotation boxes on screen.
 *
 * Browser-side helper (uses a shared offscreen canvas). Falls back to an
 * average-glyph estimate where canvas text metrics are unavailable (tests,
 * very old browsers). Only the on-screen box size depends on this — the
 * exported text position comes from lib/textLayout.js.
 */
import { cssFont, splitLines } from './textLayout.js';

let ctx;
function getContext() {
  if (ctx !== undefined) return ctx;
  try {
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const c = canvas?.getContext?.('2d');
    ctx = c && typeof c.measureText === 'function' ? c : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

const AVERAGE_GLYPH = {
  Helvetica: 0.55,
  TimesRoman: 0.5,
  Courier: 0.6,
  TimesRomanBoldItalic: 0.55,
  ZapfDingbats: 0.85,
};

/** Width (pt) of the widest line of `text`, never narrower than one glyph. */
export function measureTextWidth(text, font, fontSize) {
  const lines = splitLines(text);
  const c = getContext();
  let widest = 0;
  for (const line of lines) {
    let w;
    if (c) {
      c.font = cssFont(font, fontSize);
      w = c.measureText(line).width;
    } else {
      w = line.length * fontSize * (AVERAGE_GLYPH[font] ?? 0.55);
    }
    widest = Math.max(widest, w);
  }
  return Math.max(widest, fontSize * 0.6);
}
