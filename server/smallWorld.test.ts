import { describe, expect, it } from 'vitest';
import { makeWorldMap } from '../src/shared/world/bigTerrain';
import { Simulation } from '../src/shared/sim/simulation';

describe('小さな世界(次期バージョン: 2048×2048)', () => {
  it('新しい世界は、最初に全部の区画に街ができる。全区画の生成を呼び直しても増えない', () => {
    const sim = new Simulation(makeWorldMap(2048, 20260401), undefined, { multi: true });
    expect(sim.map.townRegions.size).toBe(4); // 2×2 区画
    const towns = sim.map.towns.length;
    expect(towns).toBeGreaterThan(8);
    sim.discoverNear(1024, 1024, 2);
    expect(sim.map.towns.length).toBe(towns);
  });
});
