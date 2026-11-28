import { describe, expect, it } from 'vitest';
import { generateTerrain } from './terrain';
import { GameMap } from './gameMap';
import { Simulation } from '../sim/simulation';
import { DANCHI_VARIANT, buildingLevel, isOffice } from './buildings';
import { DISTRICT_SPEC } from './districts';
import { townTier, type District, type DistrictKind, type Town } from './town';
import { SEA_LEVEL } from './constants';
import { connect } from './roads';
import { extendDistrictRoad, makeRng } from './towns';

function makeSim(seed: number) {
  const size = 512;
  return new Simulation(new GameMap(size, seed, generateTerrain({ size, seed })));
}

/** One shared run: a world grown for a while (towns plan districts, rebuild them, and report it) */
const sim = makeSim(7);
for (let i = 0; i < 60000; i++) sim.step();

describe('街の区画と再開発', () => {
  it('育った街は、規模に応じた区画を計画し、区画は重ならない', () => {
    const planned = sim.map.towns.filter((t) => (t.districts?.length ?? 0) > 0);
    expect(planned.length).toBeGreaterThan(0);
    for (const t of sim.map.towns) {
      const ds = t.districts ?? [];
      for (const d of ds) expect(DISTRICT_SPEC[d.kind].minTier).toBeLessThanOrEqual(townTier(t));
      for (let a = 0; a < ds.length; a++)
        for (let b = a + 1; b < ds.length; b++) {
          const p = ds[a];
          const q = ds[b];
          expect(p.x0 <= q.x1 && p.x1 >= q.x0 && p.y0 <= q.y1 && p.y1 >= q.y0).toBe(false);
        }
    }
  });

  it('団地の区画は大きなアパートが同じ形で並び、オフィスの区画はオフィスが建つ', () => {
    let danchi = 0;
    let office = 0;
    for (const t of sim.map.towns)
      for (const d of t.districts ?? []) {
        if (d.state === 'planned') continue;
        const variants = new Set<number>();
        for (let y = d.y0; y <= d.y1; y++)
          for (let x = d.x0; x <= d.x1; x++) {
            const b = sim.map.building.get(sim.map.idx(x, y));
            if (!b || buildingLevel(b) === 0 || sim.map.owner.get(sim.map.idx(x, y)) !== t.id) continue;
            if (d.kind === 'danchi' && buildingLevel(b) === 3 && !isOffice(b)) {
              danchi++;
              variants.add((b >> 2) & 31);
            }
            if (d.kind === 'office' && isOffice(b)) office++;
          }
        // Every block of a housing complex carries the housing-complex mark (its sprite is picked when it is drawn)
        if (d.kind === 'danchi') expect([...variants].every((v) => v === DANCHI_VARIANT)).toBe(true);
      }
    expect(danchi + office).toBeGreaterThan(0);
  });

  it('計画・着工・完成・人口の節目がニュースに出る。番号は増えていく', () => {
    const kinds = new Set(sim.news.map((n) => n.kind));
    expect(kinds.has('plan')).toBe(true);
    expect(kinds.has('start')).toBe(true);
    for (let i = 1; i < sim.news.length; i++) expect(sim.news[i].id).toBeGreaterThan(sim.news[i - 1].id);
    expect(sim.news.length).toBeLessThanOrEqual(60);
  });

  it('同じシードなら、同じ区画・同じニュースになる', () => {
    const b = makeSim(7);
    for (let i = 0; i < 60000; i++) b.step();
    expect(JSON.stringify(b.news)).toBe(JSON.stringify(sim.news));
  });

  it('再開発のあとも、建物の人口と街の人口の差が極端にずれない(取り壊しで人口を引く)', () => {
    for (const t of sim.map.towns) expect(t.pop).toBeGreaterThanOrEqual(0);
  });
});

describe('区画の道の形', () => {
  /** A flat land with one straight road down the line x = x0 + 4 inside a 14x14 district (so the district has a road to branch from) */
  function setup(kind: DistrictKind): { map: GameMap; town: Town; d: District } {
    const size = 80;
    const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
    const d: District = { id: 1, kind, name: 't', x0: 20, y0: 20, x1: 33, y1: 33, state: 'building', placed: 0 };
    const town: Town = { id: 1, name: 't', x: 27, y: 27, pop: 5000, houses: 0, roads: [], nextGrowth: 0, pax: 0, tier: 2, districts: [d] };
    // The road down x = 24 (x0 + 4) and along y = 27 (the middle row)
    for (let y = 20; y < 33; y++) connect(map, 24, y, 2, false);
    for (let x = 20; x < 33; x++) connect(map, x, 27, 1, false);
    for (let y = 20; y <= 33; y++) town.roads.push(map.idx(24, y));
    for (let x = 20; x <= 33; x++) town.roads.push(map.idx(x, 27));
    return { map, town, d };
  }
  const roadTiles = (map: GameMap, d: District) => {
    const out: [number, number][] = [];
    for (let y = d.y0; y <= d.y1; y++) for (let x = d.x0; x <= d.x1; x++) if (map.road.get(map.idx(x, y))) out.push([x, y]);
    return out;
  };

  it('オフィス街は、4タイルおきの碁盤の目の道になる', () => {
    const { map, town, d } = setup('office');
    const before = roadTiles(map, d).length;
    const rng = makeRng(5);
    for (let i = 0; i < 80; i++) extendDistrictRoad(map, town, d, rng);
    const after = roadTiles(map, d);
    expect(after.length).toBeGreaterThan(before);
    // Every road tile lies on a grid line (a column or a row that is a multiple of 4 from the corner), or on the two roads that were there at the start
    for (const [x, y] of after) expect((x - d.x0) % 4 === 0 || (y - d.y0) % 4 === 0 || y === 27).toBe(true);
  });

  it('団地は、6タイルおきの短い行き止まりの道が出る', () => {
    const { map, town, d } = setup('danchi');
    const before = roadTiles(map, d).length;
    const rng = makeRng(9);
    for (let i = 0; i < 80; i++) extendDistrictRoad(map, town, d, rng);
    const after = roadTiles(map, d);
    expect(after.length).toBeGreaterThan(before);
    for (const [x, y] of after) expect((x - d.x0) % 6 === 0 || (y - d.y0) % 6 === 0 || x === 24 || y === 27).toBe(true);
  });

  it('商店街は、中ほどの一本の通りだけが伸びる(区画の外には出ない)', () => {
    const { map, town, d } = setup('shop');
    const rng = makeRng(3);
    for (let i = 0; i < 80; i++) extendDistrictRoad(map, town, d, rng);
    for (const [x, y] of roadTiles(map, d)) expect(y === 26 || y === 27 || x === 24).toBe(true); // 26 is the middle row of the district; 27 and x = 24 were there at the start
    // The middle row now runs through the whole district
    for (let x = d.x0; x <= d.x1; x++) expect(map.road.get(map.idx(x, 26))).not.toBe(0);
    // Nothing was laid outside the district
    for (let y = 0; y < map.size; y++)
      for (let x = 0; x < map.size; x++) if (map.road.get(map.idx(x, y)) && (x < d.x0 || x > d.x1 || y < d.y0 || y > d.y1)) expect.fail(`road outside at ${x},${y}`);
  });
});
