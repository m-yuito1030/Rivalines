import type { Catalog } from '../locale';

/** 曜日と月(日付の書き方で使う) */
export const JA_RULES: Catalog = {
  'weekday.0': '日',
  'weekday.1': '月',
  'weekday.2': '火',
  'weekday.3': '水',
  'weekday.4': '木',
  'weekday.5': '金',
  'weekday.6': '土',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`month.${i + 1}`, `${i + 1}月`])),
};
