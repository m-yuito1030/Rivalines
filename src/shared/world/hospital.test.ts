import { describe, expect, it } from 'vitest';
import { HOSPITAL_GROWTH, HOSPITAL_GROWTH_MAX, HOSPITAL_REACH, hospitalGrowth, hospitalServes } from './hospital';
import { scheduleNext, makeRng } from './towns';
import { TIERS, townTier, type Town } from './town';
import type { Facility } from './facilities';

const town = (over: Partial<Town> = {}): Town => ({ id: 1, name: 'T', x: 100, y: 100, pop: 5000, houses: 100, roads: [], nextGrowth: 0, pax: 0, ...over });
const hosp = (over: Partial<Facility>): Facility =>
  ({ id: 1, type: 'hospital', x0: 100, y0: 100, w: 3, h: 3, name: 'h', owner: 'player', design: 0, size: 'L', ...over }) as Facility;

describe('病院: 近くの街の成長が速くなる', () => {
  it('街に届く距離(街の広がりの1.2倍)の内側だけ。遠い病院・病院以外は効かない', () => {
    const t = town();
    const reach = TIERS[townTier(t)].radius * HOSPITAL_REACH;
    expect(hospitalServes(hosp({ x0: 100 + Math.floor(reach) - 3 }), t)).toBe(true);
    expect(hospitalServes(hosp({ x0: 100 + Math.ceil(reach) + 10 }), t)).toBe(false);
    expect(hospitalGrowth({ facilities: [hosp({ x0: 100 + Math.ceil(reach) + 10 })] }, t)).toEqual({ bonus: 0, count: 0 });
    expect(hospitalGrowth({ facilities: [hosp({ type: 'cinema' })] }, t)).toEqual({ bonus: 0, count: 0 });
    expect(hospitalGrowth({ facilities: [] }, t).bonus).toBe(0);
  });

  it('上乗せ: 大きさの倍率(S<M<L)で、複数は足し算、上限で頭打ち', () => {
    const t = town();
    const g = (fs: Facility[]) => hospitalGrowth({ facilities: fs }, t);
    expect(g([hosp({ size: 'L' })]).bonus).toBeCloseTo(HOSPITAL_GROWTH);
    expect(g([hosp({ size: 'M' })]).bonus).toBeLessThan(g([hosp({ size: 'L' })]).bonus);
    expect(g([hosp({ size: 'S' })]).bonus).toBeLessThan(g([hosp({ size: 'M' })]).bonus);
    expect(g([hosp({ size: 'L' }), hosp({ id: 2, size: 'L' })]).bonus).toBeCloseTo(HOSPITAL_GROWTH * 2);
    expect(g([hosp({ size: 'L' }), hosp({ id: 2 }), hosp({ id: 3 }), hosp({ id: 4 })])).toMatchObject({ bonus: HOSPITAL_GROWTH_MAX, count: 4 });
    // 古い形式(大きさなし)でも1件ぶんとして働く
    expect(g([hosp({ size: undefined, design: undefined })]).bonus).toBeCloseTo(HOSPITAL_GROWTH);
  });

  it('次の成長が早まる: 同じ乱数なら、待ち時間が 1/(1+上乗せ) になる', () => {
    const a = town();
    const b = town();
    scheduleNext(a, 1000, makeRng(7), 0);
    scheduleNext(b, 1000, makeRng(7), 0.5);
    const wa = a.nextGrowth - 1000;
    const wb = b.nextGrowth - 1000;
    expect(wb).toBeLessThan(wa);
    expect(wb).toBeCloseTo(wa / 1.5, -1);
    // 上乗せなしは従来どおり
    const c = town();
    scheduleNext(c, 1000, makeRng(7));
    expect(c.nextGrowth).toBe(a.nextGrowth);
  });
});
