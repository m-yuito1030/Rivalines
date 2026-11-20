/** 競合する交通会社(架空)。路線網を詳細には動かさず、企業価値と利益が日々変動する。買収すると傘下に入り、利益が毎日入る */
export interface Rival {
  id: number;
  name: string;
  color: number;
  /** 企業価値(円) */
  value: number;
  /** 1日あたりの営業利益(円) */
  profit: number;
  /** 旅客数(累計。企業規模からの推定) */
  passengers: number;
  /** 自社が買収して傘下にしているか */
  acquired: boolean;
  /** マルチプレイ: 買収した会社(アカウントID) */
  acquiredBy?: number;
  /** 株価の履歴(企業価値÷株式数) */
  stockHistory: number[];
}

/** 競合の発行済み株式数 */
export const RIVAL_SHARES = 100_000;
/** 買収プレミアム(企業価値に対する上乗せ)と、売却(手放す)ときの割合 */
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

/** 1日ぶん企業価値を動かす(ゆるやかな成長 + ゆらぎ + まれに急変)。決定論的(rng はシミュレーションのもの) */
export function stepRivals(rivals: Rival[], rng: () => number): void {
  for (const r of rivals) {
    let g = 0.0006 + (rng() - 0.5) * 0.008;
    if (rng() < 0.02) g += (rng() < 0.5 ? -1 : 1) * (0.03 + rng() * 0.07); // 好決算・不祥事など
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

/** 競合会社を買収する。資金が足りなければ理由を返す。買収した会社が持つ民間施設は自社のものになる */
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

/** 傘下の会社を手放す(企業価値の80%で売却) */
export function divestRival(company: Company, r: Rival, ownerId?: number): number {
  if (!r.acquired || r.acquiredBy !== ownerId) return 0;
  const get = divestPrice(r);
  company.earn('sale', get);
  r.acquired = false;
  r.acquiredBy = undefined;
  return get;
}
