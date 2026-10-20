import { describe, expect, it } from 'vitest';
import { sheetSummary } from '../src/lib/sheetSummary.js';

describe('sheetSummary', () => {
  it('summarises a text box with its font, size and what won’t export', () => {
    expect(sheetSummary({ text: { label: 'Text box', font: 'Helvetica', size: 12, missing: 1 } })).toBe(
      'Text box · Helvetica 12 · 1 character won’t export'
    );
    expect(sheetSummary({ text: { label: 'Text box', font: 'Times Roman', size: 24, missing: 3 } })).toBe(
      'Text box · Times Roman 24 · 3 characters won’t export'
    );
    expect(sheetSummary({ text: { label: 'New text', font: 'Courier', size: 16 } })).toBe(
      'New text · Courier 16'
    );
  });

  it('names a selected annotation', () => {
    expect(sheetSummary({ annotation: { name: 'Marker' } })).toBe('Marker');
  });

  it('says which pages the page actions act on', () => {
    expect(sheetSummary({ pages: { selected: 0, current: 2 } })).toBe('Page 2 · rotate, extract, delete');
    expect(sheetSummary({ pages: { selected: 1, current: 2 } })).toBe('Page 2 · rotate, extract, delete');
    expect(sheetSummary({ pages: { selected: 3, current: 2 } })).toBe(
      '3 pages selected · rotate, extract, delete'
    );
  });

  it('puts the stamps library first while Stamps is active', () => {
    expect(sheetSummary({ stamps: { hasDocument: true } })).toBe('Stamps · pick one, then tap the page');
    expect(sheetSummary({ stamps: { hasDocument: false } })).toBe('Stamps · open a PDF to place them');
  });

  it('has something to say with nothing open', () => {
    expect(sheetSummary({})).toBe('No document open');
  });
});
