import { describe, it, expect } from 'vitest';
import {
  clamp,
  roundScale,
  zoomIn,
  zoomOut,
  clampPage,
  formatZoom,
  MIN_SCALE,
  MAX_SCALE,
} from '../src/lib/zoom.js';

describe('clamp', () => {
  it('bounds a value between min and max', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('zoomIn / zoomOut', () => {
  it('steps by 0.25 and rounds cleanly', () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.75);
  });

  it('does not exceed the max or drop below the min', () => {
    expect(zoomIn(MAX_SCALE)).toBe(MAX_SCALE);
    expect(zoomOut(MIN_SCALE)).toBe(MIN_SCALE);
  });

  it('avoids floating-point drift over repeated steps', () => {
    let s = 1;
    for (let i = 0; i < 3; i += 1) s = zoomIn(s);
    expect(s).toBe(1.75);
  });
});

describe('roundScale', () => {
  it('rounds to two decimals', () => {
    expect(roundScale(0.1 + 0.2)).toBe(0.3);
  });
});

describe('clampPage', () => {
  it('keeps a page within range', () => {
    expect(clampPage(3, 10)).toBe(3);
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(11, 10)).toBe(10);
  });

  it('returns 1 when there are no pages', () => {
    expect(clampPage(5, 0)).toBe(1);
    expect(clampPage(5, null)).toBe(1);
  });
});

describe('formatZoom', () => {
  it('renders a percentage label', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(1.25)).toBe('125%');
    expect(formatZoom(0.5)).toBe('50%');
  });
});
