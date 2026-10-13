import { describe, it, expect } from 'vitest';
import {
  createPageModel,
  deletePages,
  effectiveRotation,
  movePages,
  nextSelection,
  normalizeRotation,
  nudgePages,
  rotatePages,
} from '../src/lib/pageModel.js';

describe('createPageModel', () => {
  it('creates one unrotated entry per source page, in order', () => {
    expect(createPageModel(3)).toEqual([
      { id: 's1-1', sourceId: 's1', sourcePage: 1, rotation: 0 },
      { id: 's1-2', sourceId: 's1', sourcePage: 2, rotation: 0 },
      { id: 's1-3', sourceId: 's1', sourcePage: 3, rotation: 0 },
    ]);
  });

  it('prefixes ids with the source id so merged documents never collide', () => {
    const a = createPageModel(2, 's1').map((p) => p.id);
    const b = createPageModel(2, 's2').map((p) => p.id);
    expect(b).toEqual(['s2-1', 's2-2']);
    expect(new Set([...a, ...b]).size).toBe(4);
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
    const right = rotatePages(pages, ['s1-2'], 90);
    expect(right.map((p) => p.rotation)).toEqual([0, 90, 0]);

    const left = rotatePages(pages, new Set(['s1-1', 's1-3']), -90);
    expect(left.map((p) => p.rotation)).toEqual([270, 0, 270]);
  });

  it('wraps after four turns', () => {
    let next = pages;
    for (let i = 0; i < 4; i += 1) next = rotatePages(next, ['s1-1'], 90);
    expect(next[0].rotation).toBe(0);
  });

  it('is non-destructive: input is untouched and untargeted entries are reused', () => {
    const snapshot = structuredClone(pages);
    const next = rotatePages(pages, ['s1-1'], 90);
    expect(pages).toEqual(snapshot);
    expect(next).not.toBe(pages);
    expect(next[1]).toBe(pages[1]);
  });

  it('returns the same array when there is nothing to do', () => {
    expect(rotatePages(pages, [], 90)).toBe(pages);
    expect(rotatePages(pages, ['s1-1'], 360)).toBe(pages);
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
    const r = nextSelection(pages, sel('s1-1', 's1-2'), 's1-1', 's1-4');
    expect([...r.selected]).toEqual(['s1-4']);
    expect(r.anchorId).toBe('s1-4');
  });

  it('toggle adds and removes pages', () => {
    const added = nextSelection(pages, sel('s1-1'), 's1-1', 's1-3', { toggle: true });
    expect([...added.selected].sort()).toEqual(['s1-1', 's1-3']);
    const removed = nextSelection(pages, added.selected, 's1-3', 's1-1', {
      toggle: true,
    });
    expect([...removed.selected]).toEqual(['s1-3']);
  });

  it('range selects between the anchor and the clicked page in either direction', () => {
    const fwd = nextSelection(pages, sel('s1-2'), 's1-2', 's1-4', { range: true });
    expect([...fwd.selected]).toEqual(['s1-2', 's1-3', 's1-4']);
    expect(fwd.anchorId).toBe('s1-2');

    const back = nextSelection(pages, sel('s1-4'), 's1-4', 's1-1', { range: true });
    expect([...back.selected]).toEqual(['s1-1', 's1-2', 's1-3', 's1-4']);
  });
});

describe('movePages', () => {
  const pages = createPageModel(5); // p1..p5
  const order = (list) => list.map((p) => p.id);

  it('moves a single page forward and backward', () => {
    expect(order(movePages(pages, ['s1-1'], 3))).toEqual(['s1-2', 's1-3', 's1-1', 's1-4', 's1-5']);
    expect(order(movePages(pages, ['s1-5'], 0))).toEqual(['s1-5', 's1-1', 's1-2', 's1-3', 's1-4']);
    expect(order(movePages(pages, ['s1-2'], 5))).toEqual(['s1-1', 's1-3', 's1-4', 's1-5', 's1-2']);
  });

  it('moves a non-contiguous selection as a block in model order', () => {
    expect(order(movePages(pages, new Set(['s1-4', 's1-1']), 3))).toEqual([
      's1-2', 's1-3', 's1-1', 's1-4', 's1-5',
    ]);
    expect(order(movePages(pages, ['s1-2', 's1-4'], 5))).toEqual([
      's1-1', 's1-3', 's1-5', 's1-2', 's1-4',
    ]);
  });

  it('returns the same array for no-op moves', () => {
    expect(movePages(pages, ['s1-2'], 1)).toBe(pages);
    expect(movePages(pages, ['s1-2'], 2)).toBe(pages);
    expect(movePages(pages, [], 0)).toBe(pages);
  });

  it('clamps out-of-range indexes and keeps entries intact', () => {
    const rotated = rotatePages(pages, ['s1-1'], 90);
    const moved = movePages(rotated, ['s1-1'], 99);
    expect(order(moved)).toEqual(['s1-2', 's1-3', 's1-4', 's1-5', 's1-1']);
    expect(moved[4]).toBe(rotated[0]);
    expect(order(rotated)).toEqual(['s1-1', 's1-2', 's1-3', 's1-4', 's1-5']);
  });
});

describe('nudgePages', () => {
  const pages = createPageModel(4);
  const order = (list) => list.map((p) => p.id);

  it('shifts up and down by one slot', () => {
    expect(order(nudgePages(pages, ['s1-2'], -1))).toEqual(['s1-2', 's1-1', 's1-3', 's1-4']);
    expect(order(nudgePages(pages, ['s1-2'], 1))).toEqual(['s1-1', 's1-3', 's1-2', 's1-4']);
    expect(order(nudgePages(pages, ['s1-2', 's1-3'], 1))).toEqual(['s1-1', 's1-4', 's1-2', 's1-3']);
  });

  it('is a no-op at the ends', () => {
    expect(nudgePages(pages, ['s1-1'], -1)).toBe(pages);
    expect(nudgePages(pages, ['s1-4'], 1)).toBe(pages);
  });
});

describe('deletePages', () => {
  const pages = createPageModel(4);

  it('removes the targeted pages without mutating the input', () => {
    const next = deletePages(pages, ['s1-2', 's1-4']);
    expect(next.map((p) => p.id)).toEqual(['s1-1', 's1-3']);
    expect(pages).toHaveLength(4);
  });

  it('returns the same array when nothing matches', () => {
    expect(deletePages(pages, [])).toBe(pages);
    expect(deletePages(pages, ['nope'])).toBe(pages);
  });
});
