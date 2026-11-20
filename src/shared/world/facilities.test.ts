import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/simulation';
import { DAY_TICKS, Transit } from '../sim/network/transit';
import { SEA_LEVEL } from './constants';
import { FACILITY_SPECS, FACILITY_TILE, facilitiesNear, facilityAt, facilityAttract, hourFactor, isSpriteFacility, planFacility, placeFacility, spriteDims } from './facilities';
import { GameMap } from './gameMap';
import { bulldoze, connect } from './roads';

const flat = (size = 128) => new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));

describe('スプライトの施設(百貨店・モール)', () => {
  it('敷地は大きさで決まり(S/M=1x1、L=2x2)、プレイヤーが建てるのは L。需要は大きさで変わる。designが無い古い施設は手続き描画のまま', () => {
    expect(spriteDims('L')).toEqual({ w: 2, h: 2 });
    expect(spriteDims('S')).toEqual({ w: 1, h: 1 });
    expect(FACILITY_SPECS.department.w).toBe(2);
    expect(FACILITY_SPECS.mall.h).toBe(2);
    const m = flat();
    const none = () => false;
    const dept = placeFacility(m, planFacility(m, 40, 40, 'department', none), 'department');
    expect(dept.w).toBe(2);
    expect(isSpriteFacility(dept)).toBe(false); // design 未設定(古いセーブ相当)
    dept.size = 'L';
    dept.design = 3;
    expect(isSpriteFacility(dept)).toBe(true);
    const small = placeFacility(m, planFacility(m, 60, 60, 'mall', none, spriteDims('S')), 'mall');
    small.size = 'S';
    small.design = 1;
    expect(small.w).toBe(1);
    expect(facilityAttract(small)).toBe(FACILITY_SPECS.mall.attract * 0.5);
    expect(facilityAttract(dept)).toBe(FACILITY_SPECS.department.attract);
    const old = { ...dept, design: undefined, size: undefined };
    expect(facilityAttract(old)).toBe(FACILITY_SPECS.department.attract);
    expect(isSpriteFacility({ ...dept, type: 'stadium' })).toBe(false);
  });
});

describe('大型施設', () => {
  it('設置できる条件、敷地の占有、撤去(1タイルのブルドーザーで施設ごと)', () => {
    const m = flat();
    const none = () => false;
    const plan = planFacility(m, 40, 40, 'stadium', none);
    expect(plan.ok).toBe(true);
    expect(plan.tiles).toHaveLength(16);
    const f = placeFacility(m, plan, 'stadium');
    expect(m.facilities).toHaveLength(1);
    for (const [x, y] of plan.tiles) expect(m.building.get(m.idx(x, y))).toBe(FACILITY_TILE);
    expect(facilityAt(m, plan.x0 + 1, plan.y0 + 2)?.id).toBe(f.id);
    // 重なり・道路・建物・範囲外・停留所は不可
    expect(planFacility(m, 41, 41, 'park', none).ok).toBe(false);
    m.building.set(m.idx(80, 80), 3);
    expect(planFacility(m, 80, 80, 'mall', none).ok).toBe(false);
    connect(m, 100, 100, 1, false);
    expect(planFacility(m, 100, 100, 'park', none).ok).toBe(false);
    expect(planFacility(m, 1, 1, 'amusement', none).ok).toBe(false);
    expect(planFacility(m, 60, 60, 'park', () => true).ok).toBe(false);
    // 段差のある土地は不可
    m.height[60 * 128 + 60] = SEA_LEVEL + 40;
    expect(planFacility(m, 60, 60, 'mall', none).ok).toBe(false);
    // 撤去
    bulldoze(m, plan.x0 + 2, plan.y0 + 2);
    expect(m.facilities).toHaveLength(0);
    for (const [x, y] of plan.tiles) expect(m.building.get(m.idx(x, y))).toBe(0);
  });
  it('時間帯の係数と、停留所の集客圏の需要(夜のスタジアムは夕方に強い)', () => {
    const st = FACILITY_SPECS.stadium;
    expect(hourFactor(st, 19)).toBe(1);
    expect(hourFactor(st, 10)).toBeCloseTo(0.15);
    expect(hourFactor(st, 16.5)).toBeGreaterThan(0.15);
    expect(hourFactor(st, 16.5)).toBeLessThan(1);
    const m = flat();
    const tr = new Transit(m);
    for (let x = 30; x < 50; x++) connect(m, x, 50, 1, false);
    const stop = tr.addStop(40, 50)!;
    placeFacility(
      m,
      planFacility(m, 40, 54, 'stadium', () => false),
      'stadium',
    );
    expect(facilitiesNear(m, 40, 50, 4)).toHaveLength(1);
    for (let t = 0; t < 120; t++) tr.step(t); // 集客圏の更新(100tickごと)
    expect(stop.fpop).toBe(FACILITY_SPECS.stadium.attract);
    const demand = (h: number) => (tr as unknown as { facilityDemand: (s: unknown, t: number) => number }).facilityDemand(stop, ((h * 60 - 6 * 60) / 1440) * DAY_TICKS + 0.5);
    expect(demand(19)).toBeGreaterThan(demand(11) * 4);
  });
  it('セーブ状態に施設が含まれ、復元で敷地ごと戻る', () => {
    const m = flat(64);
    const sim = new Simulation(m);
    placeFacility(
      m,
      planFacility(m, 20, 20, 'amusement', () => false),
      'amusement',
    );
    const state = JSON.parse(JSON.stringify(sim.state()));
    const m2 = flat(64);
    m2.building.copyFrom(m.building);
    const sim2 = new Simulation(m2, state);
    // 自分で置いた遊園地に加え、街が自動で建てる市役所なども保存・復元される
    expect(sim2.map.facilities.filter((f) => f.type === 'amusement')).toHaveLength(1);
    expect(sim2.map.facilities).toHaveLength(sim.map.facilities.length);
  });
});
