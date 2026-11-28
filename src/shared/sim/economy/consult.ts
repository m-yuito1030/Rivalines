import type { Facility } from '../../world/facilities';
import type { Town } from '../../world/town';
import { listedFacilities, listingLeft, askingPrice } from '../facility/listings';
import type { Transit } from '../network/transit';
import { devRows, routeEcon, stopEcon } from './analysis';
import type { Company } from './economy';
import { type Rival, acquirePrice } from './rivals';

export { CONSULT } from './consultTerms';

export type TipKind = 'start' | 'cash' | 'staff' | 'property' | 'rival' | 'lossRoute' | 'idleRoute' | 'crowd' | 'town' | 'dev' | 'loan' | 'train';

/** One piece of advice. The screen words it (kind + p); score is the importance (the most important first) */
export interface Tip {
  kind: TipKind;
  score: number;
  p: Record<string, string | number>;
  /** A place to jump to */
  x?: number;
  y?: number;
  /** A property to buy */
  buy?: number;
}

export interface ConsultInput {
  facilities: Facility[];
  towns: Town[];
  transit: Transit;
  company: Company;
  rivals: Rival[];
  day: number;
  ownerId?: number;
}

/** Days to earn back a price from a daily income (Infinity if there is no income) */
const payback = (price: number, daily: number): number => (daily > 0 ? price / daily : Infinity);
/** A score from a payback in days: quicker is better */
const paybackScore = (days: number): number => Math.max(10, Math.min(300, 320 - days));

/** The advice the consultant gives right now, most important first (at most `max`) */
export function consultTips(i: ConsultInput, max = 12): Tip[] {
  const tips: Tip[] = [];
  const { company: c, transit: t } = i;
  const mine = (id: number | undefined) => i.ownerId === undefined || id === i.ownerId;
  const routes = routeEcon(t, i.ownerId);
  const stops = stopEcon(t, i.ownerId);

  if (routes.length === 0) tips.push({ kind: 'start', score: 400, p: {} });
  if (c.cash < 3_000_000) tips.push({ kind: 'cash', score: 350, p: { cash: Math.round(c.cash) } });
  if (c.staffReady && c.staffMul < 0.95) tips.push({ kind: 'staff', score: 300, p: { pct: Math.round(c.staffMul * 100), need: c.staffReq, have: Math.floor(c.staff) } });

  // Good properties for sale: the quickest to earn back their price
  for (const f of listedFacilities({ facilities: i.facilities })) {
    const price = askingPrice(f);
    const days = payback(price, f.income ?? 0);
    if (!isFinite(days) || days > 400) continue;
    tips.push({
      kind: 'property',
      score: paybackScore(days),
      p: { name: f.name, price, income: Math.round(f.income ?? 0), days: Math.round(days), left: listingLeft(f, i.day), afford: c.cash >= price ? 1 : 0 },
      x: f.x0,
      y: f.y0,
      buy: f.id,
    });
  }
  // A rival worth buying
  for (const r of i.rivals) {
    if (r.acquired) continue;
    const price = acquirePrice(r);
    const days = payback(price, r.profit);
    if (isFinite(days) && days <= 800)
      tips.push({
        kind: 'rival',
        score: paybackScore(days / 2),
        p: { id: r.id, name: r.name, price, profit: Math.round(r.profit), days: Math.round(days), afford: c.cash >= price ? 1 : 0 },
      });
  }
  // Routes losing money, routes with no vehicle, and crowded stops
  for (const r of routes.filter((x) => x.vehicles > 0 && x.profit < 0))
    tips.push({ kind: 'lossRoute', score: 150 + Math.min(100, -r.profit / 5000), p: { name: r.name, loss: Math.round(-r.profit), load: r.loadPct ?? 0 } });
  for (const r of routes.filter((x) => x.vehicles === 0)) tips.push({ kind: 'idleRoute', score: 160, p: { name: r.name } });
  for (const s of stops.filter((x) => x.crowdPct >= 70)) {
    const st = t.stops.get(s.id);
    tips.push({ kind: 'crowd', score: 120 + s.crowdPct / 2, p: { name: s.name, pct: s.crowdPct }, x: st?.x, y: st?.y });
  }
  // Big towns without any of your stops nearby
  const own = [...t.stops.values()].filter((s) => !s.waypoint && mine(s.owner));
  for (const town of i.towns) {
    if (town.pop < 300) continue;
    if (own.some((s) => Math.hypot(s.x - town.x, s.y - town.y) < 18)) continue;
    tips.push({ kind: 'town', score: 80 + Math.min(100, town.pop / 100), p: { name: town.name, pop: Math.round(town.pop) }, x: town.x, y: town.y });
  }
  // Line development with the quickest payback
  let best: { row: ReturnType<typeof devRows>[number]; days: number } | null = null;
  for (const row of devRows(t, i.ownerId)) {
    if (row.nextCost === null || row.nextGain <= 0) continue;
    const days = payback(row.nextCost, row.nextGain);
    if (!best || days < best.days) best = { row, days };
  }
  if (best && best.days <= 600)
    tips.push({
      kind: 'dev',
      score: paybackScore(best.days / 2),
      p: { name: best.row.name, cost: best.row.nextCost!, gain: Math.round(best.row.nextGain), days: Math.round(best.days) },
      x: best.row.x,
      y: best.row.y,
    });
  if (c.loan > 0 && c.cash > c.loan * 1.5) tips.push({ kind: 'loan', score: 90, p: { loan: c.loan } });
  if (c.training === 0 && c.cash > 15_000_000) tips.push({ kind: 'train', score: 60, p: {} });

  // Keep the best few of each kind so one kind does not fill the list
  const perKind: Partial<Record<TipKind, number>> = {};
  const limit: Partial<Record<TipKind, number>> = { property: 3, lossRoute: 2, crowd: 2, town: 2, idleRoute: 2 };
  return tips
    .sort((a, b) => b.score - a.score)
    .filter((tp) => {
      const n = (perKind[tp.kind] = (perKind[tp.kind] ?? 0) + 1);
      return n <= (limit[tp.kind] ?? 1);
    })
    .slice(0, max);
}
