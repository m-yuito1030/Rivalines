import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { GameMap } from '../../world/gameMap';
import { connect } from '../../world/roads';
import { makeRng } from '../../world/towns';
import { Simulation } from '../simulation';
import { LOCK_BELOW, LOCK_RELEASE, RATING_START, newRating, ratingName, stepRating } from './rating';
import { migrateStep, servedAreas } from '../world/migration';
import { Transit, WAIT_CAP } from '../network/transit';

function line() {
  const size = 64;
  const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
  for (let x = 5; x < 40; x++) connect(map, x, 10, 1, false);
  for (const x of [8, 9, 36, 37]) map.building.set(map.idx(x, 11), 3);
  const tr = new Transit(map);
  const a = tr.addStop(7, 10)!;
  const b = tr.addStop(38, 10)!;
  const r = tr.addRoute([a.id, b.id])!;
  tr.addVehicle(r.id, 0);
  return { map, tr, a, b };
}

describe('会社の評価', () => {
  it('運行がなければ中立(60)へ近づき、名前は点数で決まる', () => {
    const size = 32;
    const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
    const tr = new Transit(map);
    const r = newRating();
    expect(r.score).toBe(RATING_START);
    for (let i = 0; i < 50; i++) stepRating(r, map, tr);
    expect(r.score).toBeGreaterThan(59);
    expect(r.score).toBeLessThan(61);
    expect(ratingName(5)).toBe('最悪');
    expect(ratingName(50)).toBe('普通');
    expect(ratingName(90)).toBe('優良');
  });
  it('待ち人数が溢れ車両が滞ると評価が下がり、最悪で開発不可、回復で解除される(ヒステリシス)', () => {
    const { map, tr, a, b } = line();
    // 大きな街がある(運行範囲のカバー率が低い)状況
    map.towns.push({ id: 1, name: 'T', x: 20, y: 10, pop: 20000, houses: 100, roads: [], nextGrowth: 0, pax: 0 });
    const r = newRating();
    for (let i = 0; i < 30; i++) stepRating(r, map, tr);
    const good = r.score;
    expect(good).toBeGreaterThan(60);
    expect(r.locked).toBe(false);
    // 悪化: 待ちが上限の半分以上、車両が全て停滞
    a.waiting = b.waiting = WAIT_CAP.road;
    tr.vehicles[0].stuck = 100;
    let locked = false;
    for (let i = 0; i < 60; i++) {
      stepRating(r, map, tr);
      if (r.locked) locked = true;
    }
    expect(r.score).toBeLessThan(good);
    expect(locked).toBe(true);
    expect(r.score).toBeLessThan(LOCK_BELOW + 1);
    // 回復の途中(LOCK_BELOW〜LOCK_RELEASE)ではまだ解除されない
    a.waiting = b.waiting = 0;
    tr.vehicles[0].stuck = 0;
    let stillLockedMid = false;
    for (let i = 0; i < 80 && r.locked; i++) {
      stepRating(r, map, tr);
      if (r.locked && r.score >= LOCK_BELOW && r.score < LOCK_RELEASE) stillLockedMid = true;
    }
    expect(r.locked).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(LOCK_RELEASE);
    expect(stillLockedMid).toBe(true);
  });
});

describe('人口移動', () => {
  it('運行が始まった地域へ、サービス圏外から住民が移り、人口はおおむね保たれる', () => {
    const size = 160;
    const map = new GameMap(size, 3, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
    const sim = new Simulation(map);
    for (let i = 0; i < 60000; i++) sim.step();
    const town = [...map.towns].sort((p, q) => q.houses - p.houses)[0];
    expect(town.houses).toBeGreaterThan(12);
    const tr = sim.transit;
    // 街の道路の2点に停留所を置いて運行を始める
    // 街のはずれ(中心から最も遠い道路)に停留所を置く: 周囲に空き地があり、中心部の建物は圏外になる
    const roads = town.roads.filter((i) => map.road.get(i)).sort((a, b) => Math.hypot((b % size) - town.x, (Math.floor(b / size)) - town.y) - Math.hypot((a % size) - town.x, (Math.floor(a / size)) - town.y));
    const p1 = roads[0];
    const p2 = roads[Math.min(roads.length - 1, 6)];
    const s1 = tr.addStop(p1 % size, Math.floor(p1 / size), 'road')!;
    const s2 = tr.addStop(p2 % size, Math.floor(p2 / size), 'road')!;
    const r = tr.addRoute([s1.id, s2.id])!;
    expect(tr.addVehicle(r.id, sim.tick)).not.toBeNull();
    const areas = servedAreas(tr);
    expect(areas.length).toBe(2);
    const inside = () => {
      let n = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (map.building.get(map.idx(x, y)) & 3 && areas.some((a) => Math.abs(a.x - x) <= a.r && Math.abs(a.y - y) <= a.r)) n++;
      return n;
    };
    const pop0 = map.towns.reduce((s, t) => s + t.pop, 0);
    const in0 = inside();
    const rng = makeRng(9);
    let moved = 0;
    for (let i = 0; i < 80; i++) moved += migrateStep(map, tr, rng, 1);
    expect(moved).toBeGreaterThan(0);
    expect(inside()).toBeGreaterThan(in0);
    const pop1 = map.towns.reduce((s, t) => s + t.pop, 0);
    expect(Math.abs(pop1 - pop0)).toBeLessThanOrEqual(moved * 0.5 + 40); // 段階の違いによる誤差のみ
    // 運行がなければ何も起きない
    tr.removeRoute(r.id);
    expect(migrateStep(map, tr, rng, 1)).toBe(0);
  });
});
