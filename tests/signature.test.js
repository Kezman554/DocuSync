// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasInk, pngHasAlpha, strokeBounds } from '../src/lib/signature.js';

const fixture = (name) => new Uint8Array(readFileSync(resolve('tests/fixtures', name)));

const group = (points, extra = {}) => ({
  penColor: '#111',
  minWidth: 0.6,
  maxWidth: 2.6,
  dotSize: 0,
  points: points.map(([x, y]) => ({ x, y, pressure: 0.5, time: 0 })),
  ...extra,
});

describe('strokeBounds', () => {
  it('wraps all points, grown by pen width and padding', () => {
    // reach = maxWidth 2.6 + padding 8 = 10.6
    const b = strokeBounds([group([[50, 150], [300, 60]])]);
    expect(b).toEqual({ x: 39, y: 49, width: 272, height: 112 }); // 39..311, 49..161
  });

  it('spans every stroke and uses the widest pen', () => {
    const b = strokeBounds(
      [group([[100, 100]]), group([[200, 50]], { maxWidth: 6 })],
      { padding: 0 }
    );
    expect(b).toEqual({ x: 97, y: 44, width: 109, height: 59 }); // 97.4..206, 44..102.6
  });

  it('clips to the pad and returns null when nothing is drawn', () => {
    expect(strokeBounds([group([[2, 3], [400, 190]])], { width: 400, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
    expect(strokeBounds([])).toBeNull();
    expect(strokeBounds([group([])])).toBeNull();
    expect(strokeBounds(undefined)).toBeNull();
  });
});

describe('hasInk', () => {
  it('is true once any stroke has a point', () => {
    expect(hasInk([])).toBe(false);
    expect(hasInk([group([])])).toBe(false);
    expect(hasInk([group([]), group([[1, 1]])])).toBe(true);
  });
});

describe('pngHasAlpha', () => {
  it('accepts RGBA and palette+tRNS PNGs', () => {
    expect(pngHasAlpha(fixture('signature-260x90.png'))).toBe(true); // colour type 6
    expect(pngHasAlpha(fixture('logo-200x100.png'))).toBe(true);
    expect(pngHasAlpha(fixture('palette-trns-8x8.png'))).toBe(true); // tRNS chunk
  });

  it('rejects opaque PNGs and non-PNG data', () => {
    expect(pngHasAlpha(fixture('opaque-rgb-20x10.png'))).toBe(false); // colour type 2
    expect(pngHasAlpha(fixture('photo-400x300.jpg'))).toBe(false);
    expect(pngHasAlpha(new Uint8Array(10))).toBe(false);
  });
});
