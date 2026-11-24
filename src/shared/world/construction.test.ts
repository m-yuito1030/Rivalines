import { describe, expect, it } from 'vitest';
import { makeWorldMap } from './bigTerrain';
import { BUILD_DAYS_MAX, BUILD_DAYS_MIN, GROWTH_BASE_TICKS, growTown, makeRng, placeTownsRegion } from './towns';
import { Simulation, TICKS_PER_DAY } from '../sim/simulation';

const townMap = () => {
  const map = makeWorldMap(65535, 11);
  for (let ry = 10; ry < 22 && map.towns.length < 5; ry++) for (let rx = 10; rx < 22; rx++) placeTownsRegion(map, rx, ry);
  return map;
};

describe('街の成長と工事', () => {
  it('成長の間隔の基準は、以前(150)よりゆっくり', () => {
    expect(GROWTH_BASE_TICKS).toBeGreaterThanOrEqual(600);
  });

  it('成長で建つ建物は工事中から始まり、完成まで2日以上・3日以内(ランダム)', () => {
    const map = townMap();
    const rng = makeRng(5);
    const town = map.towns[0];
    const now = 1000;
    for (let i = 0; i < 60; i++) growTown(map, town, now, rng, TICKS_PER_DAY);
    expect(map.sites.size).toBeGreaterThan(10);
    const spans = new Set<number>();
    for (const [i, at] of map.sites) {
      expect(map.construction.get(i)).toBe(1);
      expect(map.building.get(i)).not.toBe(0);
      const days = (at - now) / TICKS_PER_DAY;
      expect(days).toBeGreaterThanOrEqual(BUILD_DAYS_MIN - 1e-6);
      expect(days).toBeLessThanOrEqual(BUILD_DAYS_MAX + 1e-6);
      spans.add(Math.round(days * 20));
    }
    expect(spans.size).toBeGreaterThan(3); // ばらつきがある
  });

  it('時間が来ると完成して工事中の印が消え、それまでは残る。取り壊されたものは印も消える', () => {
    const map = townMap();
    const sim = new Simulation(map, undefined, { multi: true });
    const rng = makeRng(9);
    for (let i = 0; i < 20; i++) growTown(map, map.towns[0], sim.tick, rng, TICKS_PER_DAY);
    const sites = [...map.sites.keys()];
    expect(sites.length).toBeGreaterThan(5);
    map.building.set(sites[0], 0); // 工事中に取り壊された
    sim.tick = Math.floor(TICKS_PER_DAY * 1.9) - 1; // 2日(最短)に届く前
    for (let k = 0; k < 100; k++) sim.step();
    expect(sites.filter((i) => map.construction.get(i)).length).toBeGreaterThan(5);
    sim.tick = Math.ceil(TICKS_PER_DAY * 3.1) - 1; // 3日を過ぎたあと
    for (let k = 0; k < 100; k++) sim.step();
    expect(sites.every((i) => map.construction.get(i) === 0 && !map.sites.has(i))).toBe(true);
  });
});
