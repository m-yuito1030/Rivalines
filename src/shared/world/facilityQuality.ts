import type { Facility } from './facilities';

/**
 * 施設の質: グレード(★1〜5)・評判(0〜100)・新しさ(改装)。
 * グレードを上げると客単価・来場者の上限・維持費が増える。評判は日々、満足度(料金に見合う設備か・駅の近さ・混雑)に近づき、来場者に効く。
 * 時間がたつと古くなって人気が落ち、改装で戻せる。
 */
export const GRADE_MAX = 5;
export const REP_DEFAULT = 50;
/** 古くなる速さ(日)。これだけ改装しないと、人気は最低(FRESH_MIN)まで落ちる */
export const FRESH_DAYS = 800;
export const FRESH_MIN = 0.75;

export const gradeOf = (f: Pick<Facility, 'grade'>): number => (Number.isInteger(f.grade) && f.grade! >= 1 && f.grade! <= GRADE_MAX ? f.grade! : 1);
/** 客単価・来場者の上限・維持費にかかる倍率(★1=1.0) */
export const gradeSpendMul = (g: number): number => 1 + 0.25 * (g - 1);
export const gradeCapMul = (g: number): number => 1 + 0.1 * (g - 1);
export const gradeUpkeepMul = (g: number): number => 1 + 0.3 * (g - 1);
/** そのグレードにふさわしい料金の倍率(これより高いと「割高」で評判が下がる) */
export const fairPrice = (g: number): number => 0.7 + 0.15 * g;

/** グレードを1つ上げる費用 / 改装の費用(建設費に対する割合) */
export const upgradeCost = (build: number, g: number): number => Math.round((build * 0.5 * g) / 1000) * 1000;
export const renovateCost = (build: number): number => Math.round((build * 0.25) / 1000) * 1000;

/** 新しさ(1=改装したて 〜 FRESH_MIN=古い)。renov は建てた/改装した日(日の通し番号) */
export const freshness = (f: Pick<Facility, 'renov'>, day: number): number => Math.max(FRESH_MIN, 1 - ((1 - FRESH_MIN) * Math.max(0, day - (f.renov ?? day))) / FRESH_DAYS);

export const repOf = (f: Pick<Facility, 'rep'>): number => (typeof f.rep === 'number' && f.rep >= 0 && f.rep <= 100 ? f.rep : REP_DEFAULT);
/** 評判が来場者にかける倍率(評判50で1、100で1.25、0で0.75) */
export const repMul = (rep: number): number => 0.75 + (0.5 * rep) / 100;

/** 今日の満足度(0〜100)。評判はこれに向かって、少しずつ動く */
export function satisfaction(o: { grade: number; priceMul: number; served: boolean; crowded: boolean; fresh: number }): number {
  let s = 50 + 8 * (o.grade - 1);
  s += Math.max(-25, Math.min(25, 40 * (fairPrice(o.grade) - o.priceMul))); // 料金が設備に見合うか
  if (o.served) s += 8;
  if (o.crowded) s -= 8;
  s += (o.fresh - 1) * 40; // 古いと下がる
  return Math.max(0, Math.min(100, s));
}
/** 評判を満足度に近づける(1日に10%) */
export const nextRep = (rep: number, sat: number): number => Math.max(0, Math.min(100, rep + (sat - rep) * 0.1));
