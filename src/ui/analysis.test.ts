import { describe, expect, it } from 'vitest';
import { devRows, facilityEcon, routeEcon, stopEcon, summarize } from './analysis';
import { FACILITY_SPECS, type Facility } from '../world/facilities';
import { RUNNING_RATE, vehiclePrice } from '../sim/economy';
import { modelOf } from '../data/models';
import type { Transit } from '../sim/transit';

const model = modelOf('');
const mk = () =>
  ({
    routes: new Map([
      [1, { id: 1, name: 'A', color: 0, mode: 'road', owner: 7, income: 100_000, carried: 5.9, orders: [{ stopId: 1 }, { stopId: 2 }] }],
      [2, { id: 2, name: 'B', color: 0, mode: 'road', owner: 8, orders: [{ stopId: 1 }] }],
    ]),
    vehicles: [{ routeId: 1, modelId: model.id, cars: 1, cap: 10, load: 5 }],
    stops: new Map([
      [1, { id: 1, name: 's1', kind: 'road', waiting: 150.5, owner: 7 }],
      [2, { id: 2, name: 's2', kind: 'road', waiting: 0, owner: 8 }],
      [3, { id: 3, name: 'w', kind: 'rail', waiting: 0, owner: 7, waypoint: true }],
    ]),
  }) as unknown as Transit;

describe('analysis', () => {
  it('路線: 持ち主で絞り、運行費を引いた損益を出す(収入が未定義でも0)', () => {
    const rs = routeEcon(mk(), 7);
    expect(rs).toHaveLength(1);
    const run = vehiclePrice(model, 1) * RUNNING_RATE;
    expect(rs[0]).toMatchObject({ vehicles: 1, income: 100_000, loadPct: 50, carried: 5 });
    expect(rs[0].profit).toBeCloseTo(100_000 - run);
    expect(routeEcon(mk())).toHaveLength(2);
    expect(routeEcon(mk(), 8)[0]).toMatchObject({ income: 0, vehicles: 0, loadPct: null });
  });

  it('停留所: 経由点と他社は除き、混雑率は上限で頭打ち・路線数を数える', () => {
    const ss = stopEcon(mk(), 7);
    expect(ss).toHaveLength(1);
    expect(ss[0]).toMatchObject({ waiting: 150, crowdPct: 50, routes: 2 });
  });

  it('施設: 自社(playerId)の民間施設だけ。損益=売上-維持費', () => {
    const f = (over: Partial<Facility>) => ({ id: 1, type: 'amusement', name: 'f', owner: 'player', playerId: 7, income: 200_000, visits: 9.9, ...over }) as Facility;
    const list = [f({}), f({ id: 2, playerId: 8 }), f({ id: 3, owner: 'city' })];
    const fe = facilityEcon(list, 7);
    expect(fe).toHaveLength(1);
    expect(fe[0]).toMatchObject({ income: 200_000, upkeep: FACILITY_SPECS.amusement.upkeep, visits: 9 });
    expect(fe[0].profit).toBe(200_000 - FACILITY_SPECS.amusement.upkeep);
  });

  it('集計: 赤字路線と車両のない路線を数える', () => {
    const rs = [
      { vehicles: 1, profit: -5 },
      { vehicles: 0, profit: 0 },
      { vehicles: 2, profit: 10 },
    ] as never[];
    expect(summarize(rs, [{ profit: 3 }] as never[])).toEqual({ routeProfit: 5, facilityProfit: 3, lossRoutes: 1, idleVehicles: 1 });
  });

  it('沿線開発: 自社の停留所(経由点を除く)を人口順に。次の費用と収入の増分を出し、最高なら null', () => {
    const t = {
      stops: new Map([
        [1, { id: 1, name: 'a', x: 1, y: 2, pop: 500, dev: 1, owner: 7 }],
        [2, { id: 2, name: 'b', x: 3, y: 4, pop: 900, owner: 7 }],
        [3, { id: 3, name: 'c', x: 5, y: 6, pop: 100, dev: 3, owner: 7 }],
        [4, { id: 4, name: 'd', x: 0, y: 0, pop: 999, owner: 8 }],
        [5, { id: 5, name: 'w', x: 0, y: 0, pop: 999, owner: 7, waypoint: true }],
      ]),
    } as unknown as Transit;
    const rows = devRows(t, 7);
    expect(rows.map((r) => r.id)).toEqual([2, 1, 3]);
    expect(rows[0]).toMatchObject({ dev: 0, income: 0, nextCost: 3_000_000 });
    expect(rows[0].nextGain).toBe(900 * 30);
    expect(rows[1].income).toBe(500 * 30);
    expect(rows[2].nextCost).toBeNull();
  });
});
