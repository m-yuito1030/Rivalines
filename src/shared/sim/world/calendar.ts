/** ゲーム内の暦。2026年4月1日 06:00 に始まり、1日ずつ進む(実際の暦: 月の日数・うるう年あり) */
export const START = { year: 2026, month: 4, day: 1 } as const;
/** 期首は4月、決算は3月末(日本で一般的な3月決算) */
export const FISCAL_START_MONTH = 4;

export interface CalDate {
  year: number;
  month: number;
  day: number;
  /** 0=日曜 */
  weekday: number;
}

/** 開始日から dayIndex 日後の日付 */
export function calendarOf(dayIndex: number): CalDate {
  const d = new Date(Date.UTC(START.year, START.month - 1, START.day + dayIndex));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

/** 事業年度(期): 2026年4月〜2027年3月 = 第1期 */
export function fiscalPeriodOf(year: number, month: number): number {
  return year - START.year + (month >= FISCAL_START_MONTH ? 1 : 0);
}

/** 四半期(1〜4): 期首から3か月ごと(4〜6月=Q1) */
export function quarterOf(month: number): number {
  return Math.floor(((((month - FISCAL_START_MONTH) % 12) + 12) % 12) / 3) + 1;
}

/** 第 period 期の期間(開始日・終了日の表示文字列) */
export function fiscalRange(period: number): { from: string; to: string } {
  const y = START.year + period - 1;
  return { from: `${y}/${FISCAL_START_MONTH}/1`, to: `${y + 1}/${FISCAL_START_MONTH - 1}/${new Date(Date.UTC(y + 1, FISCAL_START_MONTH - 1, 0)).getUTCDate()}` };
}

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
