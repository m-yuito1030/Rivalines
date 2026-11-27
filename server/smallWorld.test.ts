import { describe, expect, it } from 'vitest';
import { makeWorldMap } from '../src/shared/world/bigTerrain';
import { Simulation } from '../src/shared/sim/simulation';

const SIZE = 4096; // the next version's fixed world size (docker-compose WORLD_SIZE)

describe('次期バージョンの世界(4096×4096)', () => {
  it('起動のときに全部の区画の街を作る(WORLD_PREGEN)と、4×4=16区画のすべてに街ができる。もう一度呼んでも増えない', () => {
    const sim = new Simulation(makeWorldMap(SIZE, 20260401), undefined, { multi: true });
    // What the server does at startup when WORLD_PREGEN=1
    sim.discoverNear(SIZE / 2, SIZE / 2, Math.ceil(SIZE / 1024));
    expect(sim.map.townRegions.size).toBe(16);
    const towns = sim.map.towns.length;
    expect(towns).toBeGreaterThan(40);
    sim.discoverNear(SIZE / 2, SIZE / 2, 8);
    expect(sim.map.towns.length).toBe(towns);
  }, 60_000);
});
