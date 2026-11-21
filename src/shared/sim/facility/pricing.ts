import type { Facility, FacilityType } from '../../world/facilities';

/**
 * 施設の料金設定(宿泊料金・客単価)。5段階。
 * 料金を上げると1人あたりの売上は増えるが、来る人(買う人)は減る。下げると逆。
 * どの料金がいちばん儲かるかは、周辺の事情(近くに同じ種類の施設があるか・駅があるか・広告中か)で変わる。
 */
export interface PriceLevel {
  label: string;
  /** 客単価にかかる倍率 */
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

/** 施設の料金の段階(未設定は標準) */
export const priceLevel = (f: Pick<Facility, 'price'>): number => (Number.isInteger(f.price) && f.price! >= 0 && f.price! < PRICE_LEVELS.length ? f.price! : PRICE_DEFAULT);
export const priceMul = (f: Pick<Facility, 'price'>): number => PRICE_LEVELS[priceLevel(f)].mul;

/** 値上げへの敏感さの基本(種類ごと)。大きいほど、料金を上げたときに客が離れやすい */
const BASE_ELASTICITY: Partial<Record<FacilityType, number>> = {
  hotel: 0.9,
  department: 0.8,
  mall: 1.0,
  stadium: 0.7,
  amusement: 0.7,
  // 値上げに強い(わざわざ行く・経費で来る客)ほど小さく、身近でほかへ行きやすいほど大きく
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
 * 値上げへの敏感さ。近くに同じ種類の施設が多いほど敏感(他へ行ける)、駅が近い・広告中は少し鈍い(わざわざ来る客)。
 * same: 近くの同じ種類の施設の数、served: 集客圏に停留所があるか、ad: 広告が効いているか
 */
export function elasticity(type: FacilityType, same = 0, served = false, ad = false): number {
  const k = (BASE_ELASTICITY[type] ?? 0.9) + Math.min(0.5, 0.12 * same) - (served ? 0.12 : 0) - (ad ? 0.1 : 0);
  return Math.max(0.3, k);
}

/** 来場者(買う人)にかかる倍率。標準料金(1.0)で 1。 */
export const demandMul = (mul: number, k: number): number => Math.max(0.15, Math.min(1.8, 1 - k * (mul - 1)));

/** 1人あたりの売上 × 来場者の倍率 = 標準料金を 1 としたときの売上の指数 */
export const revenueIndex = (mul: number, k: number): number => mul * demandMul(mul, k);

/** 売上がいちばん大きくなる段階(0〜4) */
export function bestLevel(k: number): number {
  let best = 0;
  PRICE_LEVELS.forEach((l, i) => {
    if (revenueIndex(l.mul, k) > revenueIndex(PRICE_LEVELS[best].mul, k)) best = i;
  });
  return best;
}
