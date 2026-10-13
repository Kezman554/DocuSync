import { describe, it, expect } from 'vitest';
import {
  anchorOf,
  clampFontSize,
  hexToRgb,
  ownSize,
  ownToPdf,
  rectFromAnchor,
  rectFromTopLeft,
  scaleFontSize,
  splitLines,
  textDrawOps,
  textLayout,
  topLeftOf,
} from '../src/lib/textLayout.js';
import { viewportRectToPdfPlacement, viewportToPdfRect } from '../src/lib/coords.js';

const ROTATIONS = [0, 90, 180, 270];
const LETTER = { x: 0, y: 0, width: 612, height: 792 };

const close = (actual, expected, digits = 6) => {
  for (const k of Object.keys(expected)) expect(actual[k]).toBeCloseTo(expected[k], digits);
};

describe('textLayout', () => {
  it('centres Helvetica glyphs in a 1.2em line box', () => {
    // 20pt: line 24, glyphs (718+207)/1000*20 = 18.5, ascent 14.36
    // first baseline = (24 - 18.5)/2 + 14.36 = 17.11
    const layout = textLayout({ text: 'Hi', fontSize: 20, font: 'Helvetica' });
    expect(layout.lineHeight).toBeCloseTo(24, 9);
    expect(layout.height).toBeCloseTo(24, 9);
    expect(layout.baselines[0]).toBeCloseTo(17.11, 9);
  });

  it('spaces lines by the line height and uses each font’s metrics', () => {
    const times = textLayout({ text: 'a\nb\nc', fontSize: 10, font: 'TimesRoman' });
    // (12 - 9)/2 + 6.83 = 8.33
    expect(times.baselines.map((b) => +b.toFixed(6))).toEqual([8.33, 20.33, 32.33]);
    expect(times.height).toBeCloseTo(36, 9);
    const courier = textLayout({ text: 'x', fontSize: 10, font: 'Courier' });
    expect(courier.baselines[0]).toBeCloseTo((12 - 7.86) / 2 + 6.29, 9);
  });

  it('splits on any newline style and keeps empty lines', () => {
    expect(splitLines('a\r\nb\rc\n\nd')).toEqual(['a', 'b', 'c', '', 'd']);
    expect(splitLines('')).toEqual(['']);
  });
});

describe('helpers', () => {
  it('parses hex colours', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 1, g: 128 / 255, b: 0 });
    expect(hexToRgb('#0f0')).toEqual({ r: 0, g: 1, b: 0 });
    expect(hexToRgb('nope')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('clamps font sizes to half-points within limits', () => {
    expect(clampFontSize(12.3)).toBe(12.5);
    expect(clampFontSize(2)).toBe(6);
    expect(clampFontSize(999)).toBe(144);
    expect(clampFontSize('abc')).toBe(16);
  });
});

describe('own frame ↔ PDF', () => {
  const rect = { x: 100, y: 200, width: 80, height: 30 };

  it('anchors at the own bottom-left corner for each rotation', () => {
    expect(anchorOf(rect, 0)).toEqual({ x: 100, y: 200 });
    expect(anchorOf(rect, 90)).toEqual({ x: 180, y: 200 });
    expect(anchorOf(rect, 180)).toEqual({ x: 180, y: 230 });
    expect(anchorOf(rect, 270)).toEqual({ x: 100, y: 230 });
  });

  it('round-trips anchor ↔ bounds and top-left ↔ bounds', () => {
    for (const r of ROTATIONS) {
      const { width, height } = ownSize(rect, r);
      close(rectFromAnchor(anchorOf(rect, r), r, width, height), rect);
      close(rectFromTopLeft(topLeftOf(rect, r), r, width, height), rect);
    }
  });

  it('keeps the top-left fixed when the text box grows', () => {
    for (const r of ROTATIONS) {
      const topLeft = topLeftOf(rect, r);
      const grown = rectFromTopLeft(topLeft, r, 150, 60);
      close(topLeftOf(grown, r), topLeft);
      expect(ownSize(grown, r)).toEqual({ width: 150, height: 60 });
    }
  });

  it('agrees with coords.js placement for upright text on rotated pages', () => {
    // A box the user sees upright at viewport (50, 70) 160×40 px, 2× zoom.
    const vp = { x: 50, y: 70, width: 160, height: 40 };
    for (const r of ROTATIONS) {
      const view = { pageBox: LETTER, scale: 2, rotation: r };
      const placement = viewportRectToPdfPlacement(vp, view);
      const bounds = viewportToPdfRect(vp, view);
      close(anchorOf(bounds, r), { x: placement.x, y: placement.y });
      expect(ownSize(bounds, r)).toEqual({ width: placement.width, height: placement.height });
    }
  });

  it('rotates own-frame offsets counter-clockwise', () => {
    close(ownToPdf({ x: 0, y: 0 }, 90, 10, 0), { x: 0, y: 10 });
    close(ownToPdf({ x: 0, y: 0 }, 270, 0, 10), { x: 10, y: 0 });
  });
});

describe('textDrawOps', () => {
  const base = { font: 'Helvetica', fontSize: 20, color: '#000000' };

  it('puts each line’s baseline start in PDF space (unrotated)', () => {
    // Box top at y = 624; first baseline 17.11 below → 606.89; next −24.
    const ops = textDrawOps({
      ...base,
      text: 'Hello\nWorld',
      rotate: 0,
      rect: { x: 100, y: 576, width: 200, height: 48 },
    });
    expect(ops).toHaveLength(2);
    close(ops[0], { x: 100, y: 606.89 });
    close(ops[1], { x: 100, y: 582.89 });
    expect(ops.map((o) => o.text)).toEqual(['Hello', 'World']);
  });

  it('offsets baselines along the rotated own frame (90°)', () => {
    // Own box 200 × 24 rotated 90° CCW: bounds 24 wide × 200 tall.
    // Own top edge is at PDF x = 300 − 24 = 276; baseline 17.11 inside it.
    const [op] = textDrawOps({
      ...base,
      text: 'Up',
      rotate: 90,
      rect: { x: 276, y: 100, width: 24, height: 200 },
    });
    close(op, { x: 276 + 17.11, y: 100 });
  });

  it('skips empty lines but keeps their spacing', () => {
    const ops = textDrawOps({
      ...base,
      text: 'a\n\nc',
      rotate: 0,
      rect: { x: 0, y: 0, width: 50, height: 72 },
    });
    expect(ops.map((o) => o.text)).toEqual(['a', 'c']);
    expect(ops[0].y - ops[1].y).toBeCloseTo(48, 9);
  });
});

describe('scaleFontSize', () => {
  it('scales and reports the factor actually applied, within limits', () => {
    expect(scaleFontSize(24, 2)).toEqual({ fontSize: 48, factor: 2 });
    expect(scaleFontSize(24, 0.01)).toEqual({ fontSize: 6, factor: 0.25 }); // min 6pt
    expect(scaleFontSize(100, 3)).toEqual({ fontSize: 144, factor: 1.44 }); // max 144pt
  });
});
