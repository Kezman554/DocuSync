import { describe, it, expect } from 'vitest';
import {
  addAnnotation,
  clampRectToBounds,
  findAnnotation,
  getAnnotations,
  moveRect,
  rectCenteredAt,
  rectFromPoints,
  removeAnnotation,
  resizeRect,
  updateAnnotation,
} from '../src/lib/annotations.js';
import { createPageModel, movePages, rotatePages } from '../src/lib/pageModel.js';

const marker = (id, rect = { x: 10, y: 20, width: 100, height: 40 }) => ({
  id,
  type: 'marker',
  rect,
});

describe('annotations in the page model', () => {
  const pages = createPageModel(3);

  it('adds to the right page without touching others', () => {
    const next = addAnnotation(pages, 's1-2', marker('a1'));
    expect(getAnnotations(next[1])).toEqual([marker('a1')]);
    expect(next[0]).toBe(pages[0]);
    expect(getAnnotations(pages[1])).toEqual([]); // input untouched
  });

  it('finds, updates and removes by id', () => {
    let next = addAnnotation(pages, 's1-1', marker('a1'));
    next = addAnnotation(next, 's1-3', marker('a2'));
    expect(findAnnotation(next, 'a2').page.id).toBe('s1-3');
    expect(findAnnotation(next, 'nope')).toBeNull();

    const rect = { x: 1, y: 2, width: 3, height: 4 };
    const updated = updateAnnotation(next, 'a2', { rect });
    expect(findAnnotation(updated, 'a2').annotation.rect).toEqual(rect);
    expect(updated[0]).toBe(next[0]);

    const removed = removeAnnotation(updated, 'a1');
    expect(getAnnotations(removed[0])).toEqual([]);
    expect(removeAnnotation(removed, 'a1')).toBe(removed); // no-op
    expect(updateAnnotation(removed, 'nope', { rect })).toBe(removed);
  });

  it('travels with its page through reorder and rotation', () => {
    let next = addAnnotation(pages, 's1-1', marker('a1'));
    next = movePages(next, ['s1-1'], 3);
    next = rotatePages(next, ['s1-1'], 90);
    expect(next[2].id).toBe('s1-1');
    expect(getAnnotations(next[2])).toEqual([marker('a1')]); // PDF rect unchanged
  });
});

describe('viewport geometry', () => {
  const bounds = { width: 600, height: 800 };
  const rect = { x: 100, y: 100, width: 200, height: 50 };

  it('moves and stops at the page edges', () => {
    expect(moveRect(rect, 30, -20, bounds)).toEqual({ ...rect, x: 130, y: 80 });
    expect(moveRect(rect, -500, -500, bounds)).toEqual({ ...rect, x: 0, y: 0 });
    expect(moveRect(rect, 900, 900, bounds)).toEqual({ ...rect, x: 400, y: 750 });
  });

  it('resizes from each corner, keeping the opposite corner fixed', () => {
    expect(resizeRect(rect, 'se', 20, 10, bounds)).toEqual({ x: 100, y: 100, width: 220, height: 60 });
    expect(resizeRect(rect, 'nw', -20, -10, bounds)).toEqual({ x: 80, y: 90, width: 220, height: 60 });
    expect(resizeRect(rect, 'ne', 10, -10, bounds)).toEqual({ x: 100, y: 90, width: 210, height: 60 });
    expect(resizeRect(rect, 'sw', 10, 10, bounds)).toEqual({ x: 110, y: 100, width: 190, height: 60 });
  });

  it('enforces a minimum size and the page bounds while resizing', () => {
    expect(resizeRect(rect, 'se', -500, -500, bounds, 12)).toEqual({
      x: 100,
      y: 100,
      width: 12,
      height: 12,
    });
    expect(resizeRect(rect, 'nw', 500, 500, bounds, 12)).toEqual({
      x: 288,
      y: 138,
      width: 12,
      height: 12,
    });
    expect(resizeRect(rect, 'se', 900, 900, bounds)).toEqual({ x: 100, y: 100, width: 500, height: 700 });
    expect(resizeRect(rect, 'nw', -900, -900, bounds)).toEqual({ x: 0, y: 0, width: 300, height: 150 });
  });

  it('builds rects from drag points and centres default-size rects', () => {
    expect(rectFromPoints({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
    expect(rectCenteredAt({ x: 300, y: 400 }, { width: 100, height: 40 }, bounds)).toEqual({
      x: 250,
      y: 380,
      width: 100,
      height: 40,
    });
    // Near a corner it's pushed back inside the page.
    expect(rectCenteredAt({ x: 5, y: 795 }, { width: 100, height: 40 }, bounds)).toEqual({
      x: 0,
      y: 760,
      width: 100,
      height: 40,
    });
  });

  it('shrinks a rect larger than the page to fit', () => {
    expect(clampRectToBounds({ x: -5, y: 3, width: 900, height: 100 }, bounds)).toEqual({
      x: 0,
      y: 3,
      width: 600,
      height: 100,
    });
  });
});
