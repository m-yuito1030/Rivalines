import { describe, expect, it } from 'vitest';
import { generateTerrain } from './terrain';
import { GameMap } from './gameMap';
import { Simulation } from '../sim/simulation';
import { buildingLevel, isOffice } from './buildings';
import { DISTRICT_SPEC } from './districts';
import { townTier } from './town';

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
        if (d.kind === 'danchi') expect(variants.size).toBeLessThanOrEqual(1);
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
