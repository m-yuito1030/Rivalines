import type { GameMap } from '../../world/gameMap';
import { CONN, DX, DY } from '../../world/directions';
import { canConnect } from '../../world/roads';

export interface Tile {
  x: number;
  y: number;
}

/** A search limit, so planning one road never takes long (nodes expanded) */
const MAX_NODES = 120_000;
/** How far outside the box around the two ends the search may wander (tiles) */
const MARGIN = 40;

/** A minimal binary min-heap over [priority, value] */
class Heap {
  private a: [number, number][] = [];
  get size(): number {
    return this.a.length;
  }
  push(p: number, v: number): void {
    const a = this.a;
    a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j][0] <= a[i][0]) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Plan a road from `from` to `to` over the terrain: a list of tiles, each next to the one before. Edges that already exist are cheap, new edges cost more,
 * and a slope (one level of difference) costs a little extra. Edges that cannot be built (water, buildings, steep ground, bad crossings) are never used.
 * Returns null if there is no way within the search limit.
 */
export function planRoad(map: GameMap, from: Tile, to: Tile): Tile[] | null {
  if (!map.inBounds(from.x, from.y) || !map.inBounds(to.x, to.y)) return null;
  const x0 = Math.max(0, Math.min(from.x, to.x) - MARGIN);
  const x1 = Math.min(map.size - 1, Math.max(from.x, to.x) + MARGIN);
  const y0 = Math.max(0, Math.min(from.y, to.y) - MARGIN);
  const y1 = Math.min(map.size - 1, Math.max(from.y, to.y) + MARGIN);
  const start = map.idx(from.x, from.y);
  const goal = map.idx(to.x, to.y);
  const g = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const heap = new Heap();
  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);
  heap.push(h(from.x, from.y), start);
  let nodes = 0;
  while (heap.size && nodes++ < MAX_NODES) {
    const [, cur] = heap.pop();
    if (cur === goal) {
      const path: Tile[] = [];
      for (let i: number | undefined = cur; i !== undefined; i = prev.get(i)) path.push({ x: i % map.size, y: Math.floor(i / map.size) });
      return path.reverse();
    }
    const cx = cur % map.size;
    const cy = Math.floor(cur / map.size);
    const base = g.get(cur)!;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      if (!canConnect(map, cx, cy, d, true)) continue;
      const ni = map.idx(nx, ny);
      const exists = (map.road.get(cur) & CONN(d)) !== 0;
      const slope = map.levelAt(cx, cy) !== map.levelAt(nx, ny) ? 2 : 0;
      const cost = base + (exists ? 1 : 4) + slope;
      if (cost < (g.get(ni) ?? Infinity)) {
        g.set(ni, cost);
        prev.set(ni, cur);
        heap.push(cost + h(nx, ny), ni);
      }
    }
  }
  return null;
}
