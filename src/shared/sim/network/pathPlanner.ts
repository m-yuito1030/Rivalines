import { CONN, OUT, opposite8 } from '../../world/directions';
import { findPath } from './pathfinding';
import { NET_LOG_MAX, PATH_MARGIN, PathEntry, Stop, Vehicle, dirBetween } from './types';
import type { Transit } from './transit';

/** 経路の探索とキャッシュ・ネットワーク変更の通知(変更範囲にかかる経路だけ探し直す) */
export class PathPlanner {
  constructor(private readonly t: Transit) {}

  /** 変更した個々のタイルを知らせる(線路・道路・信号の操作のあと)。そのタイルを通る走行中の編成は、次のタイルに入ったところで経路を探し直す */
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

  /** 変更の記録(世代・履歴)と、その変更を通る走行中の編成への「経路の探し直し」の印 */
  applyChange(rects: { x0: number; y0: number; x1: number; y1: number }[]): void {
    this.t.netGen++;
    for (const r of rects) this.t.netLog.push({ gen: this.t.netGen, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
    if (this.t.netLog.length > NET_LOG_MAX) {
      const drop = Math.floor(NET_LOG_MAX / 2);
      this.t.netLogFloor = this.t.netLog[drop - 1].gen;
      this.t.netLog.splice(0, drop);
    }
    if (rects.some((r) => r.x0 < 0)) return; // 全体(範囲不明)は編成には印を付けない(キャッシュだけ)
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
   * ネットワークが変わったことを知らせる(建設・撤去・信号・駅の操作のあとに呼ぶ)。変更した範囲の矩形を渡す
   * (省略すると全体に影響する扱い)。これで、近道を敷く・信号を変えるといった小さな変更でも、関係する経路は次の出発時に探し直される。
   */
  touchNetwork(x0 = -1, y0 = -1, x1 = x0, y1 = y0): void {
    this.applyChange([{ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) }]);
  }

  /** この記録(世代 ce.gen)以降の変更が、記録の探索範囲にかかっているか */
  pathAffected(ce: PathEntry): boolean {
    if (ce.gen >= this.t.netGen) return false;
    if (ce.gen < this.t.netLogFloor) return true; // 古い履歴は捨てたので、念のため探し直す
    for (let i = this.t.netLog.length - 1; i >= 0; i--) {
      const c = this.t.netLog[i];
      if (c.gen <= ce.gen) break;
      if (c.x0 < 0) return true;
      if (c.x1 >= ce.bx0 - PATH_MARGIN && c.x0 <= ce.bx1 + PATH_MARGIN && c.y1 >= ce.by0 - PATH_MARGIN && c.y0 <= ce.by1 + PATH_MARGIN) return true;
    }
    return false;
  }

  /** 経路探索(結果をキャッシュ。使用時は各辺がまだ通れるか検査し、駄目なら探索し直す) */
  route(from: number, to: number, rail: boolean): Uint32Array | null {
    const m = this.t.map;
    const s = m.size;
    const key = `${from}:${to}`;
    const ce = this.t.pathCache.get(key);
    if (ce && !this.pathAffected(ce)) {
      if (ce.p === null) {
        ce.gen = this.t.netGen; // 到達できない結果も、関係する変更がなければ使い回す(同じ探索を繰り返さない)
        return null;
      }
      const c = ce.p;
      let ok = true;
      const layer = rail ? m.rail : m.road;
      for (let i = 0; i + 1 < c.length && ok; i++) {
        const d = dirBetween(c[i], c[i + 1], s);
        ok = d >= 0 && (layer.get(c[i]) & (rail ? CONN(d) : OUT(d))) !== 0 && (layer.get(c[i + 1]) & CONN(opposite8(d))) !== 0;
        if (ok && rail && this.t.signals.size && d < 8) {
          const mk = this.t.signalsSys.signalMask(c[i + 1]);
          if (mk && !(mk & (1 << d))) ok = false; // 一方向の信号を逆走する経路は不可
        }
      }
      if (ok) {
        ce.gen = this.t.netGen;
        this.t.pathCache.delete(key);
        this.t.pathCache.set(key, ce); // 最近使った印(LRU)
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
      // 到達できなかった記録は、始点・終点の周囲(探索が広がった範囲)の変更で探し直す
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
   * 鉄道の出発経路の候補(短い順)。経由点を順に通り、最後は駅の番線(両端のうち進行方向の奥側)まで。
   * 折り返し(来た線路へ戻る)になる経路は除く。見つからなければ空。
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
