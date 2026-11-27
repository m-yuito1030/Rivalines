import type { Company } from './economy';
import { RIVAL_SHARES, type Rival } from './rivals';
import type { GameMap } from '../../world/gameMap';
import type { Mode } from '../../data/models';
import type { Transit } from '../network/transit';
import { assetValue } from './economy';

export interface CompanyRow {
  name: string;
  /** Market capitalization (yen) */
  marketCap: number;
  /** Share price (yen) */
  price: number;
  netWorth: number;
  /** Profit per day (yen) */
  profit: number;
  passengers: number;
  isPlayer: boolean;
  /** Rivals acquired as subsidiaries (included in the company) */
  subsidiary: boolean;
}

/** Company ranking (largest market cap first): the player's company and the rivals not yet acquired */
export function companyRanking(company: Company, rivals: Rival[], map: GameMap, transit: Transit): CompanyRow[] {
  const assets = assetValue(map, transit, rivals);
  const rows: CompanyRow[] = [
    {
      name: '自社',
      marketCap: company.marketCap,
      price: company.stock,
      netWorth: company.netWorth(assets),
      profit: company.profitStats().avg,
      passengers: Math.floor(transit.delivered),
      isPlayer: true,
      subsidiary: false,
    },
  ];
  for (const r of rivals) {
    if (r.acquired) continue;
    rows.push({
      name: r.name,
      marketCap: r.value,
      price: r.value / RIVAL_SHARES,
      netWorth: r.value * 0.8,
      profit: r.profit,
      passengers: r.passengers,
      isPlayer: false,
      subsidiary: false,
    });
  }
  return rows.sort((a, b) => b.marketCap - a.marketCap);
}

/** The company's rank (1-based) and the number of companies */
export function playerRank(company: Company, rivals: Rival[], map: GameMap, transit: Transit): { rank: number; total: number } {
  const rows = companyRanking(company, rivals, map, transit);
  return { rank: rows.findIndex((r) => r.isPlayer) + 1, total: rows.length };
}

export interface TownRow {
  name: string;
  pop: number;
  stops: number;
  waiting: number;
}
export function townRanking(map: GameMap, transit: Transit): TownRow[] {
  const by = new Map<number, TownRow>();
  for (const t of map.towns) by.set(t.id, { name: t.name, pop: t.pop, stops: 0, waiting: 0 });
  for (const s of transit.stops.values()) {
    const e = by.get(s.townId);
    if (!e || s.waypoint) continue;
    e.stops++;
    e.waiting += Math.floor(s.waiting);
  }
  return [...by.values()].sort((a, b) => b.pop - a.pop);
}

export interface StopRow {
  name: string;
  kind: Mode;
  traffic: number;
  waiting: number;
}
/** Stops with the most boardings and alightings (cumulative) */
export function stopRanking(transit: Transit): StopRow[] {
  return [...transit.stops.values()]
    .filter((s) => !s.waypoint)
    .map((s) => ({ name: s.name, kind: s.kind, traffic: Math.floor(s.traffic ?? 0), waiting: Math.floor(s.waiting) }))
    .sort((a, b) => b.traffic - a.traffic);
}

export interface RouteRow {
  name: string;
  mode: Mode;
  carried: number;
  /** Income and profit per day (yen) */
  income: number;
  profit: number;
  vehicles: number;
}
/** Routes by profit (per day), largest first */
export function routeRanking(transit: Transit): RouteRow[] {
  return [...transit.routes.values()]
    .map((r) => ({
      name: r.name,
      mode: r.mode,
      carried: Math.floor(r.carried ?? 0),
      income: r.income ?? 0,
      profit: r.profit ?? 0,
      vehicles: transit.vehicles.filter((v) => v.routeId === r.id).length,
    }))
    .sort((a, b) => b.profit - a.profit || b.carried - a.carried);
}
