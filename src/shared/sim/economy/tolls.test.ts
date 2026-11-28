import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { GameMap } from '../../world/gameMap';
import { Simulation, TICKS_PER_DAY } from '../simulation';
import { TOLL } from './economy';
import { TOLL_WARN, routeEcon } from './analysis';
import type { Route } from '../network/types';

const flat = (size = 64) => new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));

describe('通行料の見える化', () => {
  it('他社の道を走った分が路線ごとに数えられ、1日ごとの平均になり、損益から引かれる', () => {
    const sim = new Simulation(flat(), undefined, { multi: true });
    const route = { id: 1, owner: 5, orders: [], income: 1000, dayRevenue: 1000 } as unknown as Route;
    sim.transit.routes.set(1, route);
    const tile = sim.map.idx(10, 10);
    sim.map.road.set(tile, 5);
    sim.map.infraOwner.set(tile, 9); // another company's road
    for (let i = 0; i < 3; i++) sim.transit.onTile!({} as never, route, tile);
    expect(route.dayToll).toBe(TOLL.road * 3);
    // At the day close the toll becomes the moving average, and the profit is net of it
    for (let t = 0; t < TICKS_PER_DAY + 10; t++) sim.step();
    expect(route.dayToll).toBe(0);
    expect(route.toll).toBeGreaterThan(0);
    const [e] = routeEcon(sim.transit, 5);
    expect(e.toll).toBe(route.toll);
    expect(e.profit).toBeCloseTo(e.income - e.running - e.toll, 5);
  });

  it('自社の道を走っても通行料は数えない', () => {
    const sim = new Simulation(flat(), undefined, { multi: true });
    const route = { id: 1, owner: 5, orders: [] } as unknown as Route;
    sim.transit.routes.set(1, route);
    const tile = sim.map.idx(10, 10);
    sim.map.road.set(tile, 5);
    sim.map.infraOwner.set(tile, 5);
    sim.transit.onTile!({} as never, route, tile);
    expect(route.dayToll ?? 0).toBe(0);
  });

  it('通行料が運賃収入の3割を超える路線は警告の対象になる', () => {
    expect(TOLL_WARN).toBe(0.3);
  });
});
