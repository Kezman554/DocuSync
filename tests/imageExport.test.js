// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  MAX_AREA_PX,
  MAX_SIDE_PX,
  imageFileName,
  pixelSize,
  renderScale,
  zipFileName,
} from '../src/lib/imageExport.js';

describe('renderScale', () => {
  it('maps dpi to pdf.js scale (72 dpi = 1px per point)', () => {
    expect(renderScale(612, 792, 72)).toBe(1);
    expect(renderScale(612, 792, 150)).toBeCloseTo(150 / 72, 12);
    expect(pixelSize(612, 792, renderScale(612, 792, 300))).toEqual({ width: 2550, height: 3300 });
  });

  it('scales down pages that would exceed canvas limits', () => {
    // A 200-inch banner at 300 dpi would be 60,000 px wide.
    const s = renderScale(14400, 720, 300);
    expect(14400 * s).toBeCloseTo(MAX_SIDE_PX, 6);
    // A huge square page is limited by area.
    const big = renderScale(3000, 3000, 300);
    expect(3000 * 3000 * big * big).toBeLessThanOrEqual(MAX_AREA_PX * (1 + 1e-9));
  });
});

describe('file names', () => {
  it('numbers pages zero-padded so they sort', () => {
    expect(imageFileName('report.pdf', 3, 4, 'png')).toBe('report-page-03.png');
    expect(imageFileName('report.pdf', 7, 120, 'jpeg')).toBe('report-page-007.jpg');
    expect(imageFileName('', 1, 1, 'png')).toBe('document-page-01.png');
  });

  it('names zips after the ranges and format', () => {
    expect(zipFileName('report.pdf', [1, 2, 3, 5], 'png')).toBe('report-pages-1-3_5-png.zip');
    const many = Array.from({ length: 40 }, (_, i) => i * 2 + 1);
    expect(zipFileName('report.pdf', many, 'jpeg')).toBe('report-images-jpg.zip');
  });
});
