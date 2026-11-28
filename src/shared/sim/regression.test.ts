import { describe, expect, it } from 'vitest';
import { generateTerrain } from '../world/terrain';
import { GameMap } from '../world/gameMap';
import { Simulation } from './simulation';
import { applyLayers, decodeSave, encodeSave } from '../save/serialize';
import { hasSub, subConn } from '../world/subway';
import { layNewSubway } from '../world/subway';
import { buildingLevel } from '../world/buildings';
import { FACILITY_TILE } from '../world/facilities';

const make = (seed: number, size = 512) => new Simulation(new GameMap(size, seed, generateTerrain({ size, seed })));
const io = { afford: () => true, pay: () => true, msg: (s: string) => void s };

/** The rules every world must keep, whatever the towns did. Breaks are collected, so the scan stays fast */
function checkWorld(sim: Simulation): void {
  const m = sim.map;
  const s = m.size;
  const bad: string[] = [];
  for (let y = 0; y < s - 1; y++) {
    for (let x = 0; x < s - 1; x++) {
      const i = y * s + x;
      const r = m.road.get(i);
      // Road connections are mutual
      if (!!(r & 2) !== !!(m.road.get(i + 1) & 8)) bad.push(`road E ${x},${y}`);
      if (!!(r & 4) !== !!(m.road.get(i + s) & 1)) bad.push(`road S ${x},${y}`);
      // Subway connections are mutual too (a portal's other end is a surface rail, so only subway-to-subway links are checked)
      const sw = m.subway.get(i);
      if (sw && hasSub(sw) && subConn(sw) & 2 && hasSub(m.subway.get(i + 1)) && !(subConn(m.subway.get(i + 1)) & 8)) bad.push(`subway E ${x},${y}`);
      const b = m.building.get(i);
      if (b) {
        // No building on a road
        if (r) bad.push(`building on road ${x},${y}`);
        // A 2x2 building's anchor has its three fillers behind it
        if (b !== FACILITY_TILE && buildingLevel(b) === 3 && x > 0 && y > 0) {
          for (const [ox, oy] of [
            [1, 0],
            [0, 1],
            [1, 1],
          ])
            if (!m.building.get(m.idx(x - ox, y - oy))) bad.push(`filler of ${x},${y}`);
        }
      }
    }
  }
  for (const t of m.towns) {
    if (t.pop < 0 || t.houses < 0) bad.push(`town ${t.name} pop ${t.pop} houses ${t.houses}`);
    for (const d of t.districts ?? []) if (d.x0 > d.x1 || d.y0 > d.y1 || d.placed < 0) bad.push(`district ${d.name}`);
  }
  expect(bad.slice(0, 5)).toEqual([]);
}

describe('回帰: 長い時間のあとも世界が壊れない', () => {
  it.each([3, 7, 11])('シード %i: 街が区画を作り建て替えても、道・建物・人口の決まりが守られる', (seed) => {
    const sim = make(seed);
    for (let i = 0; i < 45000; i++) sim.step();
    const popMid = sim.map.towns.reduce((t, x) => t + x.pop, 0);
    for (let i = 0; i < 45000; i++) sim.step();
    checkWorld(sim);
    // Rebuilding old buildings must never shrink the towns
    expect(sim.map.towns.reduce((t, x) => t + x.pop, 0)).toBeGreaterThanOrEqual(popMid);
    expect(sim.map.towns.reduce((a, t) => a + t.pop, 0)).toBeGreaterThan(0);
  });

  it('地下鉄を引いた世界を保存して読み直すと、同じ状態から同じように進む', async () => {
    const a = make(5);
    for (let i = 0; i < 20000; i++) a.step();
    layNewSubway(a.map, { x: 100, y: 100 }, { x: 140, y: 100 }, 1, 3, io);
    const bytes = await encodeSave(a.map, a.state());
    const d = await decodeSave(bytes);
    const map = new GameMap(512, 5, generateTerrain({ size: 512, seed: 5 }));
    applyLayers(map, d);
    const b = new Simulation(map, JSON.parse(JSON.stringify(d.header.sim)));
    expect(b.map.subway.get(b.map.idx(120, 100))).toBe(a.map.subway.get(a.map.idx(120, 100)));
    expect(b.news.length).toBe(a.news.length);
    for (let i = 0; i < 6000; i++) {
      a.step();
      b.step();
    }
    expect(JSON.stringify(b.map.towns)).toBe(JSON.stringify(a.map.towns));
    expect(JSON.stringify(b.news)).toBe(JSON.stringify(a.news));
    checkWorld(b);
  }, 60_000);
});
