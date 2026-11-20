import { describe, expect, it } from 'vitest';
import { generateTerrain } from './terrain';
import { GameMap } from './gameMap';
import { Simulation } from '../sim/simulation';

function makeSim(seed: number) {
  const size = 512;
  const map = new GameMap(size, seed, generateTerrain({ size, seed }));
  return new Simulation(map);
}

describe('towns', () => {
  it('街が配置され、成長で人口が増え、道路は常に整合する', () => {
    const sim = makeSim(7);
    const map = sim.map;
    expect(map.towns.length).toBeGreaterThanOrEqual(2);
    const pop0 = map.towns.reduce((s, t) => s + t.pop, 0);
    for (let i = 0; i < 20000; i++) sim.step();
    const pop1 = map.towns.reduce((s, t) => s + t.pop, 0);
    expect(pop1).toBeGreaterThan(pop0);
    // 建物は海や道路の上にない
    for (let i = 0; i < map.building.length; i++) {
      if (map.building.get(i)) {
        expect(map.road.get(i)).toBe(0);
        expect(map.height[i]).toBeGreaterThan(105);
      }
    }
    // 接続ビットは相互
    const s = map.size;
    for (let y = 0; y < s - 1; y++) {
      for (let x = 0; x < s - 1; x++) {
        const r = map.road.get(y * s + x);
        expect(!!(r & 2)).toBe(!!(map.road.get(y * s + x + 1) & 8));
        expect(!!(r & 4)).toBe(!!(map.road.get((y + 1) * s + x) & 1));
      }
    }
  });
  it('同じシードなら同じ街が同じように育つ', () => {
    const a = makeSim(3);
    const b = makeSim(3);
    for (let i = 0; i < 5000; i++) {
      a.step();
      b.step();
    }
    expect(a.map.towns.map((t) => [t.name, t.x, t.y, t.pop])).toEqual(b.map.towns.map((t) => [t.name, t.x, t.y, t.pop]));
    expect(a.map.road).toEqual(b.map.road);
  });
});

describe('建物(スプライト)', () => {
  it('2x2のLは付属タイルを持ち、撤去で4タイルとも消え、人口が戻る。中心にオフィスが現れる', async () => {
    const { buildingLevel, isOffice, fillerAnchorOffset } = await import('./buildings');
    const { removeBuilding } = await import('./roads');
    const { FACILITY_TILE } = await import('./facilities');
    const sim = makeSim(11);
    const map = sim.map;
    for (let t = 0; t < 60000; t++) sim.step();
    let ls = 0;
    let offices = 0;
    for (let i = 0; i < map.building.length; i++) {
      const b = map.building.get(i);
      if (!b || b === FACILITY_TILE) continue; // 施設の敷地は対象外
      if (buildingLevel(b) === 0) {
        // 付属タイルのアンカーは Lである
        const [ax, ay] = fillerAnchorOffset(b);
        expect(buildingLevel(map.building.get(map.idx((i % map.size) + ax, (Math.floor(i / map.size)) + ay)))).toBe(3);
      } else {
        if (buildingLevel(b) === 3) ls++;
        if (isOffice(b)) offices++;
      }
    }
    expect(offices).toBeGreaterThan(0);
    if (ls > 0) {
      const pop0 = map.towns.reduce((s, t) => s + t.pop, 0);
      let k = 0;
      while (!(map.building.get(k) && buildingLevel(map.building.get(k)) === 3)) k++;
      const x = k % map.size;
      const y = Math.floor(k / map.size);
      expect(removeBuilding(map, x - 1, y - 1)).toBe(true); // 付属タイルから撤去しても建物ごと消える
      for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) expect(map.building.get(map.idx(x + dx, y + dy))).toBe(0);
      expect(map.towns.reduce((s, t) => s + t.pop, 0)).toBe(pop0 - 36);
    }
  });
});
