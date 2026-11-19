import { describe, expect, it } from 'vitest';
import { generateTerrain, landRatio } from './terrain';

describe('generateTerrain', () => {
  it('同じシードなら同じ結果', () => {
    const a = generateTerrain({ size: 128, seed: 42 });
    const b = generateTerrain({ size: 128, seed: 42 });
    expect(a).toEqual(b);
  });
  it('シードが違えば結果も違う', () => {
    const a = generateTerrain({ size: 128, seed: 1 });
    const b = generateTerrain({ size: 128, seed: 2 });
    expect(a).not.toEqual(b);
  });
  it('海と陸がほどよく混在する', () => {
    for (const seed of [1, 7, 123, 99999]) {
      const r = landRatio(generateTerrain({ size: 512, seed }));
      expect(r).toBeGreaterThan(0.2);
      expect(r).toBeLessThan(0.8);
    }
  });
});
