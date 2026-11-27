import { CONN } from './directions';
import type { GameMap } from './gameMap';
import { crossingOk } from './tileRules';
import kit from '../data/stationKit.json';

/**
 * Station design (0..99) = 5 roofs x 5 color schemes x 4 station buildings.
 * For number d: roof = d % 5, color scheme = floor(d/5) % 5, building = floor(d/25).
 */
export const STATION_DESIGN_COUNT = 100;

/**
 * New station designs (assembled from sprite tiles): numbers 100-179, 80 designs (20 base styles x 4 variants).
 * Style = floor((d-100)/4), variant = (d-100) % 4 (0 = standard, 1 = other color, 2 = dark, 3 = snow). 0-99 use the earlier drawing method (for stations in existing saves).
 */
export const STATION_KIT_BASE = 100;
export const STATION_KIT_COUNT = kit.styles.length;
/** Upper limit (exclusive) of station design numbers */
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

/** Example: "Glass grand roof, blue, large station building" */
export function designName(design: number): string {
  if (isKitDesign(design)) return kit.styles[Math.min(STATION_KIT_COUNT - 1, design - STATION_KIT_BASE)].name;
  const { roof, palette, building } = designParts(design);
  return `${ROOF_STYLES[roof]}・${palette.name}・${BUILDING_STYLES[building]}`;
}
export const MAX_PLATFORM_LEN = 15;
export const MAX_TRACKS = 4;

/** The shape of a station (a group of platforms). design is 0..99 (above). Axis axis: 0 = north-south (long in +y) 1 = east-west (long in +x) */
export interface StationInfo {
  axis: 0 | 1;
  /** Platform length (tiles) */
  len: number;
  /** Number of platform tracks (number of parallel tracks) */
  tracks: number;
  design: number;
  /** Top-left (smallest x,y) tile */
  x0: number;
  y0: number;
}

export interface StationOptions {
  axis: 0 | 1;
  len: number;
  tracks: number;
  design: number;
}

/** Tile coordinates of the i-th tile of track t */
export function stationTile(s: StationInfo, t: number, i: number): [number, number] {
  return s.axis === 1 ? [s.x0 + i, s.y0 + t] : [s.x0 + t, s.y0 + i];
}

export function stationTiles(s: StationInfo): [number, number][] {
  const out: [number, number][] = [];
  for (let t = 0; t < s.tracks; t++) for (let i = 0; i < s.len; i++) out.push(stationTile(s, t, i));
  return out;
}

/** Connection bits along the axis (east-west = E|W, north-south = N|S) */
const axisBits = (axis: 0 | 1) => (axis === 1 ? CONN(1) | CONN(3) : CONN(0) | CONN(2));

export interface StationPlan {
  ok: boolean;
  reason?: string;
  info: StationInfo;
  tiles: [number, number][];
}

/**
 * Whether a station can be placed with (x0,y0) at the top left. Every tile must be land of the same height with no buildings, roads, airport, or bridges,
 * and the track must be absent or a straight line along the axis. occupied tells whether a tile is used by an existing station/waypoint.
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

/** Lay the track of the station area (connect each platform track along the axis; connections outward are not included) */
export function layStationTracks(map: GameMap, s: StationInfo): void {
  const bits = (i: number) => (i > 0 ? (s.axis === 1 ? CONN(3) : CONN(0)) : 0) | (i < s.len - 1 ? (s.axis === 1 ? CONN(1) : CONN(2)) : 0);
  for (let t = 0; t < s.tracks; t++) {
    for (let i = 0; i < s.len; i++) {
      const [x, y] = stationTile(s, t, i);
      const k = map.idx(x, y);
      // A one-tile station gets no provisional connections at both ends, so only the direction is known (if no bit is set, give it the axis direction)
      map.rail.set(k, map.rail.get(k) | (s.len === 1 ? axisBits(s.axis) & (s.axis === 1 ? CONN(1) : CONN(0)) : bits(i)));
      map.touch(x, y);
    }
  }
}
