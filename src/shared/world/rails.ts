import { CONN, DX8, DY8, isDiag, opposite8 } from './directions';
import type { GameMap } from './gameMap';
import { crossingOk } from './tileRules';

/** The crossing diagonal direction between the two tiles (C, D) that share the corner of diagonal connection (x,y)->d */
function crossingDir(d: number): number {
  const dx = DX8[d];
  const dy = DY8[d];
  for (let e = 4; e < 8; e++) if (DX8[e] === -dx && DY8[e] === dy) return e;
  return -1;
}

/** Whether rail can be connected from (x,y) in direction d (0..7) */
export function canConnectRail(map: GameMap, x: number, y: number, d: number, slope = false): boolean {
  const nx = x + DX8[d];
  const ny = y + DY8[d];
  if (!map.inBounds(x, y) || !map.inBounds(nx, ny)) return false;
  const lv = map.levelAt(x, y);
  const nl = map.levelAt(nx, ny);
  // Up to a one-level height difference only straight track can connect with a slope (diagonals only at the same height)
  if (lv === 0 || nl === 0 || (lv !== nl && !(slope && !isDiag(d) && Math.abs(lv - nl) === 1))) return false;
  const a = map.idx(x, y);
  const b = map.idx(nx, ny);
  if (map.span.get(a) || map.span.get(b)) return false;
  // A subway tile cannot also carry a surface rail (the simulation reads both together)
  if (map.subway.get(a) || map.subway.get(b)) return false;
  if (map.building.get(a) || map.building.get(b) || map.air.get(a) || map.air.get(b)) return false;
  if (isDiag(d)) {
    // Cannot cross a diagonal track that connects the two tiles sharing a corner
    if (!map.inBounds(x + DX8[d], y) || !map.inBounds(x, y + DY8[d])) return false;
    const e = crossingDir(d);
    if (map.rail.get(map.idx(x + DX8[d], y)) & CONN(e)) return false;
  }
  return crossingOk(map.road.get(a), map.rail.get(a) | CONN(d)) && crossingOk(map.road.get(b), map.rail.get(b) | CONN(opposite8(d)));
}

export function connectRail(map: GameMap, x: number, y: number, d: number, slope = false): boolean {
  if (!canConnectRail(map, x, y, d, slope)) return false;
  const nx = x + DX8[d];
  const ny = y + DY8[d];
  map.rail.set(map.idx(x, y), map.rail.get(map.idx(x, y)) | CONN(d));
  map.rail.set(map.idx(nx, ny), map.rail.get(map.idx(nx, ny)) | CONN(opposite8(d)));
  map.touch(x, y);
  map.touch(nx, ny);
  return true;
}

export function disconnectRail(map: GameMap, x: number, y: number, d: number): void {
  if (!map.inBounds(x, y)) return;
  const nx = x + DX8[d];
  const ny = y + DY8[d];
  map.rail.set(map.idx(x, y), map.rail.get(map.idx(x, y)) & ~CONN(d));
  if (map.inBounds(nx, ny)) {
    map.rail.set(map.idx(nx, ny), map.rail.get(map.idx(nx, ny)) & ~CONN(opposite8(d)));
    map.touch(nx, ny);
  }
  map.touch(x, y);
}

/**
 * The tile list of a rail drag. If start -> end is roughly 45 degrees (ratio 0.5 to 2), diagonal; otherwise a straight line along the axis.
 * d is the direction (0..7) from each tile to the next.
 */
export function railLineTiles(x0: number, y0: number, x1: number, y1: number): { x: number; y: number; d: number }[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let d: number;
  let n: number;
  if (ax > 0 && ay > 0 && Math.min(ax, ay) * 2 > Math.max(ax, ay)) {
    d = dx > 0 ? (dy > 0 ? 5 : 4) : dy > 0 ? 6 : 7;
    n = Math.round((ax + ay) / 2);
  } else if (ax >= ay) {
    d = dx >= 0 ? 1 : 3;
    n = ax;
  } else {
    d = dy >= 0 ? 2 : 0;
    n = ay;
  }
  const out: { x: number; y: number; d: number }[] = [];
  for (let i = 0; i <= n; i++) out.push({ x: x0 + DX8[d] * i, y: y0 + DY8[d] * i, d });
  return out;
}

/** Min-heap (for the auto-laying search) */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number): void {
    let i = this.k.length;
    this.k.push(key);
    this.v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p];
      this.v[i] = this.v[p];
      i = p;
    }
    this.k[i] = key;
    this.v[i] = val;
  }
  pop(): number {
    const top = this.v[0];
    const lk = this.k.pop()!;
    const lv = this.v.pop()!;
    const n = this.k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.k[c + 1] < this.k[c]) c++;
        if (this.k[c] >= lk) break;
        this.k[i] = this.k[c];
        this.v[i] = this.v[c];
        i = c;
      }
      this.k[i] = lk;
      this.v[i] = lv;
    }
    return top;
  }
}

/**
 * The path for auto-laying rail: connect (a) -> (b) in 8 directions. Existing track edges are cheap, new ones expensive, and slopes (one-level difference) costly,
 * and edges that cannot be placed (buildings, crossings, water, differences of two or more levels, diagonal height differences) are not used. Null if none is found. The search is limited to 60000 nodes and distance 600.
 */
export function autoRailPath(map: GameMap, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; d: number }[] | null {
  if (!map.inBounds(a.x, a.y) || !map.inBounds(b.x, b.y)) return null;
  if (a.x === b.x && a.y === b.y) return null;
  if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) > 600) return null;
  const S = map.size;
  const start = a.y * S + a.x;
  const goal = b.y * S + b.x;
  const g = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const open = new Heap();
  const hh = (x: number, y: number) => {
    const dx = Math.abs(x - b.x);
    const dy = Math.abs(y - b.y);
    return 8 * Math.max(dx, dy) + 3 * Math.min(dx, dy);
  };
  open.push(hh(a.x, a.y), start);
  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) {
      const idxs = [cur];
      let c = cur;
      while (c !== start) {
        c = prev.get(c)!;
        idxs.push(c);
      }
      idxs.reverse();
      return idxs.map((i, k) => {
        const x = i % S;
        const y = (i - x) / S;
        const nx = k + 1 < idxs.length ? idxs[k + 1] % S : x;
        const ny = k + 1 < idxs.length ? Math.floor(idxs[k + 1] / S) : y;
        let d = 0;
        for (let q = 0; q < 8; q++) if (DX8[q] === Math.sign(nx - x) && DY8[q] === Math.sign(ny - y)) d = q;
        return { x, y, d };
      });
    }
    if (++expanded > 30000) return null;
    const cg = g.get(cur)!;
    const cx = cur % S;
    const cy = (cur - cx) / S;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d];
      const ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      if (!canConnectRail(map, cx, cy, d, true)) continue;
      const ni = ny * S + nx;
      const exists = (map.rail.get(cur) & CONN(d)) !== 0;
      let cost = exists ? 8 : d < 4 ? 10 : 14;
      if (!exists && map.levelAt(cx, cy) !== map.levelAt(nx, ny)) cost += 6;
      const ng = cg + cost;
      const old = g.get(ni);
      if (old !== undefined && old <= ng) continue;
      g.set(ni, ng);
      prev.set(ni, cur);
      open.push(ng + hh(nx, ny), ni);
    }
  }
  return null;
}
