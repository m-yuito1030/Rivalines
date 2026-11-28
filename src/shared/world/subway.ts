import type { GameMap } from './gameMap';
import { CONN, DX, DX8, DY, DY8, opposite, opposite8 } from './directions';
import { railLineTiles } from './rails';
import { yen } from '../sim/economy/economy';

/**
 * Subway tracks. Below the ground there are 4 depth levels (1 = shallowest, 4 = deepest). A subway tile is stored in its own layer (`map.subway`),
 * so it can lie under buildings, roads, and surface rails without conflicting with them.
 *
 * Value of a subway tile (16 bits): bits 0-3 = connections N,E,S,W, bits 4-5 = depth - 1, bit 7 = a subway tile is here (a tile with no connection yet still counts),
 * bits 8-11 = the diagonal connections NE,SE,SW,NW (directions 4-7, the same as the surface rail). Tracks may run diagonally, as the surface rail does.
 * Two connected tiles may differ by at most one depth level (that is the slope between depths).
 */
export const SUB_DEPTH_MAX = 4;
export const SUB_PRESENT = 0x80;

export const hasSub = (v: number): boolean => (v & SUB_PRESENT) !== 0;
/** The bit of direction d (0-7) in a subway value */
export const subBit = (d: number): number => (d < 4 ? 1 << d : 1 << (8 + d - 4));
/** The connections as an 8-bit mask in the surface rail's layout (bit d = direction d, so bits 4-7 are the diagonals) */
export const subConn = (v: number): number => (v & 15) | (((v >> 8) & 15) << 4);
/** Depth 1..4 (only meaningful when hasSub(v)) */
export const subDepth = (v: number): number => ((v >> 4) & 3) + 1;
export const makeSub = (conn: number, depth: number): number => SUB_PRESENT | (conn & 15) | (((conn >> 4) & 15) << 8) | (((depth - 1) & 3) << 4);

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
 * The tiles of a straight subway line from a to b (along the longer axis, or diagonally when the drag is near 45 degrees, like the rail tool) with the depth of each tile: the depth goes evenly
 * from z0 at the start to z1 at the end (a slope). Null if the line is too short for that change of depth (at most one level per tile).
 */
export function subwayLine(a: Tile, b: Tile, z0: number, z1: number): { x: number; y: number; d: number; depth: number }[] | null {
  const tiles = railLineTiles(a.x, a.y, b.x, b.y);
  const n = tiles.length - 1;
  const d0 = clampDepth(z0);
  const d1 = clampDepth(z1);
  if (Math.abs(d1 - d0) > n) return null;
  return tiles.map((t, i) => ({ ...t, depth: n === 0 ? d0 : Math.round(d0 + ((d1 - d0) * i) / n) }));
}

/** Whether a subway tile can be at (x,y): inside the map and on land (not under the sea or a lake) */
export const canDigAt = (map: GameMap, x: number, y: number): boolean => map.inBounds(x, y) && map.levelAt(x, y) > 0 && map.rail.get(map.idx(x, y)) === 0;

/** Lay a subway line (see subwayLine). A tile that already has subway keeps its depth (so joining an existing line just meets it). Stops with a message at the first problem */
export function layNewSubway(map: GameMap, a: Tile, b: Tile, z0: number, z1: number, io: SubwayIO): void {
  const line = subwayLine(a, b, z0, z1);
  if (!line) return void io.msg('距離が短すぎて、その深さの差にはできません(1タイルで深さは1段まで)');
  let prev: { x: number; y: number; depth: number } | null = null;
  let spent = 0;
  for (const t of line) {
    if (!canDigAt(map, t.x, t.y)) {
      const why = map.inBounds(t.x, t.y) && map.levelAt(t.x, t.y) > 0 ? '地上の線路と同じ場所には造れません(地上の線路とは出入口でつなぎます)' : '水の下には造れません';
      return void io.msg(spent > 0 ? `${why}。ここまでで ${yen(spent)}` : why);
    }
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
      map.touch(t.x, t.y);
    }
    if (prev) {
      // t.d is the direction of travel into this tile (see the surface preview, which steps back with it)
      const pd = t.d;
      const pi = map.idx(prev.x, prev.y);
      map.subway.set(pi, map.subway.get(pi) | subBit(pd));
      map.subway.set(i, map.subway.get(i) | subBit(opposite8(pd)));
      map.touch(prev.x, prev.y);
      map.touch(t.x, t.y);
    }
    prev = { x: t.x, y: t.y, depth };
  }
  map.subwayVer++;
}

/** Price of a portal (the mouth where a subway meets a surface rail) */
export const PORTAL_COST = 30_000;

/**
 * Link the end of a subway line to a surface rail. The subway tile must be at depth 1 and the end of its line, and next to a surface rail that ends there
 * (a rail with one connection). Both tiles get a connection toward each other, so trains can run between them.
 */
export function layPortal(map: GameMap, p: Tile, io: SubwayIO): void {
  if (!map.inBounds(p.x, p.y)) return;
  const i = map.idx(p.x, p.y);
  const v = map.subway.get(i);
  if (!hasSub(v)) return void io.msg('地下鉄の線路の上をクリックしてください');
  if (subDepth(v) !== 1) return void io.msg('出入口にできるのは、いちばん浅い(深さ1)線路のはしだけです');
  const conn = subConn(v);
  if (conn === 0 || (conn & (conn - 1)) !== 0) return void io.msg('出入口にできるのは、線路のはし(つながりが1つだけの所)です');
  for (let d = 0; d < 4; d++) {
    if (conn & CONN(d)) continue;
    const nx = p.x + DX[d];
    const ny = p.y + DY[d];
    if (!map.inBounds(nx, ny)) continue;
    const ni = map.idx(nx, ny);
    const r = map.rail.get(ni);
    // A surface rail that ends here: one connection, straight directions only, and no span (bridge / tunnel)
    if (r === 0 || (r & 0xf0) !== 0 || (r & (r - 1)) !== 0 || map.span.get(ni)) continue;
    if (!io.afford(PORTAL_COST) || !io.pay(PORTAL_COST)) return void io.msg(`資金が足りません(出入口は ${yen(PORTAL_COST)})`);
    map.rail.set(ni, r | CONN(opposite(d)));
    map.subway.set(i, v | subBit(d));
    if (!map.infraOwner.get(ni) && io.owner) map.infraOwner.set(ni, io.owner);
    map.touch(nx, ny);
    map.touch(p.x, p.y);
    map.subwayVer++;
    return;
  }
  io.msg('となりに、そこで終わっている地上の線路がありません(線路のはしにつなぎます)');
}

/** Whether the tile holds subway track and no surface rail (a tile whose rail is underground) */
export const isUnderTile = (map: GameMap, i: number): boolean => hasSub(map.subway.get(i)) && map.rail.get(i) === 0;

/**
 * Remove the subway track of one tile (the links to the neighbours, and the portal link to a surface rail, go too). The caller checks who owns it.
 * Returns whether there was any.
 */
export function removeSubwayTile(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (!hasSub(map.subway.get(i))) return false;
  const had = subConn(map.subway.get(i));
  map.subway.set(i, 0);
  map.subwayOwner.set(i, 0);
  map.touch(x, y);
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d];
    const ny = y + DY8[d];
    if (!map.inBounds(nx, ny)) continue;
    const ni = map.idx(nx, ny);
    const nv = map.subway.get(ni);
    if (hasSub(nv)) {
      map.subway.set(ni, nv & ~subBit(opposite8(d)));
      map.touch(nx, ny);
    } else if (d < 4 && had & CONN(d) && map.rail.get(ni) & CONN(opposite(d))) {
      // The portal: take the link off the surface rail too
      map.rail.set(ni, map.rail.get(ni) & ~CONN(opposite(d)));
      map.touch(nx, ny);
    }
  }
  map.subwayVer++;
  return true;
}

/** Remove the subway tiles on a straight line (only the company's own, or unowned ones), and the connections to them */
export function removeSubwayLine(map: GameMap, a: Tile, b: Tile, io: SubwayIO): void {
  for (const t of railLineTiles(a.x, a.y, b.x, b.y)) {
    if (!map.inBounds(t.x, t.y)) continue;
    const i = map.idx(t.x, t.y);
    if (!hasSub(map.subway.get(i))) continue;
    const own = map.subwayOwner.get(i);
    if (io.owner && own && own !== io.owner) continue;
    removeSubwayTile(map, t.x, t.y);
  }
}
