import { CONN, DX8, DY8, OUT, opposite8 } from '../../world/directions';
import type { GameMap } from '../../world/gameMap';

/** Min-heap (key = f value) */
class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const { k, v } = this;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const { k, v } = this;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

/**
 * Shortest path over the road graph (one-way streets respected). Returns a list of tile indexes (including start and end).
 * Null if none is found or the search limit is exceeded.
 */
export function findPath(
  map: GameMap,
  from: number,
  to: number,
  rail = false,
  maxNodes = 300000,
  /** Rail: a tile's signal direction bits. Entering from a direction whose bit is not set is forbidden as one-way */
  signalMask?: (idx: number) => number,
): Uint32Array | null {
  // Rail searches see the surface rail and the subway together (see GameMap.railAt)
  const layer = rail ? { get: (i: number) => map.railAt(i) } : map.road;
  if (from === to) return Uint32Array.of(from);
  const s = map.size;
  const tx = to % s;
  const ty = Math.floor(to / s);
  // Cost: 10 straight, 14 diagonal. The heuristic is Manhattan for roads, octile for rails (admissible)
  const h = (x: number, y: number) => {
    const ax = Math.abs(x - tx);
    const ay = Math.abs(y - ty);
    return rail ? 10 * Math.max(ax, ay) + 4 * Math.min(ax, ay) : 10 * (ax + ay);
  };
  const nd = rail ? 8 : 4;
  const g = new Map<number, number>();
  const prev = new Map<number, number>();
  const open = new MinHeap();
  g.set(from, 0);
  open.push(h(from % s, Math.floor(from / s)), from);
  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === to) {
      const rev: number[] = [cur];
      let c = cur;
      while (c !== from) {
        c = prev.get(c)!;
        rev.push(c);
      }
      return Uint32Array.from(rev.reverse());
    }
    if (++expanded > maxNodes) return null;
    const cg = g.get(cur)!;
    const cx = cur % s;
    const cy = Math.floor(cur / s);
    const r = layer.get(cur);
    for (let d = 0; d < nd; d++) {
      if (!(r & (rail ? CONN(d) : OUT(d)))) continue;
      const nx = cx + DX8[d];
      const ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
      const ni = ny * s + nx;
      if (!(layer.get(ni) & CONN(opposite8(d)))) continue;
      if (signalMask) {
        const mk = signalMask(ni);
        if (mk && !(mk & (1 << d))) continue;
      }
      const ng = cg + (d < 4 ? 10 : 14);
      const old = g.get(ni);
      if (old !== undefined && old <= ng) continue;
      g.set(ni, ng);
      prev.set(ni, cur);
      open.push(ng + h(nx, ny), ni);
    }
  }
  return null;
}
