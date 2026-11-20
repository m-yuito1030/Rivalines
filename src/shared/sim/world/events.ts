/**
 * 季節・天候・休日・イベント。日付(と世界の種)だけで決まる(状態を持たない)ので、サーバーとクライアントで同じ結果になり、セーブにも入らない。
 * 施設の需要(人口換算)に倍率として掛かる。
 */
import { calendarOf } from './calendar';
import type { Facility, FacilityType } from '../../world/facilities';

export type Weather = 'sunny' | 'cloudy' | 'rain' | 'snow';
export const WEATHER_ICON: Record<Weather, string> = { sunny: '☀', cloudy: '☁', rain: '🌧', snow: '❄' };
export const WEATHER_NAME: Record<Weather, string> = { sunny: '晴れ', cloudy: 'くもり', rain: '雨', snow: '雪' };

/** 決定論的な乱数(0以上1未満) */
export function hash01(a: number, b: number, c = 0): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function weatherOf(seed: number, day: number): Weather {
  const m = calendarOf(day).month;
  const r = hash01(seed, day, 1);
  const winter = m === 12 || m <= 2;
  const rainy = m === 6 || m === 7 || m === 9;
  if (winter && r < 0.12) return 'snow';
  if (r < (rainy ? 0.35 : 0.18)) return 'rain';
  if (r < (rainy ? 0.65 : 0.45)) return 'cloudy';
  return 'sunny';
}

/** 休日か(土日と、主な祝日・年末年始・お盆) */
export function isHoliday(day: number): boolean {
  const c = calendarOf(day);
  if (c.weekday === 0 || c.weekday === 6) return true;
  const md = c.month * 100 + c.day;
  return (
    md === 101 ||
    md === 102 ||
    md === 103 ||
    md === 211 ||
    md === 429 ||
    (md >= 503 && md <= 505) ||
    (md >= 813 && md <= 816) ||
    md === 1103 ||
    md === 1123 ||
    (md >= 1229 && md <= 1231)
  );
}

const LEISURE: FacilityType[] = ['stadium', 'amusement', 'park', 'mall', 'hotel'];

/** 季節の倍率(月ごと) */
export function seasonMul(type: FacilityType, month: number): number {
  const spring = month >= 3 && month <= 5;
  const summer = month >= 6 && month <= 8;
  const autumn = month >= 9 && month <= 11;
  switch (type) {
    case 'amusement':
      return spring || autumn ? 1.15 : summer ? 0.95 : 0.8;
    case 'park':
      return spring ? 1.3 : autumn ? 1.2 : summer ? 0.8 : 0.6;
    case 'stadium':
      return summer ? 1.1 : spring || autumn ? 1 : 0.8;
    case 'mall':
      return month === 12 ? 1.3 : month === 1 ? 1.2 : 1;
    case 'department':
      return month === 12 ? 1.3 : month === 7 || month === 1 ? 1.15 : 1;
    case 'hotel':
      return month === 8 || month === 1 || month === 5 ? 1.3 : 1;
    default:
      return 1;
  }
}

/** 天候の倍率 */
export function weatherMul(type: FacilityType, w: Weather): number {
  if (w === 'rain') return type === 'amusement' ? 0.5 : type === 'park' ? 0.4 : type === 'stadium' ? 0.7 : type === 'mall' || type === 'department' ? 1.15 : 1;
  if (w === 'snow') return type === 'amusement' ? 0.4 : type === 'park' ? 0.3 : type === 'stadium' ? 0.6 : type === 'mall' || type === 'department' ? 0.85 : 1;
  return 1;
}

export interface FacilityEvent {
  name: string;
  mul: number;
}

/** その日、その施設でイベントがあるか(施設の id と日で決まる) */
export function facilityEvent(seed: number, f: Pick<Facility, 'id' | 'type'>, day: number): FacilityEvent | null {
  const c = calendarOf(day);
  const hol = isHoliday(day);
  const r = hash01(seed, day, f.id * 7 + 3);
  switch (f.type) {
    case 'stadium':
      return r < (hol ? 0.45 : 0.2) ? { name: '試合', mul: 2.5 } : null;
    case 'amusement':
      return r < 0.15 ? { name: 'パレード', mul: 2 } : null;
    case 'mall':
      return r < 0.2 ? { name: 'セール', mul: 1.8 } : null;
    case 'department':
      return r < 0.2 ? { name: '催事', mul: 1.6 } : null;
    case 'hotel':
      return r < 0.1 ? { name: '団体客', mul: 1.5 } : null;
    case 'park':
      if (c.month === 3 || c.month === 4) return r < 0.4 ? { name: '花見', mul: 3 } : null;
      if (c.month === 11) return r < 0.3 ? { name: '紅葉まつり', mul: 2.5 } : null;
      if (c.month === 8) return r < 0.15 ? { name: '花火大会', mul: 3 } : null;
      return null;
    default:
      return null;
  }
}

/** 施設のその日の需要の倍率(季節 × 天候 × 休日 × イベント) */
export function facilityDayMul(seed: number, f: Pick<Facility, 'id' | 'type'>, day: number): number {
  const c = calendarOf(day);
  let m = seasonMul(f.type, c.month) * weatherMul(f.type, weatherOf(seed, day));
  if (isHoliday(day)) m *= LEISURE.includes(f.type) ? 1.4 : f.type === 'department' ? 1.2 : 1;
  const e = facilityEvent(seed, f, day);
  return e ? m * e.mul : m;
}

/** 自社の施設の、今日のイベント一覧(通知用) */
export function eventsToday(seed: number, facilities: Facility[], day: number, mine: (f: Facility) => boolean): { facility: Facility; event: FacilityEvent }[] {
  const out: { facility: Facility; event: FacilityEvent }[] = [];
  for (const f of facilities) {
    if (!mine(f)) continue;
    const event = facilityEvent(seed, f, day);
    if (event) out.push({ facility: f, event });
  }
  return out;
}
