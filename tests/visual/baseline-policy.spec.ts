import { describe, expect, it } from 'vitest';
import { canWriteBaseline } from './baseline-policy';

describe('visual baseline policy', () => {
  it('rejects a missing baseline in strict mode without explicit regeneration', () => {
    expect(canWriteBaseline(false, true)).toBe(false);
  });

  it('allows explicit regeneration and local first runs', () => {
    expect(canWriteBaseline(true, true)).toBe(true);
    expect(canWriteBaseline(false, false)).toBe(true);
  });
});
