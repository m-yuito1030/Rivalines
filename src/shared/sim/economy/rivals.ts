/** Competing transit companies (fictional). They do not run a detailed network; their value and profit just fluctuate daily. Acquiring one makes it a subsidiary whose profit arrives every day */
export interface Rival {
  id: number;
  name: string;
  color: number;
  /** Enterprise value (yen) */
  value: number;
  /** Operating profit per day (yen) */
  profit: number;
  /** Passengers (cumulative; estimated from company size) */
  passengers: number;
  /** Whether the player's company has acquired it as a subsidiary */
  acquired: boolean;
  /** Multiplayer: the acquiring company (account ID) */
  acquiredBy?: number;
  /** Share price history (enterprise value / number of shares) */
  stockHistory: number[];
}

/** Rivals' number of issued shares */
export const RIVAL_SHARES = 100_000;
/** Acquisition premium (markup over enterprise value) and the ratio when selling (letting go) */
export const ACQUIRE_PREMIUM = 1.15;
export const DIVEST_RATE = 0.8;

const NAMES = [
  'あおば急行電鉄',
  'つきみ高速鉄道',
  'ひなた交通',
  'しおかぜバス',
  'ほしぞらエア',
  'もみじ電気鉄道',
  'さざなみ交通',
  'やまぶき観光鉄道',
  'あかつき鉄道',
  'すみれ観光バス',
  'かもめエアライン',
  'みなと臨海鉄道',
  'ふじみ高原電鉄',
  'はるかぜ交通',
  'いちょう急行',
  'こもれび鉄道',
  'うみねこバス',
  'ときわ電鉄',
  'いなほ高速バス',
  'あさひ航空',
];
const COLORS = [0x2f9e6b, 0xc0392b, 0x2980b9, 0xd68910, 0x8e44ad, 0x16a085, 0xe84393, 0x34495e];

export function createRivals(rng: () => number, count = 4): Rival[] {
  const out: Rival[] = [];
  for (let i = 0; i < count; i++) {
    const value = Math.round((25_000_000 + rng() * 65_000_000) / 100_000) * 100_000;
    out.push({
      id: i + 1,
      name: NAMES[i % NAMES.length] + (i >= NAMES.length ? String(Math.floor(i / NAMES.length) + 1) : ''),
      color: COLORS[i % COLORS.length],
      value,
      profit: value * 0.0009,
      passengers: Math.floor(value / 400),
      acquired: false,
      stockHistory: [value / RIVAL_SHARES],
    });
  }
  return out;
}

/** Move the enterprise value by one day (gentle growth + noise + rare sudden changes). Deterministic (rng is the simulation's) */
export function stepRivals(rivals: Rival[], rng: () => number): void {
  for (const r of rivals) {
    let g = 0.0006 + (rng() - 0.5) * 0.008;
    if (rng() < 0.02) g += (rng() < 0.5 ? -1 : 1) * (0.03 + rng() * 0.07); // good results, scandals, etc.
    r.value = Math.max(5_000_000, Math.round(r.value * (1 + g)));
    r.profit = Math.round(r.value * 0.0009 * (0.6 + rng() * 0.8));
    r.passengers += Math.floor((r.value / 20_000) * (0.5 + rng()));
    r.stockHistory.push(r.value / RIVAL_SHARES);
    if (r.stockHistory.length > 60) r.stockHistory.shift();
  }
}

export const acquirePrice = (r: Rival): number => Math.round((r.value * ACQUIRE_PREMIUM) / 1000) * 1000;
export const divestPrice = (r: Rival): number => Math.round((r.value * DIVEST_RATE) / 1000) * 1000;

import type { Company } from './economy';
import type { GameMap } from '../../world/gameMap';

/** Acquire a rival. Returns the reason if funds are short. The private facilities the acquired company owns become the player's */
export function acquireRival(company: Company, r: Rival, map: GameMap, ownerId?: number): string | null {
  if (r.acquired) return 'すでに傘下です';
  const price = acquirePrice(r);
  if (!company.spend('acquire', price)) return `資金が足りません(買収額 ${price.toLocaleString()}円)`;
  r.acquired = true;
  r.acquiredBy = ownerId;
  for (const f of map.facilities) {
    if (f.owner === 'city' && f.ownerId === r.id) {
      f.owner = 'player';
      f.playerId = ownerId;
      f.ownerId = undefined;
    }
  }
  return null;
}

/** Let go of a subsidiary (sold at 80% of its enterprise value) */
export function divestRival(company: Company, r: Rival, ownerId?: number): number {
  if (!r.acquired || r.acquiredBy !== ownerId) return 0;
  const get = divestPrice(r);
  company.earn('sale', get);
  r.acquired = false;
  r.acquiredBy = undefined;
  return get;
}
