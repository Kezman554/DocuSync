import { describe, expect, it } from 'vitest';
import {
  EDGE_PX,
  MAX_SCROLL_PX,
  autoScrollStep,
  dropIndexAt,
  isOutside,
  movedTooFar,
} from '../src/lib/touchReorder.js';

const rect = (top, height, left = 0, width = 200) => ({ top, height, left, width });

describe('touch reorder geometry', () => {
  it('tells a scroll from a steady press', () => {
    expect(movedTooFar({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(false); // 5px
    expect(movedTooFar({ x: 10, y: 10 }, { x: 10, y: 19 })).toBe(true); // 9px
  });

  it('inserts before a thumbnail in its upper half, after it in its lower half', () => {
    const items = [rect(0, 190), rect(200, 190), rect(400, 190)];
    expect(dropIndexAt(-20, items)).toBe(0);
    expect(dropIndexAt(94, items)).toBe(0);
    expect(dropIndexAt(96, items)).toBe(1);
    expect(dropIndexAt(300, items)).toBe(2);
    expect(dropIndexAt(580, items)).toBe(3);
    expect(dropIndexAt(10, [])).toBe(0);
  });

  it('scrolls faster the closer the finger is to an edge, and not in the middle', () => {
    const view = rect(100, 600);
    expect(autoScrollStep(400, view)).toBe(0);
    expect(autoScrollStep(100 + EDGE_PX + 1, view)).toBe(0);
    expect(autoScrollStep(100, view)).toBe(-MAX_SCROLL_PX);
    expect(autoScrollStep(700, view)).toBe(MAX_SCROLL_PX);
    const near = autoScrollStep(700 - EDGE_PX / 2, view);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(MAX_SCROLL_PX);
    // Past the edge (finger on the toolbar) still scrolls at full speed.
    expect(autoScrollStep(90, view)).toBe(-MAX_SCROLL_PX);
  });

  it('keeps a still middle in a short sidebar', () => {
    const view = rect(0, 120); // zones shrink to a third each
    expect(autoScrollStep(60, view)).toBe(0);
    expect(autoScrollStep(5, view)).toBeLessThan(0);
  });

  it('knows when the finger leaves the sidebar', () => {
    const sidebar = rect(0, 600, 0, 200);
    expect(isOutside({ x: 100, y: 300 }, sidebar)).toBe(false);
    expect(isOutside({ x: 201, y: 300 }, sidebar)).toBe(true);
    expect(isOutside({ x: 100, y: -1 }, sidebar)).toBe(true);
  });
});
