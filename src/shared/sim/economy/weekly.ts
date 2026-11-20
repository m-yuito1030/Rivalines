import { COST_CATS, type Company, REVENUE_CATS, assetValue } from './economy';
import type { GameMap } from '../../world/gameMap';
import type { Transit } from '../network/transit';
import type { Rival } from './rivals';

/** 週間ランキング: 週の初めからの増分(純資産・旅客数・利益)で競う。7日ごとに結果を残して数え直すので、後から始めた会社にも見せ場がある */
export const WEEK_DAYS = 7;

/** 会社の累計の指標 */
export interface Metrics {
  /** 純資産 */
  nw: number;
  /** 旅客数(累計) */
  pax: number;
  /** 利益(売上 − 費用の累計) */
  profit: number;
}
export interface WeeklyRow extends Metrics {
  id: number;
}
export interface WeeklyResult {
  week: number;
  rows: WeeklyRow[];
}
export interface WeeklyState {
  /** 今週(第N週) */
  week: number;
  base: [number, Metrics][];
  last?: WeeklyResult;
}

/** 売上 − 費用の累計 */
export const profitTotalOf = (c: Company): number => REVENUE_CATS.reduce((a, k) => a + (c.total[k] ?? 0), 0) - COST_CATS.reduce((a, k) => a + (c.total[k] ?? 0), 0);

/** 会社 id の累計の指標(サーバー用) */
export function playerMetrics(sim: { map: GameMap; transit: Transit; rivals: Rival[]; players: Map<number, Company> }, id: number): Metrics {
  const co = sim.players.get(id)!;
  let pax = 0;
  for (const r of sim.transit.routes.values()) if (r.owner === id) pax += r.carried ?? 0;
  return { nw: co.netWorth(assetValue(sim.map, sim.transit, sim.rivals, id)), pax: Math.floor(pax), profit: profitTotalOf(co) };
}

const diff = (m: Metrics, b: Metrics | undefined): Metrics => (b ? { nw: m.nw - b.nw, pax: m.pax - b.pax, profit: m.profit - b.profit } : { nw: 0, pax: 0, profit: 0 });

export class Weekly {
  week = 1;
  private base = new Map<number, Metrics>();
  last?: WeeklyResult;

  /**
   * 日締め(day=今締めた日)。週の最後の日なら結果を確定して数え直す。
   * 基準を持たない会社(途中参加)は、その日から数え始める。確定したら結果を返す
   */
  onDay(day: number, ids: number[], metrics: (id: number) => Metrics): WeeklyResult | null {
    const boundary = (day + 1) % WEEK_DAYS === 0;
    let result: WeeklyResult | null = null;
    if (boundary) {
      const rows: WeeklyRow[] = [];
      for (const id of ids) if (this.base.has(id)) rows.push({ id, ...diff(metrics(id), this.base.get(id)) });
      result = this.last = { week: this.week, rows };
      this.week++;
      this.base.clear();
    }
    for (const id of ids) if (boundary || !this.base.has(id)) this.base.set(id, metrics(id));
    return result;
  }

  toJSON(): WeeklyState {
    return { week: this.week, base: [...this.base], last: this.last };
  }

  load(s: WeeklyState): void {
    this.week = s.week ?? 1;
    this.base = new Map(s.base ?? []);
    this.last = s.last;
  }
}

export interface Standing {
  id: number;
  name: string;
  /** 今週の増分 */
  d: Metrics;
}

/** 今週の途中経過(現在の指標 − 週の初めの基準)。純資産の増加が多い順 */
export function standings(state: WeeklyState, players: { id: number; name: string; netWorth: number; passengers: number; profitTotal: number }[]): Standing[] {
  const base = new Map(state.base);
  return players
    .map((p) => ({ id: p.id, name: p.name, d: diff({ nw: p.netWorth, pax: p.passengers, profit: p.profitTotal }, base.get(p.id)) }))
    .sort((a, b) => b.d.nw - a.d.nw);
}

/** 先週の結果の部門ごとの1位(部門: 純資産・旅客数・利益) */
export function winners(r: WeeklyResult | undefined): { nw?: number; pax?: number; profit?: number } {
  const best = (k: keyof Metrics): number | undefined => (r && r.rows.length ? [...r.rows].sort((a, b) => b[k] - a[k])[0].id : undefined);
  return { nw: best('nw'), pax: best('pax'), profit: best('profit') };
}
