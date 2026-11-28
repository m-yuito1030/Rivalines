import { CONN, OUT, opposite8 } from '../../world/directions';
import { findPath } from './pathfinding';
import { NET_LOG_MAX, PATH_MARGIN, PathEntry, Stop, Vehicle, dirBetween } from './types';
import type { Transit } from './transit';

/** Path search, caching, and network-change notification (only paths touching the changed area are searched again) */
export class PathPlanner {
  constructor(private readonly t: Transit) {}

  /** Report individual changed tiles (after track, road, or signal edits). A running train that crosses such a tile searches its path again when it enters the next tile */
  touchNetworkTiles(tiles: [number, number][]): void {
    if (!tiles.length) return;
    const rects = tiles.length > 1500 ? [this.boundsOf(tiles)] : tiles.map(([x, y]) => ({ x0: x, y0: y, x1: x, y1: y }));
    this.applyChange(rects);
  }

  boundsOf(tiles: [number, number][]) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of tiles) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  }

  /** Record a change (generation and history) and mark running trains that cross it to "search the path again" */
  applyChange(rects: { x0: number; y0: number; x1: number; y1: number }[]): void {
    this.t.netGen++;
    for (const r of rects) this.t.netLog.push({ gen: this.t.netGen, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
    if (this.t.netLog.length > NET_LOG_MAX) {
      const drop = Math.floor(NET_LOG_MAX / 2);
      this.t.netLogFloor = this.t.netLog[drop - 1].gen;
      this.t.netLog.splice(0, drop);
    }
    if (rects.some((r) => r.x0 < 0)) return; // a change to the whole network (area unknown) does not mark trains (only the cache)
    const s = this.t.map.size;
    const points = new Set<number>();
    const wide: typeof rects = [];
    for (const r of rects) {
      if (r.x0 === r.x1 && r.y0 === r.y1) points.add(r.y0 * s + r.x0);
      else wide.push(r);
    }
    for (const v of this.t.vehicles) {
      if (v.mode === 'air' || v.state !== 'move') continue;
      for (let i = v.pi; i < v.path.length; i++) {
        const idx = v.path[i];
        let hit = points.has(idx);
        if (!hit && wide.length) {
          const x = idx % s;
          const y = (idx - x) / s;
          hit = wide.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
        }
        if (hit) {
          v.replan = true;
          break;
        }
      }
    }
  }

  /**
   * Report that the network changed (call after building, demolishing, signals, or station edits). Pass the rectangles of the changed area
   * (if omitted, it is treated as affecting everything). So even a small change, like laying a shortcut or changing a signal, makes the relevant paths be searched again at their next departure.
   */
  touchNetwork(x0 = -1, y0 = -1, x1 = x0, y1 = y0): void {
    this.applyChange([{ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) }]);
  }

  /** Whether a change since this entry (generation ce.gen) touches the entry's search area */
  pathAffected(ce: PathEntry): boolean {
    if (ce.gen >= this.t.netGen) return false;
    if (ce.gen < this.t.netLogFloor) return true; // old history was discarded, so search again to be safe
    for (let i = this.t.netLog.length - 1; i >= 0; i--) {
      const c = this.t.netLog[i];
      if (c.gen <= ce.gen) break;
      if (c.x0 < 0) return true;
      if (c.x1 >= ce.bx0 - PATH_MARGIN && c.x0 <= ce.bx1 + PATH_MARGIN && c.y1 >= ce.by0 - PATH_MARGIN && c.y0 <= ce.by1 + PATH_MARGIN) return true;
    }
    return false;
  }

  /** Path search (the result is cached; on use, each edge is checked to still be passable, and the search is redone if not) */
  route(from: number, to: number, rail: boolean): Uint32Array | null {
    const m = this.t.map;
    const s = m.size;
    const key = `${from}:${to}`;
    const ce = this.t.pathCache.get(key);
    if (ce && !this.pathAffected(ce)) {
      if (ce.p === null) {
        ce.gen = this.t.netGen; // an unreachable result is reused too, unless a relevant change happened (the same search is not repeated)
        return null;
      }
      const c = ce.p;
      let ok = true;
      const layer = rail ? { get: (i: number) => m.railAt(i) } : m.road;
      for (let i = 0; i + 1 < c.length && ok; i++) {
        const d = dirBetween(c[i], c[i + 1], s);
        ok = d >= 0 && (layer.get(c[i]) & (rail ? CONN(d) : OUT(d))) !== 0 && (layer.get(c[i + 1]) & CONN(opposite8(d))) !== 0;
        if (ok && rail && this.t.signals.size && d < 8) {
          const mk = this.t.signalsSys.signalMask(c[i + 1]);
          if (mk && !(mk & (1 << d))) ok = false; // a path that runs the wrong way through a one-way signal is invalid
        }
      }
      if (ok) {
        ce.gen = this.t.netGen;
        this.t.pathCache.delete(key);
        this.t.pathCache.set(key, ce); // mark as recently used (LRU)
        return c;
      }
    }
    const p = findPath(m, from, to, rail, 300000, rail && this.t.signals.size ? (i) => this.t.signalsSys.signalMask(i) : undefined);
    const fx = from % s;
    const fy = Math.floor(from / s);
    const tx = to % s;
    const ty = Math.floor(to / s);
    let bx0 = Math.min(fx, tx);
    let by0 = Math.min(fy, ty);
    let bx1 = Math.max(fx, tx);
    let by1 = Math.max(fy, ty);
    if (p) {
      for (let i = 0; i < p.length; i++) {
        const x = p[i] % s;
        const y = Math.floor(p[i] / s);
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    } else {
      // An unreachable record is searched again when something changes around the start and end (the area the search spread over)
      bx0 -= 60;
      by0 -= 60;
      bx1 += 60;
      by1 += 60;
    }
    this.t.pathCache.delete(key);
    this.t.pathCache.set(key, { p, gen: this.t.netGen, bx0, by0, bx1, by1 });
    if (this.t.pathCache.size > this.t.pathCacheMax) {
      let n = Math.max(1, Math.floor(this.t.pathCacheMax / 10));
      for (const k of this.t.pathCache.keys()) {
        if (n-- <= 0) break;
        this.t.pathCache.delete(k);
      }
    }
    return p;
  }

  /**
   * Candidate departure paths for rail (shortest first). They pass through the waypoints in order and end at a platform track of the station (the far end in the direction of travel).
   * Paths that would reverse (go back along the track they came on) are excluded. Empty if none is found.
   */
  railCandidates(v: Vehicle, vias: number[], dest: Stop): number[][] {
    let cur = v.trail[0];
    let prev = v.trail.length > 1 ? v.trail[1] : -1;
    const base: number[] = [cur];
    for (const w of vias) {
      if (w === cur) continue;
      const seg = this.route(cur, w, true);
      if (!seg || (seg.length > 1 && seg[1] === prev)) return [];
      for (let i = 1; i < seg.length; i++) base.push(seg[i]);
      prev = base.length > 1 ? base[base.length - 2] : -1;
      cur = w;
    }
    const out: number[][] = [];
    for (const { a, b } of this.t.docks(dest, v.len)) {
      const toward = (to: number): Uint32Array | null => {
        const p = to === cur ? Uint32Array.of(cur) : this.route(cur, to, true);
        return p && !(p.length > 1 && p[1] === prev) ? p : null;
      };
      const pa = toward(a);
      const pb = a === b ? pa : toward(b);
      let pick: Uint32Array | null;
      if (pa && pb && a !== b) pick = pb.includes(a) ? pb : pa.includes(b) ? pa : pa.length <= pb.length ? pa : pb;
      else pick = pa ?? pb;
      if (pick) out.push([...base.slice(0, -1), ...pick]);
    }
    return out.sort((x, y) => x.length - y.length);
  }
}
