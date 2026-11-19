import { describe, expect, it } from 'vitest';
import { generateTerrain, riverTiles } from './terrain';

describe('川の生成', () => {
  it('実際の地形でも川が掘られる(256, 複数シード)', () => {
    let total = 0;
    for (const seed of [1, 2, 3]) {
      generateTerrain({ size: 256, seed });
      total += riverTiles;
    }
    console.log('river tiles', total);
    expect(total).toBeGreaterThan(50);
  });
});
