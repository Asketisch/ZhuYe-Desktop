/**
 * Vitest — fuzzy (B10-01).
 */
import { describe, it, expect } from 'vitest';
import { fuzzy } from './fuzzy';

interface Item { label: string; keywords?: string[]; hint?: string }

describe('fuzzy', () => {
  const items: Item[] = [
    { label: 'Go to Home' },
    { label: 'Go to Chat' },
    { label: 'Open Settings' },
    { label: 'Switch to dark theme', keywords: ['theme', 'dark mode'] },
    { label: 'Compact context', keywords: ['compress', 'summarize'] },
  ];

  it('returns everything (score 0) for empty query', () => {
    const r = fuzzy('', items);
    expect(r.length).toBe(items.length);
  });

  it('matches exact label', () => {
    const r = fuzzy('Go to Home', items);
    expect(r[0].item.label).toBe('Go to Home');
    expect(r[0].score).toBeGreaterThanOrEqual(50);
  });

  it('prefix match scores higher than subsequence', () => {
    const prefix = fuzzy('Open', items)[0].score;
    const subseq = fuzzy('ptn', items)[0].score;
    expect(prefix).toBeGreaterThan(subseq);
  });

  it('subsequence match works', () => {
    const r = fuzzy('cpc', items);
    // 'Compact context' 包含 c..p..c
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].item.label).toBe('Compact context');
  });

  it('matches via keywords', () => {
    const r = fuzzy('compress', items);
    expect(r[0].item.label).toBe('Compact context');
  });

  it('returns no hits for impossible query', () => {
    const r = fuzzy('zzzzzzz', items);
    expect(r.length).toBe(0);
  });

  it('returns matches index for highlighting', () => {
    const r = fuzzy('home', items);
    expect(r[0].item.label).toBe('Go to Home');
    expect(r[0].matches.length).toBe(4);
  });
});