import type { Mode } from '../data/models';

/** 運賃: 乗車ごとの基本運賃 + 乗車距離(タイル)あたりの運賃 */
export const FARE: Record<Mode, { base: number; perTile: number }> = {
  road: { base: 60, perTile: 5 },
  rail: { base: 80, perTile: 8 },
  air: { base: 1500, perTile: 40 },
};

/** 路線ごとの運賃の倍率(1=標準)。高くすると1人あたりの収入は増えるが、停留所の乗客の発生が減る */
export const FARE_MUL_MIN = 0.5;
export const FARE_MUL_MAX = 2.5;
export const clampFareMul = (m: unknown): number => {
  const n = Number(m);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.max(FARE_MUL_MIN, Math.min(FARE_MUL_MAX, n)) * 10) / 10;
};
export const fareMulOf = (r: { fareMul?: number } | undefined): number => (r?.fareMul === undefined ? 1 : clampFareMul(r.fareMul));
/** 運賃の倍率に対する需要の倍率: 指数で減る(標準で1)。収入(倍率×需要)は倍率 1/0.9 付近で最大になる */
export const FARE_ELASTICITY = 0.9;
export const fareDemand = (mul: number): number => Math.max(0.1, Math.min(1.8, Math.exp(-FARE_ELASTICITY * (mul - 1))));
