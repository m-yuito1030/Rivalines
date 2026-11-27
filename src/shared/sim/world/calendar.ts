/** The in-game calendar. Starts at 06:00 on April 1, 2026 and advances one day at a time (a real calendar: month lengths and leap years) */
export const START = { year: 2026, month: 4, day: 1 } as const;
/** The fiscal year starts in April and closes at the end of March (the common March year-end in Japan) */
export const FISCAL_START_MONTH = 4;

export interface CalDate {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday */
  weekday: number;
}

/** The date dayIndex days after the start date */
export function calendarOf(dayIndex: number): CalDate {
  const d = new Date(Date.UTC(START.year, START.month - 1, START.day + dayIndex));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

/** Fiscal year (period): April 2026 to March 2027 = period 1 */
export function fiscalPeriodOf(year: number, month: number): number {
  return year - START.year + (month >= FISCAL_START_MONTH ? 1 : 0);
}

/** Quarter (1-4): every three months from the start of the period (April-June = Q1) */
export function quarterOf(month: number): number {
  return Math.floor(((((month - FISCAL_START_MONTH) % 12) + 12) % 12) / 3) + 1;
}

/** The span of period `period` (display strings for the start and end dates) */
export function fiscalRange(period: number): { from: string; to: string } {
  const y = START.year + period - 1;
  return { from: `${y}/${FISCAL_START_MONTH}/1`, to: `${y + 1}/${FISCAL_START_MONTH - 1}/${new Date(Date.UTC(y + 1, FISCAL_START_MONTH - 1, 0)).getUTCDate()}` };
}

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
