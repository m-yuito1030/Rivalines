import type { Facility, FacilityType } from '../../world/facilities';

/**
 * Facility pricing (room rate, spend per customer). Five levels.
 * Raising the price increases sales per person but reduces the people who come (or buy). Lowering it does the opposite.
 * Which price earns the most depends on the surroundings (whether the same type of facility is nearby, whether there is a station, whether advertising is running).
 */
export interface PriceLevel {
  label: string;
  /** Multiplier on spend per customer */
  mul: number;
}
export const PRICE_LEVELS: PriceLevel[] = [
  { label: '格安', mul: 0.6 },
  { label: '割安', mul: 0.8 },
  { label: '標準', mul: 1 },
  { label: '割高', mul: 1.25 },
  { label: '高級', mul: 1.5 },
];
export const PRICE_DEFAULT = 2;

/** A facility's price level (unset means standard) */
export const priceLevel = (f: Pick<Facility, 'price'>): number => (Number.isInteger(f.price) && f.price! >= 0 && f.price! < PRICE_LEVELS.length ? f.price! : PRICE_DEFAULT);
export const priceMul = (f: Pick<Facility, 'price'>): number => PRICE_LEVELS[priceLevel(f)].mul;

/** Base price sensitivity (per type). The larger it is, the more customers leave when the price is raised */
const BASE_ELASTICITY: Partial<Record<FacilityType, number>> = {
  hotel: 0.9,
  department: 0.8,
  mall: 1.0,
  stadium: 0.7,
  amusement: 0.7,
  // The smaller for types people make a point of visiting or come to on expenses; the larger for convenient types where people can easily go elsewhere
  cinema: 1.0,
  zoo: 0.9,
  ski: 0.6,
  beach: 1.1,
  arena: 0.5,
  convention: 0.5,
  bizhotel: 0.7,
  campus: 1.1,
  golf: 0.6,
  hospital: 0.6,
  stationmall: 0.8,
};

/**
 * Price sensitivity. The more facilities of the same type nearby, the more sensitive (people can go elsewhere); a nearby station or running advertising makes it a little duller (people make a point of coming).
 * same: number of nearby facilities of the same type, served: whether a stop is in the catchment, ad: whether advertising is in effect
 */
export function elasticity(type: FacilityType, same = 0, served = false, ad = false): number {
  const k = (BASE_ELASTICITY[type] ?? 0.9) + Math.min(0.5, 0.12 * same) - (served ? 0.12 : 0) - (ad ? 0.1 : 0);
  return Math.max(0.3, k);
}

/** Multiplier on visitors (buyers). 1 at the standard price (1.0). */
export const demandMul = (mul: number, k: number): number => Math.max(0.15, Math.min(1.8, 1 - k * (mul - 1)));

/** Spend per person x visitor multiplier = a sales index with the standard price as 1 */
export const revenueIndex = (mul: number, k: number): number => mul * demandMul(mul, k);

/** The level (0-4) with the largest sales */
export function bestLevel(k: number): number {
  let best = 0;
  PRICE_LEVELS.forEach((l, i) => {
    if (revenueIndex(l.mul, k) > revenueIndex(PRICE_LEVELS[best].mul, k)) best = i;
  });
  return best;
}
