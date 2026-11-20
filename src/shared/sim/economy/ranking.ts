import type { Company } from './economy';
import { RIVAL_SHARES, type Rival } from './rivals';
import type { GameMap } from '../../world/gameMap';
import type { Mode } from '../../data/models';
import type { Transit } from '../network/transit';
import { assetValue } from './economy';

export interface CompanyRow {
  name: string;
  /** 時価総額(円) */
  marketCap: number;
  /** 株価(円) */
  price: number;
  netWorth: number;
  /** 1日あたりの利益(円) */
  profit: number;
  passengers: number;
  isPlayer: boolean;
  /** 傘下に入った競合(自社に含まれる) */
  subsidiary: boolean;
}

/** 会社のランキング(時価総額の大きい順)。自社と、傘下に入っていない競合会社 */
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

/** 自社の順位(1始まり)と社数 */
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
/** 乗降人数(累計)の多い停留所 */
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
  /** 1日あたりの収入・利益(円) */
  income: number;
  profit: number;
  vehicles: number;
}
/** 路線の利益(1日あたり)の大きい順 */
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
