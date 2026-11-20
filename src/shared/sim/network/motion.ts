import { CONN, OUT, opposite8 } from '../../world/directions';
import { FARE, fareMulOf } from './fares';
import { DECEL_TILES, Route, Stop, Vehicle, dirBetween, nearestDiff, todOf } from './types';
import type { Transit } from './transit';

/** 走行中の車両の1tickの動き(道路・鉄道・航空)と、到着・降車・位置の計算 */
export class Motion {
  constructor(private readonly t: Transit) {}

  stepAir(v: Vehicle, route: Route, tick: number): boolean {
    const f = v.flight;
    if (!f) {
      v.state = 'load';
      return true;
    }
    f.done += v.speed;
    if (f.done >= f.dist) {
      const dest = this.t.stops.get(route.orders[v.order].stopId);
      v.path = Uint32Array.of(dest ? dest.idx : v.path[0]);
      v.flight = null;
      this.arrive(v, route, tick);
    }
    return true;
  }

  stepRoad(v: Vehicle, route: Route, tick: number): boolean {
    const m = this.t.map;
    const s = m.size;
    v.t += v.speed;
    while (v.t >= 1 && v.pi < v.path.length - 1) {
      const cur0 = v.path[v.pi];
      const nxt0 = v.path[v.pi + 1];
      const d0 = dirBetween(cur0, nxt0, s);
      const nk = nxt0 * 4 + d0;
      const owner = this.t.lane.get(nk);
      if (owner !== undefined && owner !== v.id && v.stuck < 300) {
        // 前の車が同じ車線にいる: 追い越さず待つ(渋滞)
        v.t = Math.min(v.t, 0.999);
        v.stuck++;
        return true;
      }
      v.t -= 1;
      if (this.t.lane.get(cur0 * 4 + v.dir) === v.id) this.t.lane.delete(cur0 * 4 + v.dir);
      v.pi++;
      if (this.t.onTile) this.t.onTile(v, route, v.path[v.pi]);
      v.dir = d0;
      v.stuck = 0;
      this.t.lane.set(nk, v.id);
      const cur = v.path[v.pi];
      if (m.road.get(cur) === 0) {
        v.cap = 0; // 道路が撤去された: 車両を削除
        return false;
      }
      if (v.pi < v.path.length - 1) {
        const nxt = v.path[v.pi + 1];
        const d = dirBetween(cur, nxt, s);
        if (d < 0 || !(m.road.get(cur) & OUT(d)) || !(m.road.get(nxt) & CONN((d + 2) & 3)) || this.t.dispatch.takeReplan(v, route)) {
          v.path = Uint32Array.of(cur);
          v.pi = 0;
          v.t = 0;
          this.t.dispatch.depart(v, route, tick, false);
          return true;
        }
        if (v.pi + 1 > v.resTo && !this.t.signalsSys.extendReservation(v)) {
          v.t = 0; // 次の閉塞が空くまで、この位置で待つ
          break;
        }
      }
    }
    if (v.pi >= v.path.length - 1) {
      v.t = 0;
      this.arrive(v, route, tick);
    }
    return true;
  }

  /**
   * 鉄道の加減速: 発車直後は低速から徐々に上がり(約 ACCEL_TICKS)、停車駅の手前 DECEL_TILES タイルから減速する。
   * 経路の末尾(駅)の手前では最低 25% の速度まで落とす。
   */
  railSpeedFactor(v: Vehicle): number {
    const sf = Math.min(1, (v.sf ?? 0.3) + 0.03);
    v.sf = sf;
    const remain = v.path.length - 1 - v.pi - v.t;
    const dec = remain >= DECEL_TILES ? 1 : 0.25 + 0.75 * Math.max(0, remain / DECEL_TILES);
    return Math.max(0.2, Math.min(sf, dec));
  }

  stepRail(v: Vehicle, route: Route, tick: number): boolean {
    const m = this.t.map;
    const s = m.size;
    // 斜めの区間は距離が √2 倍なので、タイル間の進捗を距離で割る
    if (v.pi < v.path.length - 1 && v.pi + 1 > v.resTo && !this.t.signalsSys.extendReservation(v)) {
      v.t = 0;
      v.stuck++; // 赤信号で停止中
      return true;
    }
    const hop = v.pi < v.path.length - 1 && dirBetween(v.path[v.pi], v.path[v.pi + 1], s) >= 4 ? Math.SQRT2 : 1;
    v.t += (v.speed * this.railSpeedFactor(v)) / hop;
    while (v.t >= 1 && v.pi < v.path.length - 1) {
      v.t -= 1;
      v.pi++;
      const cur = v.path[v.pi];
      if (this.t.onTile) this.t.onTile(v, route, cur);
      if (m.rail.get(cur) === 0) {
        v.cap = 0; // 線路が撤去された: 編成を撤去
        return false;
      }
      v.trail.unshift(cur);
      while (v.trail.length > v.len) {
        const r = v.trail.pop()!;
        if (this.t.reserved.get(r) === v.id) this.t.reserved.delete(r);
      }
      if (v.pi < v.path.length - 1) {
        const nxt = v.path[v.pi + 1];
        const d = dirBetween(cur, nxt, s);
        if (d < 0 || !(m.rail.get(cur) & CONN(d)) || !(m.rail.get(nxt) & CONN(opposite8(d))) || this.t.dispatch.takeReplan(v, route)) {
          // 前方の線路が壊れた/通る線路が変更された: 予約を解放して再探索
          for (let i = v.pi + 1; i < v.path.length; i++) if (this.t.reserved.get(v.path[i]) === v.id && !v.trail.includes(v.path[i])) this.t.reserved.delete(v.path[i]);
          v.path = Uint32Array.of(cur);
          v.pi = 0;
          v.t = 0;
          this.t.dispatch.depart(v, route, tick, false);
          return true;
        }
      }
    }
    if (v.pi >= v.path.length - 1) {
      v.t = 0;
      this.arrive(v, route, tick);
    }
    return true;
  }

  /** 到着: 目的地の乗客は降車(輸送実績)、他路線へ乗り換える乗客は停留所に降ろす */
  alight(v: Vehicle, stop: Stop, route: Route, tick: number): void {
    // 乗っていた全員の、前の停留所からここまでの距離運賃
    const prev = v.lastStop !== undefined ? this.t.stops.get(v.lastStop) : undefined;
    if (prev && v.load > 0) this.t.onFare?.(v.mode, v.load * FARE[v.mode].perTile * fareMulOf(route) * (Math.abs(prev.x - stop.x) + Math.abs(prev.y - stop.y)), v.routeId);
    const tbl = this.t.router.table(stop.id, this.t.version);
    for (const [d, n] of v.cargo) {
      if (d === stop.id) {
        this.t.delivered += n;
        stop.traffic = (stop.traffic ?? 0) + n;
        this.t.onVisit?.(stop, n, tick);
        route.carried = (route.carried ?? 0) + n;
        this.t.flow.credit(stop, n);
        v.cargo.delete(d);
        v.load -= n;
      } else if (tbl.next.get(d) !== route.id) {
        v.cargo.delete(d);
        v.load -= n;
        if (tbl.next.has(d)) {
          this.t.flow.addWaiting(stop, d, n);
          this.t.transfers += n;
          stop.traffic = (stop.traffic ?? 0) + n;
        }
      }
    }
  }

  arrive(v: Vehicle, route: Route, tick: number): void {
    v.stuck = 0;
    const order = route.orders[v.order];
    const stop = this.t.stops.get(order.stopId);
    // 区間の実測(条件ジャンプなしで次の停車駅に着いたときだけ)
    if (v.from !== undefined && v.departedAt !== undefined && v.from < route.orders.length && this.t.realAfter(route, v.from) === v.order) {
      const leg = tick - v.departedAt;
      const arr = (route.legMeasured ??= []);
      arr[v.from] = arr[v.from] === undefined ? leg : arr[v.from] * 0.7 + leg * 0.3;
    }
    v.from = undefined;
    v.state = 'load';
    v.arrived = tick;
    if (stop) {
      this.alight(v, stop, route, tick);
      v.lastStop = stop.id;
    } else {
      v.cargo.clear();
      v.load = 0;
    }
    let until = tick + order.dwell;
    if (order.kind === 'timed') {
      // 周期 P の時刻表: 発車予定は departTod + k*P のうち、到着時刻に最も近いもの
      const P = route.period;
      const diff = nearestDiff(order.departTod + v.offset, todOf(tick), P);
      const late = Math.max(0, tick + order.dwell - (tick + diff));
      route.late = route.late * 0.8 + late * 0.2;
      until = Math.max(until, tick + diff);
    }
    v.until = until;
  }

  /** 道路車両の描画位置(タイル座標)と進行方向 */
  position(v: Vehicle): { x: number; y: number; dx: number; dy: number } {
    const s = this.t.map.size;
    const i = v.path[Math.min(v.pi, v.path.length - 1)];
    const x0 = i % s;
    const y0 = Math.floor(i / s);
    if (v.state !== 'move' || v.pi >= v.path.length - 1) {
      const prev = v.pi > 0 ? v.path[v.pi - 1] : i;
      const dx = Math.sign(x0 - (prev % s));
      const dy = Math.sign(y0 - Math.floor(prev / s));
      return { x: x0, y: y0, dx: dx || (dy ? 0 : 1), dy };
    }
    const n = v.path[v.pi + 1];
    const dx = (n % s) - x0;
    const dy = Math.floor(n / s) - y0;
    return { x: x0 + dx * v.t, y: y0 + dy * v.t, dx, dy };
  }

  /** 鉄道: 頭→尾の折れ線(タイル座標)。移動中は先頭に前方の補間点を含む */
  trainPoints(v: Vehicle): [number, number][] {
    const s = this.t.map.size;
    const pts: [number, number][] = [];
    if (v.state === 'move' && v.pi < v.path.length - 1 && v.trail.length) {
      const h = v.trail[0];
      const n = v.path[v.pi + 1];
      const hx = h % s;
      const hy = Math.floor(h / s);
      pts.push([hx + ((n % s) - hx) * v.t, hy + (Math.floor(n / s) - hy) * v.t]);
    }
    for (const t of v.trail) pts.push([t % s, Math.floor(t / s)]);
    return pts;
  }

  /** 航空機の位置(タイル座標、中心補正済み)・高度(0..1)・向き */
  planePos(v: Vehicle): { x: number; y: number; alt: number; dx: number; dy: number } {
    const f = v.flight;
    if (!f) {
      const s = this.t.map.size;
      const i = v.path[0];
      return { x: (i % s) + 0.5, y: Math.floor(i / s) + 0.5, alt: 0, dx: v.hx, dy: v.hy };
    }
    const k = f.done / f.dist;
    const alt = Math.max(0, Math.min(1, f.done / 12, (f.dist - f.done) / 12));
    return { x: f.x0 + (f.x1 - f.x0) * k, y: f.y0 + (f.y1 - f.y0) * k, alt, dx: v.hx, dy: v.hy };
  }
}
