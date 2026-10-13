import { describe, it, expect } from 'vitest';
import {
  createPageModel,
  effectiveRotation,
  nextSelection,
  normalizeRotation,
  rotatePages,
} from '../src/lib/pageModel.js';

describe('createPageModel', () => {
  it('creates one unrotated entry per source page, in order', () => {
    expect(createPageModel(3)).toEqual([
      { id: 'p1', sourcePage: 1, rotation: 0 },
      { id: 'p2', sourcePage: 2, rotation: 0 },
      { id: 'p3', sourcePage: 3, rotation: 0 },
    ]);
  });

  it('handles empty / invalid counts', () => {
    expect(createPageModel(0)).toEqual([]);
    expect(createPageModel(-2)).toEqual([]);
  });
});

describe('normalizeRotation', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-450)).toBe(270);
  });
});

describe('rotatePages', () => {
  const pages = createPageModel(3);

  it('rotates only the targeted pages, clockwise and anticlockwise', () => {
    const right = rotatePages(pages, ['p2'], 90);
    expect(right.map((p) => p.rotation)).toEqual([0, 90, 0]);

    const left = rotatePages(pages, new Set(['p1', 'p3']), -90);
    expect(left.map((p) => p.rotation)).toEqual([270, 0, 270]);
  });

  it('wraps after four turns', () => {
    let next = pages;
    for (let i = 0; i < 4; i += 1) next = rotatePages(next, ['p1'], 90);
    expect(next[0].rotation).toBe(0);
  });

  it('is non-destructive: input is untouched and untargeted entries are reused', () => {
    const snapshot = structuredClone(pages);
    const next = rotatePages(pages, ['p1'], 90);
    expect(pages).toEqual(snapshot);
    expect(next).not.toBe(pages);
    expect(next[1]).toBe(pages[1]);
  });

  it('returns the same array when there is nothing to do', () => {
    expect(rotatePages(pages, [], 90)).toBe(pages);
    expect(rotatePages(pages, ['p1'], 360)).toBe(pages);
  });
});

describe('effectiveRotation', () => {
  it('adds the edit to the page intrinsic /Rotate', () => {
    expect(effectiveRotation(0, 90)).toBe(90);
    expect(effectiveRotation(90, 270)).toBe(0);
    expect(effectiveRotation(undefined, 180)).toBe(180);
  });
});

describe('nextSelection', () => {
  const pages = createPageModel(5);
  const sel = (...ids) => new Set(ids);

  it('plain click selects only that page', () => {
    const r = nextSelection(pages, sel('p1', 'p2'), 'p1', 'p4');
    expect([...r.selected]).toEqual(['p4']);
    expect(r.anchorId).toBe('p4');
  });

  it('toggle adds and removes pages', () => {
    const added = nextSelection(pages, sel('p1'), 'p1', 'p3', { toggle: true });
    expect([...added.selected].sort()).toEqual(['p1', 'p3']);
    const removed = nextSelection(pages, added.selected, 'p3', 'p1', {
      toggle: true,
    });
    expect([...removed.selected]).toEqual(['p3']);
  });

  it('range selects between the anchor and the clicked page in either direction', () => {
    const fwd = nextSelection(pages, sel('p2'), 'p2', 'p4', { range: true });
    expect([...fwd.selected]).toEqual(['p2', 'p3', 'p4']);
    expect(fwd.anchorId).toBe('p2');

    const back = nextSelection(pages, sel('p4'), 'p4', 'p1', { range: true });
    expect([...back.selected]).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
});
