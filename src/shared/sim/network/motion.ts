import { CONN, OUT, opposite8 } from '../../world/directions';
import { FARE, fareMulOf } from './fares';
import { DECEL_TILES, Route, Stop, Vehicle, dirBetween, nearestDiff, todOf } from './types';
import { flightAt, speedAt } from './flightPath';
import type { Transit } from './transit';

/** One tick of movement for running vehicles (road, rail, air), plus arrival, alighting, and position computation */
export class Motion {
  constructor(private readonly t: Transit) {}

  private staffMul(route: Route): number {
    return this.t.speedMul?.(route.owner) ?? 1;
  }

  stepAir(v: Vehicle, route: Route, tick: number): boolean {
    const f = v.flight;
    if (!f) {
      v.state = 'load';
      return true;
    }
    f.done += v.speed * this.staffMul(route) * speedAt(f, f.done);
    if (f.done >= f.dist) {
      f.done = f.dist;
      this.t.air.onFlightEnd(v, route, tick);
    }
    return true;
  }

  stepRoad(v: Vehicle, route: Route, tick: number): boolean {
    const m = this.t.map;
    const s = m.size;
    v.t += v.speed * this.staffMul(route);
    while (v.t >= 1 && v.pi < v.path.length - 1) {
      const cur0 = v.path[v.pi];
      const nxt0 = v.path[v.pi + 1];
      const d0 = dirBetween(cur0, nxt0, s);
      const nk = nxt0 * 4 + d0;
      const owner = this.t.lane.get(nk);
      if (owner !== undefined && owner !== v.id && v.stuck < 300) {
        // The vehicle ahead is in the same lane: wait instead of overtaking (congestion)
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
        v.cap = 0; // the road was removed: delete the vehicle
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
          v.t = 0; // wait here until the next block is free
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
   * Rail acceleration/deceleration: after departure it speeds up gradually from a low speed (about ACCEL_TICKS), and brakes from DECEL_TILES tiles before a stop.
   * Before the end of the path (a station) it slows to at least 25% of full speed.
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
    // A diagonal leg is √2 times longer, so divide the per-tile progress by the distance
    if (v.pi < v.path.length - 1 && v.pi + 1 > v.resTo && !this.t.signalsSys.extendReservation(v)) {
      v.t = 0;
      v.stuck++; // stopped at a red signal
      return true;
    }
    const hop = v.pi < v.path.length - 1 && dirBetween(v.path[v.pi], v.path[v.pi + 1], s) >= 4 ? Math.SQRT2 : 1;
    v.t += (v.speed * this.staffMul(route) * this.railSpeedFactor(v)) / hop;
    while (v.t >= 1 && v.pi < v.path.length - 1) {
      v.t -= 1;
      v.pi++;
      const cur = v.path[v.pi];
      if (this.t.onTile) this.t.onTile(v, route, cur);
      if (m.railAt(cur) === 0) {
        v.cap = 0; // the track was removed: remove the train
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
        if (d < 0 || !(m.railAt(cur) & CONN(d)) || !(m.railAt(nxt) & CONN(opposite8(d))) || this.t.dispatch.takeReplan(v, route)) {
          // The track ahead broke / a track on the path changed: release reservations and search again
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

  /** Arrival: passengers at their destination get off (counted as carried), and those transferring to another route are dropped at the stop */
  alight(v: Vehicle, stop: Stop, route: Route, tick: number): void {
    // The distance fare from the previous stop to here, for everyone aboard
    const prev = v.lastStop !== undefined ? this.t.stops.get(v.lastStop) : undefined;
    if (prev && v.load > 0) this.t.onFare?.(v.mode, v.load * FARE[v.mode].perTile * fareMulOf(route) * (Math.abs(prev.x - stop.x) + Math.abs(prev.y - stop.y)), v.routeId, v.id);
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
        v.off = (v.off ?? 0) + n;
      } else if (tbl.next.get(d) !== route.id) {
        v.cargo.delete(d);
        v.load -= n;
        v.off = (v.off ?? 0) + n;
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
    // Measure the leg (only when arriving at the next stopping stop without a conditional jump)
    if (v.from !== undefined && v.departedAt !== undefined && v.from < route.orders.length && this.t.realAfter(route, v.from) === v.order) {
      const leg = tick - v.departedAt;
      const arr = (route.legMeasured ??= []);
      arr[v.from] = arr[v.from] === undefined ? leg : arr[v.from] * 0.7 + leg * 0.3;
    }
    v.from = undefined;
    v.state = 'load';
    v.arrived = tick;
    v.on = 0;
    v.off = 0;
    if (stop) {
      this.alight(v, stop, route, tick);
      v.lastStop = stop.id;
    } else {
      v.cargo.clear();
      v.load = 0;
    }
    let until = tick + order.dwell;
    if (order.kind === 'timed') {
      // Timetable with period P: the scheduled departures are departTod + k*P; take the one closest to the arrival time
      const P = route.period;
      const diff = nearestDiff(order.departTod + v.offset, todOf(tick), P);
      const late = Math.max(0, tick + order.dwell - (tick + diff));
      route.late = route.late * 0.8 + late * 0.2;
      until = Math.max(until, tick + diff);
    }
    v.until = until;
  }

  /** Draw position (tile coordinates) and heading of a road vehicle */
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

  /** Rail: the polyline from head to tail (tile coordinates). While moving it includes an interpolated point ahead of the head */
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

  /** Aircraft position (tile coordinates, centre-corrected), altitude (0..1), and heading */
  planePos(v: Vehicle): { x: number; y: number; alt: number; dx: number; dy: number } {
    const f = v.flight;
    if (!f) {
      const s = this.t.map.size;
      const i = v.path[0];
      return { x: (i % s) + 0.5, y: Math.floor(i / s) + 0.5, alt: 0, dx: v.hx, dy: v.hy };
    }
    const p = flightAt(f, f.done);
    return { x: p.x, y: p.y, alt: p.z, dx: p.dx, dy: p.dy };
  }
}
