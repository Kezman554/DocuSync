// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  normalizeQuarterTurn,
  pageBoxFromView,
  pdfToViewportPoint,
  pdfToViewportRect,
  viewportRectToPdfPlacement,
  viewportSize,
  viewportToPdfPoint,
  viewportToPdfRect,
} from '../src/lib/coords.js';

const ROTATIONS = [0, 90, 180, 270];
const SCALES = [0.25, 0.5, 1, 1.5, 2.37, 4];

const LETTER = { x: 0, y: 0, width: 612, height: 792 };
const BOXES = {
  letter: LETTER,
  landscape: { x: 0, y: 0, width: 842, height: 595 },
  // Visible box not at the origin (e.g. a CropBox) — catches missing offsets.
  offset: { x: 10, y: 20, width: 500, height: 700 },
};

const view = (rotation, scale = 1, pageBox = LETTER) => ({ pageBox, scale, rotation });

/** Points spread over (and slightly beyond) the page, in PDF space. */
function samplePdfPoints(box) {
  const xs = [0, 0.25, 0.5, 0.9, 1].map((f) => box.x + f * box.width);
  const ys = [0, 0.1, 0.5, 0.75, 1].map((f) => box.y + f * box.height);
  return xs.flatMap((x) => ys.map((y) => ({ x, y }))).concat({ x: box.x - 5, y: box.y + 3 });
}

const expectPoint = (actual, expected, digits = 6) => {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
};

describe('normalizeQuarterTurn', () => {
  it('wraps multiples of 90 into [0, 360)', () => {
    expect(normalizeQuarterTurn(0)).toBe(0);
    expect(normalizeQuarterTurn(450)).toBe(90);
    expect(normalizeQuarterTurn(-90)).toBe(270);
    expect(normalizeQuarterTurn(-540)).toBe(180);
  });

  it('rejects non-quarter turns', () => {
    expect(() => normalizeQuarterTurn(45)).toThrow(RangeError);
    expect(() => normalizeQuarterTurn(Number.NaN)).toThrow(RangeError);
  });
});

describe('input validation', () => {
  it('rejects bad scale, page box and rotation', () => {
    const p = { x: 1, y: 1 };
    expect(() => viewportToPdfPoint(p, view(0, 0))).toThrow(/Scale/);
    expect(() => viewportToPdfPoint(p, view(0, -1))).toThrow(/Scale/);
    expect(() => viewportToPdfPoint(p, view(0, 1, { x: 0, y: 0, width: 0, height: 5 }))).toThrow(
      /pageBox/
    );
    expect(() => pdfToViewportPoint(p, view(30))).toThrow(/90/);
  });
});

describe('pageBoxFromView', () => {
  it('converts pdf.js [x0, y0, x1, y1] to a rect', () => {
    expect(pageBoxFromView([10, 20, 510, 720])).toEqual({ x: 10, y: 20, width: 500, height: 700 });
    expect(pageBoxFromView([510, 720, 10, 20])).toEqual({ x: 10, y: 20, width: 500, height: 700 });
  });
});

describe('viewportSize', () => {
  it('scales the page and swaps sides when sideways', () => {
    expect(viewportSize(view(0, 1.5))).toEqual({ width: 918, height: 1188 });
    expect(viewportSize(view(90, 1.5))).toEqual({ width: 1188, height: 918 });
    expect(viewportSize(view(180, 0.5))).toEqual({ width: 306, height: 396 });
    expect(viewportSize(view(270, 0.5))).toEqual({ width: 396, height: 306 });
  });
});

describe('known values (Letter page)', () => {
  // Viewport top-left corner lands on a different PDF corner per rotation.
  it.each([
    [0, { x: 0, y: 792 }], // unrotated: top-left
    [90, { x: 0, y: 0 }], // bottom-left swings to the top-left
    [180, { x: 612, y: 0 }], // upside down: bottom-right
    [270, { x: 612, y: 792 }], // top-right swings to the top-left
  ])('rotation %i: viewport origin → PDF %o', (rotation, expected) => {
    for (const scale of SCALES) {
      expectPoint(viewportToPdfPoint({ x: 0, y: 0 }, view(rotation, scale)), expected);
    }
  });

  // PDF (100, 700): 100pt from the left, 92pt below the top of the page.
  it.each([
    [0, 1.5, { x: 150, y: 138 }],
    [90, 1.5, { x: 1050, y: 150 }],
    [180, 1.5, { x: 768, y: 1050 }],
    [270, 1.5, { x: 138, y: 768 }],
    [0, 0.5, { x: 50, y: 46 }],
    [90, 2, { x: 1400, y: 200 }],
    [180, 0.25, { x: 128, y: 175 }],
    [270, 4, { x: 368, y: 2048 }],
  ])('rotation %i at %fx: PDF (100, 700) → viewport %o', (rotation, scale, expected) => {
    const v = view(rotation, scale);
    expectPoint(pdfToViewportPoint({ x: 100, y: 700 }, v), expected);
    expectPoint(viewportToPdfPoint(expected, v), { x: 100, y: 700 });
  });

  it('zoom only scales viewport distances, never PDF positions', () => {
    for (const rotation of ROTATIONS) {
      const at1 = pdfToViewportPoint({ x: 200, y: 300 }, view(rotation, 1));
      const at3 = pdfToViewportPoint({ x: 200, y: 300 }, view(rotation, 3));
      expectPoint(at3, { x: at1.x * 3, y: at1.y * 3 });
    }
  });

  it('works in canvas backing pixels when given scale × devicePixelRatio', () => {
    const css = pdfToViewportPoint({ x: 50, y: 60 }, view(90, 1.25));
    const backing = pdfToViewportPoint({ x: 50, y: 60 }, view(90, 1.25 * 2));
    expectPoint(backing, { x: css.x * 2, y: css.y * 2 });
  });
});

describe('round trips', () => {
  for (const [name, box] of Object.entries(BOXES)) {
    it(`PDF → viewport → PDF is identity (${name}, all zooms and rotations)`, () => {
      for (const rotation of ROTATIONS) {
        for (const scale of SCALES) {
          const v = view(rotation, scale, box);
          for (const p of samplePdfPoints(box)) {
            expectPoint(viewportToPdfPoint(pdfToViewportPoint(p, v), v), p);
          }
        }
      }
    });

    it(`page corners map onto the viewport corners (${name})`, () => {
      for (const rotation of ROTATIONS) {
        for (const scale of SCALES) {
          const v = view(rotation, scale, box);
          const { width, height } = viewportSize(v);
          const corners = [
            { x: box.x, y: box.y },
            { x: box.x + box.width, y: box.y },
            { x: box.x, y: box.y + box.height },
            { x: box.x + box.width, y: box.y + box.height },
          ].map((p) => pdfToViewportPoint(p, v));
          const key = (p) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
          expect(new Set(corners.map(key))).toEqual(
            new Set(
              [
                { x: 0, y: 0 },
                { x: width, y: 0 },
                { x: 0, y: height },
                { x: width, y: height },
              ].map(key)
            )
          );
        }
      }
    });
  }
});

describe('rects', () => {
  it('maps a viewport rect to a normalised PDF rect (sides swap when sideways)', () => {
    const rect = { x: 30, y: 40, width: 120, height: 60 }; // px
    expect(viewportToPdfRect(rect, view(0, 2))).toEqual({ x: 15, y: 742, width: 60, height: 30 });
    expect(viewportToPdfRect(rect, view(90, 2))).toEqual({ x: 20, y: 15, width: 30, height: 60 });
    expect(viewportToPdfRect(rect, view(180, 2))).toEqual({ x: 537, y: 20, width: 60, height: 30 });
    expect(viewportToPdfRect(rect, view(270, 2))).toEqual({ x: 562, y: 717, width: 30, height: 60 });
  });

  it('round-trips at every zoom and rotation, including offset boxes', () => {
    const rect = { x: 33.5, y: 71.25, width: 140, height: 52 };
    for (const box of Object.values(BOXES)) {
      for (const rotation of ROTATIONS) {
        for (const scale of SCALES) {
          const v = view(rotation, scale, box);
          const back = pdfToViewportRect(viewportToPdfRect(rect, v), v);
          for (const k of ['x', 'y', 'width', 'height']) {
            expect(back[k]).toBeCloseTo(rect[k], 6);
          }
        }
      }
    }
  });
});

describe('viewportRectToPdfPlacement (upright content on rotated pages)', () => {
  // Rotate a point counter-clockwise about an anchor, as pdf-lib does.
  const rotateCcw = (p, anchor, degrees) => {
    const r = (degrees * Math.PI) / 180;
    const dx = p.x - anchor.x;
    const dy = p.y - anchor.y;
    return {
      x: anchor.x + dx * Math.cos(r) - dy * Math.sin(r),
      y: anchor.y + dx * Math.sin(r) + dy * Math.cos(r),
    };
  };

  it('places content so its own corners land on the matching rect corners', () => {
    const rect = { x: 80, y: 120, width: 200, height: 50 };
    for (const box of Object.values(BOXES)) {
      for (const rotation of ROTATIONS) {
        for (const scale of SCALES) {
          const v = view(rotation, scale, box);
          const r = { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale };
          const place = viewportRectToPdfPlacement(r, v);
          const anchor = { x: place.x, y: place.y };
          const corner = (dx, dy) =>
            pdfToViewportPoint(
              rotateCcw({ x: place.x + dx, y: place.y + dy }, anchor, place.rotate),
              v
            );
          // Content's bottom-left / bottom-right / top-left, as the user sees it.
          expectPoint(corner(0, 0), { x: r.x, y: r.y + r.height });
          expectPoint(corner(place.width, 0), { x: r.x + r.width, y: r.y + r.height });
          expectPoint(corner(0, place.height), { x: r.x, y: r.y });
          expectPoint(corner(place.width, place.height), { x: r.x + r.width, y: r.y });
        }
      }
    }
  });

  it('keeps the content size in points regardless of zoom', () => {
    for (const scale of SCALES) {
      const place = viewportRectToPdfPlacement(
        { x: 0, y: 0, width: 100 * scale, height: 40 * scale },
        view(90, scale)
      );
      expect(place.width).toBeCloseTo(100, 9);
      expect(place.height).toBeCloseTo(40, 9);
      expect(place.rotate).toBe(90);
    }
  });
});

describe('agrees with pdf.js PageViewport (what the preview actually renders)', () => {
  let pdfjs;
  const docs = {};

  // One-page PDF whose visible box is `box`; uses a CropBox when offset.
  async function makePdf(box) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([box.x + box.width + 30, box.y + box.height + 40]);
    page.setCropBox(box.x, box.y, box.width, box.height);
    return doc.save();
  }

  beforeAll(async () => {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    for (const [name, box] of Object.entries(BOXES)) {
      const pdf = await pdfjs.getDocument({ data: await makePdf(box) }).promise;
      docs[name] = await pdf.getPage(1);
    }
  });

  for (const name of Object.keys(BOXES)) {
    it(`matches pdf.js for the ${name} box at every zoom and rotation`, () => {
      const page = docs[name];
      const pageBox = pageBoxFromView(page.view);
      expect(pageBox).toEqual(BOXES[name]);

      for (const rotation of ROTATIONS) {
        for (const scale of SCALES) {
          const vp = page.getViewport({ scale, rotation });
          const v = { pageBox, scale, rotation };

          const size = viewportSize(v);
          expect(size.width).toBeCloseTo(vp.width, 6);
          expect(size.height).toBeCloseTo(vp.height, 6);

          for (const p of samplePdfPoints(pageBox)) {
            const [ex, ey] = vp.convertToViewportPoint(p.x, p.y);
            expectPoint(pdfToViewportPoint(p, v), { x: ex, y: ey });
          }
          for (const fx of [0, 0.3, 1]) {
            for (const fy of [0, 0.6, 1]) {
              const q = { x: fx * vp.width, y: fy * vp.height };
              const [ex, ey] = vp.convertToPdfPoint(q.x, q.y);
              expectPoint(viewportToPdfPoint(q, v), { x: ex, y: ey });
            }
          }
        }
      }
    });
  }
});
