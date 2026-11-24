import { POP_PER_LEVEL, popMul } from '../../world/town';
import { FACILITY_SPECS, facilitiesNear, facilityAttract, hourFactor } from '../../world/facilities';
import { FARE, fareDemand, fareMulOf } from './fares';
import { facilityDayMul } from '../world/events';
import { DEV } from '../economy/development';
import { CATCH, DAY_TICKS, GEN_EVERY, OrderCond, PAX_RATE, Route, START_TOD, Stop, Vehicle, WAIT_CAP, todOf } from './types';
import type { Transit } from './transit';

/** 乗客の発生・待ち人数・積み降ろし・集客圏と施設の需要 */
export class PassengerFlow {
  constructor(private readonly t: Transit) {}

  /** 集客圏の人口と所属する街を数え直す */
  refreshCatchment(s: Stop): void {
    const m = this.t.map;
    const R = CATCH[s.kind];
    let pop = 0;
    let best = 0;
    let bestPop = 0;
    const byTown = new Map<number, number>();
    for (let y = s.y - R; y <= s.y + R; y++) {
      for (let x = s.x - R; x <= s.x + R; x++) {
        if (!m.inBounds(x, y)) continue;
        const i = m.idx(x, y);
        const b = m.building.get(i);
        if (!b || m.construction.get(i)) continue; // 工事中の建物は、まだ人が使わない
        const tid = m.owner.get(i);
        const p = POP_PER_LEVEL[b & 3] * popMul(m.towns[tid - 1]);
        pop += p;
        const sum = (byTown.get(tid) ?? 0) + p;
        byTown.set(tid, sum);
        if (sum > bestPop) {
          bestPop = sum;
          best = tid;
        }
      }
    }
    s.pop = pop;
    if (best) s.townId = best;
    // 大型施設(スタジアム・遊園地など)の需要
    const near = facilitiesNear(m, s.x, s.y, R);
    s.facs = near.map((f) => f.id);
    s.fpop = near.reduce((a, f) => a + facilityAttract(f), 0);
  }

  facilityDemand(s: Stop, tick: number): number {
    if (!s.facs || !s.facs.length) return 0;
    const hour = (todOf(tick) / DAY_TICKS) * 24;
    const day = Math.floor((tick + START_TOD) / DAY_TICKS);
    if (this.t.dayMulDay !== day) {
      this.t.dayMulDay = day;
      this.t.dayMul.clear();
    }
    let d = 0;
    for (const id of s.facs) {
      const f = this.t.map.facilities.find((x) => x.id === id);
      if (f) {
        let mul = this.t.dayMul.get(id);
        if (mul === undefined) this.t.dayMul.set(id, (mul = facilityDayMul(this.t.map.seed, f, day)));
        d += facilityAttract(f) * hourFactor(FACILITY_SPECS[f.type], hour) * mul;
      }
    }
    return d;
  }

  credit(stop: Stop, n: number): void {
    const t = this.t.map.towns[stop.townId - 1];
    if (t) t.pax += n;
  }

  /** 停留所に停まる路線の運賃から決まる需要の倍率(路線の平均。構造が変わったときだけ作り直す) */
  stopFareDemand(stopId: number): number {
    if (this.t.fareDemandVer !== this.t.version) {
      const sum = new Map<number, { s: number; n: number }>();
      for (const r of this.t.routes.values()) {
        const d = fareDemand(fareMulOf(r));
        for (const id of new Set(r.orders.map((o) => o.stopId))) {
          const e = sum.get(id) ?? { s: 0, n: 0 };
          e.s += d;
          e.n++;
          sum.set(id, e);
        }
      }
      this.t.fareDemandBy.clear();
      for (const [id, e] of sum) this.t.fareDemandBy.set(id, e.s / e.n);
      this.t.fareDemandVer = this.t.version;
    }
    return this.t.fareDemandBy.get(stopId) ?? 1;
  }

  generate(s: Stop, tick: number): void {
    const tbl = this.t.router.table(s.id, this.t.version);
    if (tbl.next.size === 0) return;
    const n =
      (s.pop + this.facilityDemand(s, tick)) * PAX_RATE * GEN_EVERY * this.stopFareDemand(s.id) * (this.t.serviceMul?.(s.owner) ?? 1) * (1 + DEV.demandUp * (s.dev ?? 0)) + s.frac;
    const whole = Math.floor(n);
    s.frac = n - whole;
    const room = WAIT_CAP[s.kind] - s.waiting;
    if (whole < 1 || room < 1) return;
    const total = Math.min(whole, Math.floor(room));
    const { dests, cum } = tbl;
    const sum = cum[cum.length - 1];
    const picks = Math.min(3, dests.length);
    for (let k = 0; k < picks; k++) {
      const r = this.t.rng() * sum;
      // 累積重みを二分探索
      let lo = 0;
      let hi = dests.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] > r) hi = mid;
        else lo = mid + 1;
      }
      const cnt = Math.floor(total / picks) + (k === 0 ? total % picks : 0);
      if (cnt > 0) this.addWaiting(s, dests[lo], cnt);
    }
  }

  addWaiting(s: Stop, dest: number, n: number): void {
    s.wait.set(dest, (s.wait.get(dest) ?? 0) + n);
    s.waiting += n;
  }

  /** 路線変更で行けなくなった目的地の乗客を取り除く */
  purgeUnreachable(s: Stop): void {
    const tbl = this.t.router.table(s.id, this.t.version);
    for (const [d, n] of s.wait) {
      if (!tbl.next.has(d)) {
        s.wait.delete(d);
        s.waiting -= n;
      }
    }
  }

  stepLoad(v: Vehicle, route: Route, tick: number): void {
    if (v.hold) return; // 分割で切り離された待機編成
    const order = route.orders[v.order];
    const stop = order && this.t.stops.get(order.stopId);
    if (!stop) return;
    // この路線に乗るべき乗客を乗せる
    if (v.load < v.cap && stop.waiting >= 1) {
      const tbl = this.t.router.table(stop.id, this.t.version);
      let boarded = 0;
      for (const [d, n] of stop.wait) {
        if (tbl.next.get(d) !== route.id) continue;
        const take = Math.min(n, v.cap - v.load - boarded);
        if (take <= 0) break;
        v.cargo.set(d, (v.cargo.get(d) ?? 0) + take);
        if (take === n) stop.wait.delete(d);
        else stop.wait.set(d, n - take);
        boarded += take;
      }
      if (boarded > 0) {
        this.t.onFare?.(v.mode, boarded * FARE[v.mode].base * fareMulOf(route), v.routeId, v.id); // 乗車時の基本運賃
        v.on = (v.on ?? 0) + boarded;
        stop.traffic = (stop.traffic ?? 0) + boarded;
        v.load += boarded;
        stop.waiting -= boarded;
        this.credit(stop, boarded);
      }
    }
    const minDone = tick >= v.arrived + order.dwell;
    let ready = tick >= v.until;
    if (order.kind === 'full') ready = minDone && (v.load >= v.cap || tick >= v.arrived + order.maxWait);
    if (ready) this.t.dispatch.depart(v, route, tick, true);
  }

  /** 条件付きオーダーの条件が成り立つか */
  condHolds(v: Vehicle, route: Route, c: OrderCond, tick: number): boolean {
    let x: number;
    if (c.kind === 'load') x = v.cap > 0 ? (v.load / v.cap) * 100 : 0;
    else if (c.kind === 'wait') x = this.t.stops.get(route.orders[v.order].stopId)?.waiting ?? 0;
    else x = (todOf(tick) / DAY_TICKS) * 1440;
    return c.op === 'ge' ? x >= c.value : x < c.value;
  }
}
