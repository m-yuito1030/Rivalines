import type { Mode } from '../../data/models';

/** Fares: a base fare per boarding + a fare per tile travelled */
export const FARE: Record<Mode, { base: number; perTile: number }> = {
  road: { base: 60, perTile: 5 },
  rail: { base: 80, perTile: 8 },
  air: { base: 1500, perTile: 40 },
};

/** Per-route fare multiplier (1 = standard). A higher value raises income per person but reduces passenger generation at stops */
export const FARE_MUL_MIN = 0.5;
export const FARE_MUL_MAX = 2.5;
export const clampFareMul = (m: unknown): number => {
  const n = Number(m);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.max(FARE_MUL_MIN, Math.min(FARE_MUL_MAX, n)) * 10) / 10;
};
export const fareMulOf = (r: { fareMul?: number } | undefined): number => (r?.fareMul === undefined ? 1 : clampFareMul(r.fareMul));
/** Demand multiplier for a fare multiplier: falls exponentially (1 at standard). Income (multiplier x demand) peaks near a multiplier of 1/0.9 */
export const FARE_ELASTICITY = 0.9;
export const fareDemand = (mul: number): number => Math.max(0.1, Math.min(1.8, Math.exp(-FARE_ELASTICITY * (mul - 1))));
