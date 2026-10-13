import { describe, it, expect } from 'vitest';
import { formatPageRanges, parsePageRanges } from '../src/lib/pageRanges.js';

describe('parsePageRanges', () => {
  const parse = (input, n = 10) => parsePageRanges(input, n);

  it('parses singles, ranges and lists into sorted unique pages', () => {
    expect(parse('3')).toEqual({ pages: [3] });
    expect(parse('2-4')).toEqual({ pages: [2, 3, 4] });
    expect(parse('8, 1-3, 2, 5')).toEqual({ pages: [1, 2, 3, 5, 8] });
  });

  it('accepts open-ended and reversed ranges, dashes and loose spacing', () => {
    expect(parse('8-')).toEqual({ pages: [8, 9, 10] });
    expect(parse('-2')).toEqual({ pages: [1, 2] });
    expect(parse('4-2')).toEqual({ pages: [2, 3, 4] });
    expect(parse(' 1 – 2 ,, 4 ')).toEqual({ pages: [1, 2, 4] });
  });

  it('rejects empty input', () => {
    expect(parse('')).toHaveProperty('error');
    expect(parse('  ,  ')).toHaveProperty('error');
  });

  it('rejects malformed items, naming the offending item', () => {
    expect(parse('1, abc').error).toMatch(/“abc”/);
    expect(parse('1-2-3').error).toMatch(/“1-2-3”/);
    expect(parse('-').error).toMatch(/“-”/);
    expect(parse('2.5').error).toMatch(/“2.5”/);
  });

  it('rejects pages outside the document', () => {
    expect(parse('11', 10).error).toBe('There’s no page 11 — this document has 10 pages');
    expect(parse('0-2').error).toMatch(/no page 0/);
    expect(parse('2', 1).error).toMatch(/has 1 page$/);
  });
});

describe('formatPageRanges', () => {
  it('collapses consecutive runs', () => {
    expect(formatPageRanges([1, 2, 3, 5, 7, 8])).toBe('1-3, 5, 7-8');
    expect(formatPageRanges([4])).toBe('4');
    expect(formatPageRanges([])).toBe('');
  });

  it('sorts and dedupes, and round-trips through the parser', () => {
    expect(formatPageRanges([5, 1, 2, 2])).toBe('1-2, 5');
    expect(parsePageRanges(formatPageRanges([9, 2, 3, 4, 7]), 10)).toEqual({
      pages: [2, 3, 4, 7, 9],
    });
  });
});
