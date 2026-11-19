import type { Mode } from '../data/models';

/** 運賃: 乗車ごとの基本運賃 + 乗車距離(タイル)あたりの運賃 */
export const FARE: Record<Mode, { base: number; perTile: number }> = {
  road: { base: 60, perTile: 5 },
  rail: { base: 80, perTile: 8 },
  air: { base: 1500, perTile: 40 },
};
