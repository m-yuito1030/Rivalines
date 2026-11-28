import type { GameMap } from './gameMap';
import { CONN, DX, DY, opposite } from './directions';
import { lineTiles } from './roads';
import { yen } from '../sim/economy/economy';

/**
 * Subway tracks. Below the ground there are 4 depth levels (1 = shallowest, 4 = deepest). A subway tile is stored in its own layer (`map.subway`),
 * so it can lie under buildings, roads, and surface rails without conflicting with them.
 *
 * Byte of a subway tile: bits 0-3 = connections (N,E,S,W), bits 4-5 = depth - 1, bit 7 = a subway tile is here (a tile with no connection yet still counts).
 * Two connected tiles may differ by at most one depth level (that is the slope between depths).
 */
export const SUB_DEPTH_MAX = 4;
export const SUB_PRESENT = 0x80;

export const hasSub = (v: number): boolean => (v & SUB_PRESENT) !== 0;
export const subConn = (v: number): number => v & 15;
/** Depth 1..4 (only meaningful when hasSub(v)) */
export const subDepth = (v: number): number => ((v >> 4) & 3) + 1;
export const makeSub = (conn: number, depth: number): number => SUB_PRESENT | (conn & 15) | (((depth - 1) & 3) << 4);

/** Construction cost of one subway tile: deeper is dearer */
export const SUBWAY_COST = { base: 12_000, perDepth: 4_000 } as const;
export const subwayCost = (depth: number): number => SUBWAY_COST.base + SUBWAY_COST.perDepth * depth;

export type Tile = { x: number; y: number };

export interface SubwayIO {
  afford: (cost: number) => boolean;
  pay: (cost: number) => boolean;
  msg: (m: string) => void;
  /** Multiplayer: the company that owns the new tiles. Demolition only works on its own (or unowned) tiles */
  owner?: number;
}

const clampDepth = (z: unknown): number => Math.max(1, Math.min(SUB_DEPTH_MAX, Math.round(Number(z)) || 1));

/**
 * The tiles of a straight subway line from a to b (along the longer axis, like a road drag) with the depth of each tile: the depth goes evenly
 * from z0 at the start to z1 at the end (a slope). Null if the line is too short for that change of depth (at most one level per tile).
 */
export function subwayLine(a: Tile, b: Tile, z0: number, z1: number): { x: number; y: number; d: number; depth: number }[] | null {
  const tiles = lineTiles(a.x, a.y, b.x, b.y);
  const n = tiles.length - 1;
  const d0 = clampDepth(z0);
  const d1 = clampDepth(z1);
  if (Math.abs(d1 - d0) > n) return null;
  return tiles.map((t, i) => ({ ...t, depth: n === 0 ? d0 : Math.round(d0 + ((d1 - d0) * i) / n) }));
}

/** Whether a subway tile can be at (x,y): inside the map and on land (not under the sea or a lake) */
export const canDigAt = (map: GameMap, x: number, y: number): boolean => map.inBounds(x, y) && map.levelAt(x, y) > 0;

/** Lay a subway line (see subwayLine). A tile that already has subway keeps its depth (so joining an existing line just meets it). Stops with a message at the first problem */
export function layNewSubway(map: GameMap, a: Tile, b: Tile, z0: number, z1: number, io: SubwayIO): void {
  const line = subwayLine(a, b, z0, z1);
  if (!line) return void io.msg('距離が短すぎて、その深さの差にはできません(1タイルで深さは1段まで)');
  let prev: { x: number; y: number; depth: number } | null = null;
  let spent = 0;
  for (const t of line) {
    if (!canDigAt(map, t.x, t.y)) return void io.msg(spent > 0 ? `水の下には造れません。ここまでで ${yen(spent)}` : '水の下には造れません');
    const i = map.idx(t.x, t.y);
    let v = map.subway.get(i);
    const depth = hasSub(v) ? subDepth(v) : t.depth;
    if (prev && Math.abs(depth - prev.depth) > 1) return void io.msg('深さの差が大きすぎます(隣の線路とは1段までしか違えられません)');
    if (!hasSub(v)) {
      const cost = subwayCost(depth);
      if (!io.afford(cost) || !io.pay(cost)) return void io.msg(`資金が足りません(地下鉄は1タイル ${yen(cost)}〜)。ここまでで ${yen(spent)}`);
      spent += cost;
      v = makeSub(0, depth);
      map.subway.set(i, v);
      if (io.owner) map.subwayOwner.set(i, io.owner);
    }
    if (prev) {
      // t.d is the direction of travel into this tile (see the surface preview, which steps back with it)
      const pd = t.d;
      const pi = map.idx(prev.x, prev.y);
      map.subway.set(pi, map.subway.get(pi) | CONN(pd));
      map.subway.set(i, map.subway.get(i) | CONN(opposite(pd)));
    }
    prev = { x: t.x, y: t.y, depth };
  }
  map.subwayVer++;
}

/** Remove the subway tiles on a straight line (only the company's own, or unowned ones), and the connections to them */
export function removeSubwayLine(map: GameMap, a: Tile, b: Tile, io: SubwayIO): void {
  for (const t of lineTiles(a.x, a.y, b.x, b.y)) {
    if (!map.inBounds(t.x, t.y)) continue;
    const i = map.idx(t.x, t.y);
    if (!hasSub(map.subway.get(i))) continue;
    const own = map.subwayOwner.get(i);
    if (io.owner && own && own !== io.owner) continue;
    map.subway.set(i, 0);
    map.subwayOwner.set(i, 0);
    for (let d = 0; d < 4; d++) {
      const nx = t.x + DX[d];
      const ny = t.y + DY[d];
      if (!map.inBounds(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      const nv = map.subway.get(ni);
      if (hasSub(nv)) map.subway.set(ni, nv & ~CONN(opposite(d)));
    }
  }
  map.subwayVer++;
}
