import type { Stop } from '../network/transit';

/** Line development: develop around the company's own stops (level 0..max). At each level, new residents bring more passengers, and real-estate income based on the catchment population arrives every day */
export const DEV = { max: 3, demandUp: 0.15, incomePerPop: 30 } as const;
/** Cost to go from level to level+1 (capitalized as construction cost) */
export const devCost = (level: number): number => Math.round((3_000_000 * Math.pow(level + 1, 1.5)) / 100_000) * 100_000;
/** Daily real-estate income from a stop's development */
export const devIncome = (s: Pick<Stop, 'dev' | 'pop'>): number => Math.round((s.dev ?? 0) * s.pop * DEV.incomePerPop);
