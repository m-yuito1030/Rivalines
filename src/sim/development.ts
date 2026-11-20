import type { Stop } from './transit';

/** 沿線開発: 自社の停留所の周りを開発する(開発度 0〜max)。開発度ごとに、新しい住民で乗客が増え、集客圏の人口に応じた不動産収入が毎日入る */
export const DEV = { max: 3, demandUp: 0.15, incomePerPop: 30 } as const;
/** 開発度 level → level+1 にする費用(建設費として資産計上) */
export const devCost = (level: number): number => Math.round((3_000_000 * Math.pow(level + 1, 1.5)) / 100_000) * 100_000;
/** 停留所の開発による1日の不動産収入 */
export const devIncome = (s: Pick<Stop, 'dev' | 'pop'>): number => Math.round((s.dev ?? 0) * s.pop * DEV.incomePerPop);
