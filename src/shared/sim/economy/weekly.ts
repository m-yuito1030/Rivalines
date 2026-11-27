import { COST_CATS, type Company, REVENUE_CATS, assetValue } from './economy';
import type { GameMap } from '../../world/gameMap';
import type { Transit } from '../network/transit';
import type { Rival } from './rivals';

/** Weekly ranking: compete on gains since the start of the week (net assets, passengers, profit). Results are recorded and counting restarts every 7 days, so companies that joined later also get a chance to shine */
export const WEEK_DAYS = 7;

/** A company's cumulative metrics */
export interface Metrics {
  /** Net assets */
  nw: number;
  /** Passengers (cumulative) */
  pax: number;
  /** Profit (cumulative sales - expenses) */
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
  /** This week (week N) */
  week: number;
  base: [number, Metrics][];
  last?: WeeklyResult;
}

/** Cumulative sales - expenses */
export const profitTotalOf = (c: Company): number => REVENUE_CATS.reduce((a, k) => a + (c.total[k] ?? 0), 0) - COST_CATS.reduce((a, k) => a + (c.total[k] ?? 0), 0);

/** Cumulative metrics of company `id` (for the server) */
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

  /** Remove a deleted company from the baselines and from last week's result (so it cannot be shown as a winner) */
  forget(id: number): void {
    this.base.delete(id);
    if (this.last) this.last = { ...this.last, rows: this.last.rows.filter((r) => r.id !== id) };
  }

  /**
   * Day close (day = the day just closed). On the last day of a week, finalize the result and start counting again.
   * A company without a baseline (one that joined midway) starts counting from that day. Returns the result when finalized
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
  /** This week's gain */
  d: Metrics;
}

/** Progress so far this week (current metrics - the baseline at the start of the week). Largest net-asset gain first */
export function standings(state: WeeklyState, players: { id: number; name: string; netWorth: number; passengers: number; profitTotal: number }[]): Standing[] {
  const base = new Map(state.base);
  return players.map((p) => ({ id: p.id, name: p.name, d: diff({ nw: p.netWorth, pax: p.passengers, profit: p.profitTotal }, base.get(p.id)) })).sort((a, b) => b.d.nw - a.d.nw);
}

/** The top company per category in last week's result (categories: net assets, passengers, profit) */
export function winners(r: WeeklyResult | undefined): { nw?: number; pax?: number; profit?: number } {
  const best = (k: keyof Metrics): number | undefined => (r && r.rows.length ? [...r.rows].sort((a, b) => b[k] - a[k])[0].id : undefined);
  return { nw: best('nw'), pax: best('pax'), profit: best('profit') };
}
