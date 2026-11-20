import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { type Facility, FACILITY_SPECS } from '../../world/facilities';
import { GameMap } from '../../world/gameMap';
import { makeRng } from '../../world/towns';
import { AD_COOLDOWN_DAYS, AD_TYPES, CAP_PER_ATTRACT, STATION_BOOST, WALKIN_FRACTION, adActive, adAvailable, adCost, dailyVisitors } from './facilityVisitors';
import { Transit } from '../network/transit';

const world = (pop = 5000) => {
  const map = new GameMap(200, 1, () => new Uint8Array(4096).fill(SEA_LEVEL + 20));
  map.towns.push({ id: 1, name: 'テスト町', x: 100, y: 100, pop, houses: 100, roads: [], nextGrowth: 0, pax: 0 });
  return { map, transit: new Transit(map) };
};
const fac = (id: number, type: Facility['type'], x: number, y: number, owner: Facility['owner'] = 'player', playerId?: number): Facility => ({ id, type, x0: x, y0: y, w: 2, h: 2, name: `${type}${id}`, owner, playerId });
const avg = (map: GameMap, transit: Transit, f: Facility, days: number, seed = 1) => {
  const rng = makeRng(seed);
  const before = f.visits ?? 0;
  for (let d = 0; d < days; d++) dailyVisitors(map, transit, d, rng, () => {});
  return ((f.visits ?? 0) - before) / days;
};

describe('施設の来場者(周辺の人口・停留所・競合・広告)', () => {
  it('停留所がなくても周辺の人口から来る。人数は0〜人口の2割(と施設の上限)の範囲でランダム', () => {
    const { map, transit } = world(5000);
    const f = fac(1, 'hotel', 102, 102);
    map.facilities.push(f);
    const rng = makeRng(7);
    const counts: number[] = [];
    for (let d = 0; d < 400; d++) {
      const before = f.visits ?? 0;
      dailyVisitors(map, transit, d, rng, () => {});
      counts.push((f.visits ?? 0) - before);
    }
    const cap = FACILITY_SPECS.hotel.attract * CAP_PER_ATTRACT;
    expect(Math.max(...counts)).toBeLessThanOrEqual(Math.min(cap, WALKIN_FRACTION * 5000) + 1e-6);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(0);
    expect(new Set(counts.map((c) => Math.round(c))).size).toBeGreaterThan(20); // ランダム(毎日違う)
    expect(counts.reduce((a, b) => a + b, 0) / counts.length).toBeGreaterThan(5);
  });
  it('村(人口が少ない)では、人口の2割までしか来ない。人のいない所には誰も来ない', () => {
    const small = world(100);
    const f = fac(1, 'hotel', 102, 102);
    small.map.facilities.push(f);
    const rng = makeRng(3);
    let max = 0;
    for (let d = 0; d < 300; d++) {
      const b = f.visits ?? 0;
      dailyVisitors(small.map, small.transit, d, rng, () => {});
      max = Math.max(max, (f.visits ?? 0) - b);
    }
    expect(max).toBeLessThanOrEqual(0.2 * 100 + 1e-6);
    const empty = world(0);
    const g = fac(1, 'hotel', 102, 102);
    empty.map.facilities.push(g);
    expect(avg(empty.map, empty.transit, g, 50)).toBe(0);
  });
  it('集客圏に停留所・駅があると来場者が増える(STATION_BOOST倍)', () => {
    const a = world(5000);
    const f1 = fac(1, 'hotel', 102, 102);
    a.map.facilities.push(f1);
    const b = world(5000);
    const f2 = fac(1, 'hotel', 102, 102);
    b.map.facilities.push(f2);
    const stop = b.transit.addStop(100, 100, 'road'); // 道路がないので作れない場合は直接つくる
    void stop;
    b.transit.stops.set(99, { id: 99, name: 's', kind: 'road', idx: 0, x: 100, y: 100, waiting: 0, wait: new Map(), frac: 0, pop: 0, townId: 0, facs: [1] } as never);
    const base = avg(a.map, a.transit, f1, 600, 11);
    const boosted = avg(b.map, b.transit, f2, 600, 11);
    expect(boosted).toBeGreaterThan(base * 1.4);
    expect(boosted).toBeLessThan(base * (STATION_BOOST + 0.4));
  });
  it('近くに施設(同じ種類は強く、他の種類は少し)があると来場者が減る。遠ければ影響しない', () => {
    const solo = world(5000);
    const f0 = fac(1, 'department', 102, 102);
    solo.map.facilities.push(f0);
    const rival = world(5000);
    const f1 = fac(1, 'department', 102, 102);
    rival.map.facilities.push(f1, fac(2, 'department', 110, 102, 'city'), fac(3, 'department', 95, 95, 'player', 2));
    const other = world(5000);
    const f2 = fac(1, 'department', 102, 102);
    other.map.facilities.push(f2, fac(2, 'hotel', 110, 102, 'city'));
    const far = world(5000);
    const f3 = fac(1, 'department', 102, 102);
    far.map.facilities.push(f3, fac(2, 'department', 190, 190, 'city'));
    const a0 = avg(solo.map, solo.transit, f0, 500, 5);
    const a1 = avg(rival.map, rival.transit, f1, 500, 5);
    const a2 = avg(other.map, other.transit, f2, 500, 5);
    const a3 = avg(far.map, far.transit, f3, 500, 5);
    expect(a1).toBeLessThan(a0 * 0.6); // 同じ種類が2つ近くにある
    expect(a2).toBeLessThan(a0); // 別の種類でも少し減る
    expect(a2).toBeGreaterThan(a1); // 同じ種類のほうが強く減る
    expect(Math.abs(a3 - a0) / a0).toBeLessThan(0.1); // 遠くの施設は関係ない(乱数の並びが変わるぶんの誤差だけ)
  });
  it('広告: 自施設は増え、近くの他の施設は減る。効く日数だけ。種類で効果と値段が違う', () => {
    expect(adCost({ type: 'hotel' }, 'tv')).toBeGreaterThan(adCost({ type: 'hotel' }, 'sns'));
    expect(adCost({ type: 'hotel' }, 'sns')).toBeGreaterThan(adCost({ type: 'hotel' }, 'news'));
    expect(AD_TYPES.tv.mul).toBeGreaterThan(AD_TYPES.sns.mul);
    expect(AD_TYPES.sns.mul).toBeGreaterThan(AD_TYPES.news.mul);
    expect(AD_TYPES.tv.rival).toBeLessThan(AD_TYPES.news.rival);
    const w = world(5000);
    const mine = fac(1, 'hotel', 102, 102, 'player', 1);
    const theirs = fac(2, 'hotel', 108, 102, 'player', 2);
    w.map.facilities.push(mine, theirs);
    const baseMine = avg(w.map, w.transit, mine, 400, 9);
    const baseTheirs = theirs.visits! / 400;
    mine.visits = 0;
    theirs.visits = 0;
    mine.ad = { kind: 'tv', from: 0 };
    const rng = makeRng(9);
    for (let d = 0; d < AD_TYPES.tv.days; d++) dailyVisitors(w.map, w.transit, d, rng, () => {});
    const adMine = mine.visits! / AD_TYPES.tv.days;
    const adTheirs = theirs.visits! / AD_TYPES.tv.days;
    expect(adMine).toBeGreaterThan(baseMine * 1.3);
    expect(adTheirs).toBeLessThan(baseTheirs * 0.9);
    expect(adActive(mine, 0)).toBe(true);
    expect(adActive(mine, AD_TYPES.tv.days)).toBe(false); // 期間が終わると効かない
  });
  it('広告は施設ごとに一定期間に1度だけ(クールダウン)', () => {
    const f = fac(1, 'hotel', 0, 0, 'player', 1);
    expect(adAvailable(f, 3)).toBeNull();
    f.ad = { kind: 'news', from: 3 };
    expect(adAvailable(f, 4)).toContain('あけて');
    expect(adAvailable(f, 3 + AD_COOLDOWN_DAYS - 1)).not.toBeNull();
    expect(adAvailable(f, 3 + AD_COOLDOWN_DAYS)).toBeNull();
    expect(adAvailable(fac(2, 'school', 0, 0, 'public'), 0)).not.toBeNull(); // 公共施設には出せない
  });
  it('売上になるのは自社の施設だけ。他社・街の施設は来場者は数えるが売上にしない', () => {
    const w = world(5000);
    const mine = fac(1, 'hotel', 102, 102, 'player', 1);
    const city = fac(2, 'hotel', 140, 100, 'city'); // 町の近く(競合の範囲の外)
    w.map.facilities.push(mine, city);
    const paid: number[] = [];
    const rng = makeRng(2);
    for (let d = 0; d < 30; d++) dailyVisitors(w.map, w.transit, d, rng, (f, amount) => paid.push(f.id * 1e9 + amount));
    expect(paid.length).toBeGreaterThan(0);
    expect(paid.every((p) => Math.floor(p / 1e9) === 1)).toBe(true);
    expect(city.visits ?? 0).toBeGreaterThan(0);
  });
});
