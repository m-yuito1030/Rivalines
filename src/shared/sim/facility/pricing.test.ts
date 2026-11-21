import { describe, expect, it } from 'vitest';
import { GameMap } from '../../world/gameMap';
import { SEA_LEVEL } from '../../world/constants';
import { placeFacility, planFacility, type Facility } from '../../world/facilities';
import { Transit } from '../network/transit';
import { dailyVisitors } from './facilityVisitors';
import { PRICE_LEVELS, bestLevel, demandMul, elasticity, priceLevel, priceMul, revenueIndex } from './pricing';

describe('施設の料金', () => {
  it('標準は 1 倍で、段階が範囲外・未設定なら標準', () => {
    expect(PRICE_LEVELS[2].mul).toBe(1);
    expect(priceLevel({})).toBe(2);
    expect(priceLevel({ price: 9 })).toBe(2);
    expect(priceLevel({ price: 1.5 })).toBe(2);
    expect(priceMul({ price: 4 })).toBe(1.5);
  });
  it('料金を上げると来場者は減り、下げると増える(標準で 1)', () => {
    const k = 0.9;
    expect(demandMul(1, k)).toBe(1);
    expect(demandMul(1.5, k)).toBeLessThan(demandMul(1.25, k));
    expect(demandMul(0.6, k)).toBeGreaterThan(1);
  });
  it('いちばん儲かる料金は条件で変わる: 競合が多いと安く、競合がなく駅があると高く', () => {
    const rivals = bestLevel(elasticity('hotel', 4, false, false));
    const alone = bestLevel(elasticity('hotel', 0, true, true));
    expect(alone).toBeGreaterThan(rivals);
    expect(revenueIndex(1, 0.9)).toBe(1);
  });
  it('1日の締め: 高い料金は来場者が減るが、1人あたりの売上は増える。格安は逆', () => {
    const run = (price: number) => {
      const size = 64;
      const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 20));
      map.towns.push({ id: 1, name: 't', x: 32, y: 32, pop: 5000 } as never);
      const tr = new Transit(map, () => 0.5);
      const plan = planFacility(map, 30, 30, 'hotel', () => false);
      const f: Facility = placeFacility(map, plan, 'hotel');
      f.price = price;
      let income = 0;
      dailyVisitors(
        map,
        tr,
        1,
        () => 0.5,
        (_f, a) => (income += a),
      );
      return { visits: f.visits ?? 0, income };
    };
    const low = run(0);
    const std = run(2);
    const high = run(4);
    expect(low.visits).toBeGreaterThan(std.visits);
    expect(high.visits).toBeLessThan(std.visits);
    expect(high.income / high.visits).toBeGreaterThan(std.income / std.visits);
    expect(low.income / low.visits).toBeLessThan(std.income / std.visits);
  });
});
