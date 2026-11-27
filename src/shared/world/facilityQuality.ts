import type { Facility } from './facilities';

/**
 * Facility quality: grade (stars 1-5), reputation (0-100), and freshness (renovation).
 * Raising the grade increases spend per customer, the visitor cap, and upkeep. Reputation moves toward satisfaction each day (whether equipment suits the price, closeness to a station, crowding) and affects visitors.
 * Over time a facility gets old and loses popularity; renovation restores it.
 */
export const GRADE_MAX = 5;
export const REP_DEFAULT = 50;
/** How fast it ages (days). Without a renovation for this long, popularity drops to the minimum (FRESH_MIN) */
export const FRESH_DAYS = 800;
export const FRESH_MIN = 0.75;

export const gradeOf = (f: Pick<Facility, 'grade'>): number => (Number.isInteger(f.grade) && f.grade! >= 1 && f.grade! <= GRADE_MAX ? f.grade! : 1);
/** Multiplier on spend per customer, the visitor cap, and upkeep (1 star = 1.0) */
export const gradeSpendMul = (g: number): number => 1 + 0.25 * (g - 1);
export const gradeCapMul = (g: number): number => 1 + 0.1 * (g - 1);
export const gradeUpkeepMul = (g: number): number => 1 + 0.3 * (g - 1);
/** The price multiplier appropriate for that grade (above it the facility is "overpriced" and reputation falls) */
export const fairPrice = (g: number): number => 0.7 + 0.15 * g;

/** Cost to raise the grade by one / cost of a renovation (as a share of construction cost) */
export const upgradeCost = (build: number, g: number): number => Math.round((build * 0.5 * g) / 1000) * 1000;
export const renovateCost = (build: number): number => Math.round((build * 0.25) / 1000) * 1000;

/** Freshness (1 = just renovated to FRESH_MIN = old). renov is the day it was built / renovated (running day number) */
export const freshness = (f: Pick<Facility, 'renov'>, day: number): number => Math.max(FRESH_MIN, 1 - ((1 - FRESH_MIN) * Math.max(0, day - (f.renov ?? day))) / FRESH_DAYS);

export const repOf = (f: Pick<Facility, 'rep'>): number => (typeof f.rep === 'number' && f.rep >= 0 && f.rep <= 100 ? f.rep : REP_DEFAULT);
/** Multiplier of reputation on visitors (1 at reputation 50, 1.25 at 100, 0.75 at 0) */
export const repMul = (rep: number): number => 0.75 + (0.5 * rep) / 100;

/** Today's satisfaction (0-100). Reputation moves gradually toward it */
export function satisfaction(o: { grade: number; priceMul: number; served: boolean; crowded: boolean; fresh: number }): number {
  let s = 50 + 8 * (o.grade - 1);
  s += Math.max(-25, Math.min(25, 40 * (fairPrice(o.grade) - o.priceMul))); // whether the price suits the equipment
  if (o.served) s += 8;
  if (o.crowded) s -= 8;
  s += (o.fresh - 1) * 40; // falls when old
  return Math.max(0, Math.min(100, s));
}
/** Move reputation toward satisfaction (10% per day) */
export const nextRep = (rep: number, sat: number): number => Math.max(0, Math.min(100, rep + (sat - rep) * 0.1));
