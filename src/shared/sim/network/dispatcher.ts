import { REVERSE_MIN_TILES, REVERSE_RATIO, Route, Stop, Vehicle } from './types';
import type { Transit } from './transit';

/** 車両の出発: 次の停留所までの経路を決めて走り出す(バス・鉄道・航空) */
export class Dispatcher {
  constructor(private readonly t: Transit) {}

  /** 次のオーダーへ向けて出発(経路がなければ noroute) */
  depart(v: Vehicle, route: Route, tick: number, advance: boolean): void {
    this.departInner(v, route, tick, advance, route.orders.length);
  }

  departInner(v: Vehicle, route: Route, tick: number, advance: boolean, n: number): void {
    if (advance) {
      v.from = v.order;
      v.departedAt = tick;
    }
    let next = advance ? (v.order + 1) % n : v.order;
    // 条件付きオーダー: 出発時に条件を満たしたら、指定のオーダーへ進む
    if (advance) {
      const c = route.orders[v.order]?.cond;
      if (c && c.to >= 0 && c.to < n && c.to !== v.order && this.t.flow.condHolds(v, route, c, tick)) next = c.to;
    }
    // 鉄道: 途中の経由点は停まらず通過する目印。経由点のタイルを順に通る経路にする
    const vias: number[] = [];
    for (let g = 0; g < n; g++) {
      const w = this.t.stops.get(route.orders[next].stopId);
      if (!w || !this.t.isWay(route, next)) break;
      if (v.mode === 'rail') vias.push(w.idx); // 鉄道は通過する駅・経由点のタイルを順に通る(道路・航空の通過は飛ばすだけ)
      next = (next + 1) % n;
    }
    const dest = this.t.stops.get(route.orders[next].stopId);
    if (!dest || this.t.isWay(route, next)) return;
    v.order = next;
    if (v.mode === 'air') this.departAir(v, dest, route, tick);
    else if (v.mode === 'rail') this.departRail(v, dest, route, tick, vias);
    else this.departRoad(v, dest, route, tick);
  }

  departRoad(v: Vehicle, dest: Stop, route: Route, tick: number): void {
    const from = v.path[Math.min(v.pi, v.path.length - 1)];
    const path = this.t.planner.route(from, dest.idx, false);
    if (!path) return this.blocked(v, tick, 30);
    v.path = path;
    v.pi = 0;
    v.t = 0;
    v.stuck = 0;
    v.state = 'move';
    if (path.length === 1) this.t.motion.arrive(v, route, tick);
  }

  departRail(v: Vehicle, dest: Stop, route: Route, tick: number, vias: number[] = []): void {
    const build = (): number[][] => {
      let c = this.t.planner.railCandidates(v, vias, dest);
      if (!c.length && vias.length) c = this.t.planner.railCandidates(v, [], dest); // 経由できなければ直行
      return c;
    };
    let cands = build();
    if (v.trail.length > 1) {
      // 進行方向が逆: 編成を折り返す(尾が頭になる)。前進する経路がない場合に加え、前進が大回り(ループ線など)で
      // 折り返したほうがずっと近いときも、停車駅で折り返す(運転士が反対の先頭へ移る)
      const fwd = cands.length ? cands[0].length : Infinity;
      if (fwd > REVERSE_MIN_TILES) {
        v.trail.reverse();
        const rev = build();
        if (rev.length && rev[0].length * REVERSE_RATIO < fwd) cands = rev;
        else v.trail.reverse();
      }
    }
    if (!cands.length) return this.blocked(v, tick, 30);
    // 前方の閉塞を予約する(信号がなければ経路全体。他の編成と衝突・正面衝突しない)。番線は空いている候補を順に試す
    for (const c of cands) {
      v.path = Uint32Array.from(c);
      v.resTo = 0;
      if (!this.t.signalsSys.extendReservation(v)) continue;
      v.pi = 0;
      v.t = 0;
      v.stuck = 0;
      v.sf = 0.3; // 発車は低速から加速
      v.state = 'move';
      if (v.path.length === 1) this.t.motion.arrive(v, route, tick);
      return;
    }
    v.path = Uint32Array.of(v.trail[0]);
    this.blocked(v, tick, 10);
  }

  departAir(v: Vehicle, dest: Stop, route: Route, tick: number): void {
    const s = this.t.map.size;
    const from = v.path[0];
    const x0 = (from % s) + 0.5;
    const y0 = (Math.floor(from / s)) + 0.5;
    const x1 = dest.x + 0.5;
    const y1 = dest.y + 0.5;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (dist < 1) return this.t.motion.arrive(v, route, tick);
    v.flight = { x0, y0, x1, y1, dist, done: 0 };
    v.hx = (x1 - x0) / dist;
    v.hy = (y1 - y0) / dist;
    v.state = 'move';
  }

  blocked(v: Vehicle, tick: number, wait: number): void {
    v.state = 'noroute';
    v.retryAt = tick + wait;
    v.stuck += wait;
  }

  /** @returns 車両が生存していれば true */
  /**
   * 通る線路が変更されたので、いまのタイルから目的地までの経路を探し直すか。印を消して true を返す。
   * 目的地の手前に経由点がある区間は、経由点を保つため探し直さない(次の出発で反映)。
   */
  takeReplan(v: Vehicle, route: Route): boolean {
    if (!v.replan) return false;
    v.replan = false;
    const n = route.orders.length;
    if (this.t.isWay(route, (v.order - 1 + n) % n)) return false;
    return true;
  }
}
