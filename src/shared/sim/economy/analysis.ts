import type { Mode } from '../../data/models';
import { modelOf } from '../../data/models';
import { FACILITY_SPECS, type Facility } from '../../world/facilities';
import { RUNNING_RATE, vehiclePrice } from './economy';
import { DEV, devCost, devIncome } from './development';
import { WAIT_CAP, type Transit } from '../network/transit';

/** 経営分析: 自社の路線・停留所・施設ごとの採算を集計する(表示用。ゲームの状態は変えない) */

export interface RouteEcon {
  id: number;
  name: string;
  color: number;
  mode: Mode;
  vehicles: number;
  /** 1日あたりの運賃収入(直近の移動平均) */
  income: number;
  /** 1日あたりの車両の運行費 */
  running: number;
  profit: number;
  loadPct: number | null;
  carried: number;
}

export interface StopEcon {
  id: number;
  name: string;
  kind: Mode;
  waiting: number;
  /** 待ち人数 / 待機の上限(%) */
  crowdPct: number;
  /** この停留所に停まる路線の数 */
  routes: number;
}

export interface FacilityEcon {
  id: number;
  name: string;
  type: string;
  income: number;
  upkeep: number;
  profit: number;
  visits: number;
}

export interface Summary {
  routeProfit: number;
  facilityProfit: number;
  lossRoutes: number;
  idleVehicles: number;
}

/** ownerId の路線ごとの採算。ownerId=undefined なら全路線(ソロ) */
export function routeEcon(t: Transit, ownerId?: number): RouteEcon[] {
  const out: RouteEcon[] = [];
  for (const r of t.routes.values()) {
    if (ownerId !== undefined && r.owner !== ownerId) continue;
    const vs = t.vehicles.filter((v) => v.routeId === r.id);
    const cap = vs.reduce((s, v) => s + v.cap, 0);
    const load = vs.reduce((s, v) => s + v.load, 0);
    const running = vs.reduce((s, v) => s + vehiclePrice(modelOf(v.modelId), v.cars) * RUNNING_RATE, 0);
    const income = r.income ?? 0;
    out.push({ id: r.id, name: r.name, color: r.color, mode: r.mode, vehicles: vs.length, income, running, profit: income - running, loadPct: cap ? Math.round((load / cap) * 100) : null, carried: Math.floor(r.carried ?? 0) });
  }
  return out;
}

/** ownerId の停留所ごとの混雑(経由点は除く) */
export function stopEcon(t: Transit, ownerId?: number): StopEcon[] {
  const count = new Map<number, number>();
  for (const r of t.routes.values()) for (const id of new Set(r.orders.map((o) => o.stopId))) count.set(id, (count.get(id) ?? 0) + 1);
  const out: StopEcon[] = [];
  for (const s of t.stops.values()) {
    if (s.waypoint || (ownerId !== undefined && s.owner !== ownerId)) continue;
    const waiting = Math.floor(s.waiting);
    out.push({ id: s.id, name: s.name, kind: s.kind, waiting, crowdPct: Math.min(100, Math.round((waiting / WAIT_CAP[s.kind]) * 100)), routes: count.get(s.id) ?? 0 });
  }
  return out;
}

/** ownerId の施設ごとの収支(売上は直近の1日の移動平均) */
export function facilityEcon(facilities: Facility[], ownerId?: number): FacilityEcon[] {
  const out: FacilityEcon[] = [];
  for (const f of facilities) {
    if ((f.owner ?? 'player') !== 'player') continue;
    if (ownerId !== undefined && f.playerId !== ownerId) continue;
    const upkeep = FACILITY_SPECS[f.type].upkeep;
    const income = f.income ?? 0;
    out.push({ id: f.id, name: f.name, type: FACILITY_SPECS[f.type].name, income, upkeep, profit: income - upkeep, visits: Math.floor(f.visits ?? 0) });
  }
  return out;
}

export function summarize(routes: RouteEcon[], facs: FacilityEcon[]): Summary {
  return {
    routeProfit: routes.reduce((a, r) => a + r.profit, 0),
    facilityProfit: facs.reduce((a, f) => a + f.profit, 0),
    lossRoutes: routes.filter((r) => r.vehicles > 0 && r.profit < 0).length,
    idleVehicles: routes.filter((r) => r.vehicles === 0).length,
  };
}

export interface DevRow {
  id: number;
  name: string;
  x: number;
  y: number;
  pop: number;
  dev: number;
  /** 今の開発度の不動産収入/日 */
  income: number;
  /** 次の開発度にする費用(最高なら null) */
  nextCost: number | null;
  /** 次の開発度で増える不動産収入/日 */
  nextGain: number;
}

/** 沿線開発の対象(自社の停留所。人口の多い順) */
export function devRows(t: Transit, ownerId?: number): DevRow[] {
  const out: DevRow[] = [];
  for (const s of t.stops.values()) {
    if (s.waypoint || (ownerId !== undefined && s.owner !== ownerId)) continue;
    const dev = s.dev ?? 0;
    out.push({ id: s.id, name: s.name, x: s.x, y: s.y, pop: Math.round(s.pop), dev, income: devIncome(s), nextCost: dev >= DEV.max ? null : devCost(dev), nextGain: dev >= DEV.max ? 0 : devIncome({ pop: s.pop, dev: dev + 1 }) - devIncome(s) });
  }
  return out.sort((a, b) => b.pop - a.pop);
}
