/**
 * Seasons, weather, holidays, and events. Decided only by the date (and the world seed), with no state, so the server and clients get the same result and nothing is saved.
 * They multiply facility demand (in population terms).
 */
import { calendarOf } from './calendar';
import type { Facility, FacilityType } from '../../world/facilities';

export type Weather = 'sunny' | 'cloudy' | 'rain' | 'snow';
export const WEATHER_ICON: Record<Weather, string> = { sunny: '☀', cloudy: '☁', rain: '🌧', snow: '❄' };
export const WEATHER_NAME: Record<Weather, string> = { sunny: '晴れ', cloudy: 'くもり', rain: '雨', snow: '雪' };

/** Deterministic random number (0 or more, less than 1) */
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

/** Whether it is a holiday (weekends, major public holidays, New Year, Obon) */
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

const LEISURE: FacilityType[] = ['stadium', 'amusement', 'park', 'mall', 'hotel', 'cinema', 'zoo', 'ski', 'beach', 'arena', 'golf'];
/** Facilities that do well on weekdays (customers drop on holidays; universities especially) */
const BUSINESS: FacilityType[] = ['convention', 'bizhotel', 'campus'];

/** Seasonal multiplier (per month) */
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
    case 'cinema':
      return month === 12 || month === 1 ? 1.15 : 1;
    case 'zoo':
      return spring || autumn ? 1.2 : summer ? 1 : 0.7;
    case 'ski':
      return month === 12 ? 1.8 : month === 1 || month === 2 ? 2.6 : month === 3 ? 1.6 : month === 4 ? 0.3 : 0.05;
    case 'beach':
      return month === 7 || month === 8 ? 2.6 : month === 6 ? 1.2 : month === 9 ? 0.8 : month === 5 ? 0.5 : 0.1;
    case 'arena':
      return summer || autumn ? 1.1 : 1;
    case 'convention':
      return month === 3 || month === 9 || month === 10 || month === 11 ? 1.3 : month === 8 || month === 1 ? 0.7 : 1;
    case 'bizhotel':
      return month === 3 || month === 4 ? 1.2 : month === 8 || month === 12 || month === 1 ? 0.8 : 1;
    case 'campus':
      return month === 8 ? 0.3 : month === 3 ? 0.4 : month === 4 ? 1.2 : 1;
    case 'golf':
      return spring || autumn ? 1.4 : summer ? 0.8 : 0.5;
    case 'hospital':
      return month === 12 || month === 1 || month === 2 ? 1.2 : 1;
    case 'stationmall':
      return month === 12 ? 1.3 : month === 1 ? 1.1 : 1;
    default:
      return 1;
  }
}

/** Weather multiplier */
export function weatherMul(type: FacilityType, w: Weather): number {
  if (w === 'rain') {
    const m: Partial<Record<FacilityType, number>> = {
      amusement: 0.5,
      park: 0.4,
      stadium: 0.7,
      mall: 1.15,
      department: 1.15,
      cinema: 1.3,
      zoo: 0.7,
      ski: 0.5,
      beach: 0.2,
      arena: 0.9,
      golf: 0.3,
      stationmall: 1.1,
    };
    return m[type] ?? 1;
  }
  if (w === 'snow') {
    const m: Partial<Record<FacilityType, number>> = {
      amusement: 0.4,
      park: 0.3,
      stadium: 0.6,
      mall: 0.85,
      department: 0.85,
      cinema: 1.2,
      zoo: 0.5,
      ski: 1.6,
      beach: 0.1,
      arena: 0.8,
      golf: 0.2,
      stationmall: 0.9,
    };
    return m[type] ?? 1;
  }
  if (w === 'sunny') {
    const m: Partial<Record<FacilityType, number>> = { beach: 1.3, golf: 1.1, zoo: 1.1, ski: 0.9 };
    return m[type] ?? 1;
  }
  return 1;
}

export interface FacilityEvent {
  name: string;
  mul: number;
}

/** Whether there is an event at that facility that day (decided by facility id and day) */
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
    case 'cinema':
      return r < (hol ? 0.3 : 0.12) ? { name: 'ロードショー', mul: 2 } : null;
    case 'zoo':
      return r < 0.12 ? { name: 'ふれあいイベント', mul: 1.8 } : null;
    case 'ski':
      return c.month === 12 || c.month <= 3 ? (r < 0.12 ? { name: 'スキー大会', mul: 2.2 } : null) : null;
    case 'beach':
      return c.month === 7 || c.month === 8 ? (r < 0.12 ? { name: '花火大会', mul: 2.5 } : null) : null;
    case 'arena':
      return r < (hol ? 0.5 : 0.3) ? { name: 'コンサート', mul: 4 } : null;
    case 'convention':
      return r < 0.18 ? { name: '大型展示会', mul: 3 } : null;
    case 'bizhotel':
      return r < 0.1 ? { name: '出張ラッシュ', mul: 1.6 } : null;
    case 'campus':
      if (c.month === 11) return r < 0.25 ? { name: '学園祭', mul: 3 } : null;
      return c.month === 7 || c.month === 8 ? (r < 0.06 ? { name: 'オープンキャンパス', mul: 2 } : null) : null;
    case 'golf':
      return hol && r < 0.15 ? { name: 'コンペ', mul: 1.8 } : null;
    case 'stationmall':
      return r < 0.15 ? { name: 'フェア', mul: 1.6 } : null;
    case 'park':
      if (c.month === 3 || c.month === 4) return r < 0.4 ? { name: '花見', mul: 3 } : null;
      if (c.month === 11) return r < 0.3 ? { name: '紅葉まつり', mul: 2.5 } : null;
      if (c.month === 8) return r < 0.15 ? { name: '花火大会', mul: 3 } : null;
      return null;
    default:
      return null;
  }
}

/** The facility's demand multiplier for the day (season x weather x holiday x event) */
export function facilityDayMul(seed: number, f: Pick<Facility, 'id' | 'type'>, day: number): number {
  const c = calendarOf(day);
  let m = seasonMul(f.type, c.month) * weatherMul(f.type, weatherOf(seed, day));
  if (isHoliday(day))
    m *= LEISURE.includes(f.type) ? 1.4 : f.type === 'department' || f.type === 'stationmall' ? 1.2 : f.type === 'campus' ? 0.2 : BUSINESS.includes(f.type) ? 0.5 : 1;
  else if (BUSINESS.includes(f.type)) m *= 1.25;
  const e = facilityEvent(seed, f, day);
  return e ? m * e.mul : m;
}

/** List of today's events at the company's own facilities (for notifications) */
export function eventsToday(seed: number, facilities: Facility[], day: number, mine: (f: Facility) => boolean): { facility: Facility; event: FacilityEvent }[] {
  const out: { facility: Facility; event: FacilityEvent }[] = [];
  for (const f of facilities) {
    if (!mine(f)) continue;
    const event = facilityEvent(seed, f, day);
    if (event) out.push({ facility: f, event });
  }
  return out;
}
