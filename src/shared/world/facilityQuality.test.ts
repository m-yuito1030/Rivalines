import { describe, expect, it } from 'vitest';
import { GameMap } from './gameMap';
import { SEA_LEVEL } from './constants';
import { facilityUpkeep, placeFacility, planFacility } from './facilities';
import { Transit } from '../sim/network/transit';
import { dailyVisitors } from '../sim/facility/facilityVisitors';
import { FRESH_MIN, fairPrice, freshness, gradeCapMul, gradeOf, gradeSpendMul, gradeUpkeepMul, nextRep, repMul, satisfaction, upgradeCost } from './facilityQuality';

const world = () => {
  const size = 64;
  const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 20));
  map.towns.push({ id: 1, name: 't', x: 32, y: 32, pop: 8000 } as never);
  return map;
};

describe('施設の質(グレード・評判・新しさ)', () => {
  it('グレードは未設定で★1。上げるほど客単価・上限・維持費が増える', () => {
    expect(gradeOf({})).toBe(1);
    expect(gradeOf({ grade: 9 })).toBe(1);
    expect(gradeSpendMul(5)).toBeGreaterThan(gradeSpendMul(2));
    expect(gradeCapMul(3)).toBeGreaterThan(1);
    expect(gradeUpkeepMul(1)).toBe(1);
    expect(upgradeCost(4_000_000, 2)).toBeGreaterThan(upgradeCost(4_000_000, 1));
    const map = world();
    const f = placeFacility(map, planFacility(map, 20, 20, 'hotel', () => false), 'hotel');
    const base = facilityUpkeep(f);
    f.grade = 3;
    expect(facilityUpkeep(f)).toBeGreaterThan(base);
  });
  it('古くなると人気が落ちて下限で止まり、改装した日に戻る', () => {
    expect(freshness({ renov: 100 }, 100)).toBe(1);
    expect(freshness({ renov: 100 }, 500)).toBeLessThan(1);
    expect(freshness({ renov: 0 }, 99999)).toBe(FRESH_MIN);
  });
  it('満足度: 料金が設備に見合うと上がり、割高だと下がる。評判は満足度に少しずつ近づく', () => {
    const o = { grade: 2, served: true, crowded: false, fresh: 1 };
    expect(satisfaction({ ...o, priceMul: 0.6 })).toBeGreaterThan(satisfaction({ ...o, priceMul: fairPrice(2) }));
    expect(satisfaction({ ...o, priceMul: 1.5 })).toBeLessThan(satisfaction({ ...o, priceMul: fairPrice(2) }));
    const r = nextRep(50, 90);
    expect(r).toBeGreaterThan(50);
    expect(r).toBeLessThan(90);
    expect(repMul(100)).toBeGreaterThan(repMul(0));
  });
  it('1日の締め: グレードが高いと売上が増え、割高にし続けると評判が下がり来場者が減っていく', () => {
    const run = (grade: number, price: number, days: number) => {
      const map = world();
      const tr = new Transit(map, () => 0.5);
      const f = placeFacility(map, planFacility(map, 30, 30, 'hotel', () => false), 'hotel');
      f.grade = grade;
      f.price = price;
      let income = 0;
      let last = 0;
      for (let d = 1; d <= days; d++) {
        const before = f.visits ?? 0;
        dailyVisitors(map, tr, d, () => 0.5, (_f, a) => (income += a));
        last = (f.visits ?? 0) - before;
      }
      return { income, last, rep: f.rep ?? 50 };
    };
    expect(run(3, 2, 1).income).toBeGreaterThan(run(1, 2, 1).income); // 同じ料金なら高グレードのほうが稼ぐ
    const cheap = run(1, 1, 60);
    const dear = run(1, 4, 60);
    expect(dear.rep).toBeLessThan(cheap.rep);
    expect(dear.last).toBeLessThan(run(1, 4, 1).last); // 日がたつほど来場者が減る
  });
});
