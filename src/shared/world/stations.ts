import { CONN } from './directions';
import type { GameMap } from './gameMap';
import { crossingOk } from './tileRules';
import kit from '../data/stationKit.json';

/**
 * 駅のデザイン(0..99)= 屋根 5種 × 配色 5種 × 駅舎 4種。
 * 番号 d: 屋根 = d % 5、配色 = ⌊d/5⌋ % 5、駅舎 = ⌊d/25⌋。
 */
export const STATION_DESIGN_COUNT = 100;

/**
 * 新しい駅のデザイン(スプライトのタイルで組み立てる): 番号 100〜179 の80種(基本の様式20 × 変種4)。
 * 様式 = ⌊(d-100)/4⌋、変種 = (d-100) % 4(0=標準 1=別色 2=ダーク 3=雪景色)。0〜99 は従来の描き方(セーブ済みの駅用)。
 */
export const STATION_KIT_BASE = 100;
export const STATION_KIT_COUNT = kit.styles.length;
/** 駅のデザイン番号の上限(含まない) */
export const STATION_DESIGN_MAX = STATION_KIT_BASE + STATION_KIT_COUNT;
export const isKitDesign = (design: number): boolean => design >= STATION_KIT_BASE;
export const ROOF_STYLES = ['屋根なし(待合のみ)', '部分屋根', '全長屋根', 'ガラス大屋根', 'アーチ屋根'] as const;
export const BUILDING_STYLES = ['駅舎なし', '券売所', '駅舎', '大駅舎'] as const;
export interface StationPalette {
  name: string;
  slab: number;
  roof: number;
  post: number;
  wall: number;
  bldRoof: number;
}
export const STATION_PALETTES: StationPalette[] = [
  { name: 'ブルー', slab: 0xc8c3b8, roof: 0x2f7dd1, post: 0x6e7279, wall: 0xd8c9a8, bldRoof: 0x3b5f86 },
  { name: 'グリーン', slab: 0xbdc4b4, roof: 0x3f9a58, post: 0x5f6f62, wall: 0xe0dccb, bldRoof: 0x2e6b40 },
  { name: 'レッド', slab: 0xcbbfb4, roof: 0xc4473a, post: 0x7a6a66, wall: 0xe6d3bd, bldRoof: 0x7a3b32 },
  { name: 'グレー', slab: 0xd2d2d0, roof: 0x6c7480, post: 0x555a62, wall: 0xe9e9ea, bldRoof: 0x4a5058 },
  { name: 'ウッド', slab: 0xb9a88e, roof: 0x8b6b45, post: 0x6b5a46, wall: 0xcdb48f, bldRoof: 0x5c4630 },
];

export function designParts(design: number): { roof: number; palette: StationPalette; building: number } {
  const d = Math.max(0, Math.min(STATION_DESIGN_COUNT - 1, Math.floor(design) || 0));
  return { roof: d % 5, palette: STATION_PALETTES[Math.floor(d / 5) % 5], building: Math.floor(d / 25) };
}

/** 例: 「ガラス大屋根・ブルー・大駅舎」 */
export function designName(design: number): string {
  if (isKitDesign(design)) return kit.styles[Math.min(STATION_KIT_COUNT - 1, design - STATION_KIT_BASE)].name;
  const { roof, palette, building } = designParts(design);
  return `${ROOF_STYLES[roof]}・${palette.name}・${BUILDING_STYLES[building]}`;
}
export const MAX_PLATFORM_LEN = 15;
export const MAX_TRACKS = 4;

/** 駅(ホーム群)の形。design は 0..99(上記)。軸 axis: 0=南北(+y方向に長い) 1=東西(+x方向に長い) */
export interface StationInfo {
  axis: 0 | 1;
  /** ホームの長さ(タイル) */
  len: number;
  /** 番線数(平行な線路の本数) */
  tracks: number;
  design: number;
  /** 左上(最小 x,y)のタイル */
  x0: number;
  y0: number;
}

export interface StationOptions {
  axis: 0 | 1;
  len: number;
  tracks: number;
  design: number;
}

/** 番線 t の i 番目のタイル座標 */
export function stationTile(s: StationInfo, t: number, i: number): [number, number] {
  return s.axis === 1 ? [s.x0 + i, s.y0 + t] : [s.x0 + t, s.y0 + i];
}

export function stationTiles(s: StationInfo): [number, number][] {
  const out: [number, number][] = [];
  for (let t = 0; t < s.tracks; t++) for (let i = 0; i < s.len; i++) out.push(stationTile(s, t, i));
  return out;
}

/** 軸方向の接続ビット(東西=E|W, 南北=N|S) */
const axisBits = (axis: 0 | 1) => (axis === 1 ? CONN(1) | CONN(3) : CONN(0) | CONN(2));

export interface StationPlan {
  ok: boolean;
  reason?: string;
  info: StationInfo;
  tiles: [number, number][];
}

/**
 * (x0,y0) を左上として駅を置けるか。全タイルが同じ高さの陸で、建物・道路・空港・橋がなく、
 * 線路は無いか軸方向の直線のみ。occupied は既存の駅/経由点が使っているタイルかの判定。
 */
export function planStation(map: GameMap, x0: number, y0: number, o: StationOptions, occupied: (idx: number) => boolean): StationPlan {
  const len = Math.max(1, Math.min(MAX_PLATFORM_LEN, Math.floor(o.len)));
  const tracks = Math.max(1, Math.min(MAX_TRACKS, Math.floor(o.tracks)));
  const info: StationInfo = { axis: o.axis, len, tracks, design: Math.max(0, Math.min(STATION_DESIGN_MAX - 1, Math.floor(o.design) || 0)), x0, y0 };
  const tiles = stationTiles(info);
  const fail = (reason: string): StationPlan => ({ ok: false, reason, info, tiles });
  const ab = axisBits(o.axis);
  const lv = map.inBounds(x0, y0) ? map.levelAt(x0, y0) : 0;
  for (const [x, y] of tiles) {
    if (!map.inBounds(x, y)) return fail('マップの範囲外です');
    if (map.levelAt(x, y) !== lv || lv === 0) return fail('全タイルを同じ高さの陸地にしてください');
    const i = map.idx(x, y);
    if (map.building.get(i) || map.road.get(i) || map.air.get(i) || map.span.get(i)) return fail('建物・道路・空港・橋があります');
    if (occupied(i)) return fail('既存の駅・経由点と重なっています');
    const r = map.rail.get(i);
    if (r !== 0 && (r & ~ab) !== 0) return fail('既存の線路が分岐・交差しています(直線の線路のみ可)');
    if (!crossingOk(map.road.get(i), r)) return fail('道路と交差できません');
  }
  return { ok: true, info, tiles };
}

/** 駅の範囲の線路を敷く(各番線を軸方向に連結。外側への接続は含めない) */
export function layStationTracks(map: GameMap, s: StationInfo): void {
  const bits = (i: number) => (i > 0 ? (s.axis === 1 ? CONN(3) : CONN(0)) : 0) | (i < s.len - 1 ? (s.axis === 1 ? CONN(1) : CONN(2)) : 0);
  for (let t = 0; t < s.tracks; t++) {
    for (let i = 0; i < s.len; i++) {
      const [x, y] = stationTile(s, t, i);
      const k = map.idx(x, y);
      // 1タイルだけの駅は、向きだけ分かるよう両端に仮の接続は付けない(ビットがなければ軸方向を付ける)
      map.rail.set(k, map.rail.get(k) | (s.len === 1 ? axisBits(s.axis) & (s.axis === 1 ? CONN(1) : CONN(0)) : bits(i)));
      map.touch(x, y);
    }
  }
}
