import { modelOf } from '../../data/models';
import { DAY_TICKS, Departure, PERIOD_OPTIONS, RANKS, ROUTE_COLORS, Route, dirBetween, todOf } from './types';
import type { Transit } from './transit';

/** Timetable, departure boards, auto-building timetables, service classes, and route duplication */
export class Schedule {
  constructor(private readonly t: Transit) {}

  /** Expected travel time (ticks) from stop i to the next stop. null if there is no path */
  legTicks(route: Route, i: number): number | null {
    const a = this.t.stops.get(route.orders[i].stopId);
    const j = this.t.realAfter(route, i);
    const b = this.t.stops.get(route.orders[j].stopId);
    if (!a || !b) return null;
    const speed = modelOf(route.modelId).speed;
    if (route.mode === 'air') return Math.hypot(a.x - b.x, a.y - b.y) / speed + 40; // plus takeoff and landing
    // A path through waypoints: a -> waypoints... -> b
    const tiles = [a.idx];
    for (let k = (i + 1) % route.orders.length; k !== j; k = (k + 1) % route.orders.length) tiles.push(this.t.stops.get(route.orders[k].stopId)!.idx);
    tiles.push(b.idx);
    let len = 0;
    for (let q = 0; q + 1 < tiles.length; q++) {
      const p = this.t.route(tiles[q], tiles[q + 1], route.mode === 'rail');
      if (!p) return null;
      len += p.length - 1;
      if (route.mode === 'rail') for (let k = 0; k + 1 < p.length; k++) if (dirBetween(p[k], p[k + 1], this.t.map.size) >= 4) len += Math.SQRT2 - 1;
    }
    return len / speed;
  }

  /**
   * Departure board for a stop: for each route that stops here, the ticks until arrival/departure of each upcoming (stopped) vehicle.
   * The estimate adds up travel times (legTicks) and stop times; it does not account for congestion and the like.
   */
  departures(stopId: number, tick: number): Departure[] {
    const out: Departure[] = [];
    for (const route of this.t.routes.values()) {
      const n = route.orders.length;
      if (!route.orders.some((o, i) => o.stopId === stopId && !this.t.isWay(route, i)) || this.t.stops.get(stopId)?.waypoint) continue;
      for (const v of this.t.vehicles) {
        if (v.routeId !== route.id || v.hold) continue;
        const cur = v.order;
        const target = route.orders[cur];
        if (!target) continue;
        const nextName = (i: number) => this.t.stops.get(route.orders[this.t.realAfter(route, i)].stopId)?.name ?? '?';
        if (v.state === 'load' && target.stopId === stopId) {
          out.push({ routeId: route.id, vehicleId: v.id, eta: 0, stopped: true, leaveIn: Math.max(0, v.until - tick), toward: nextName(cur) });
          continue;
        }
        // Remaining time from the current position to arriving at the next order
        let acc: number;
        let idx: number; // the order it will arrive at next
        if (v.state === 'load') {
          acc = Math.max(0, v.until - tick);
          const leg = this.legTicks(route, cur);
          if (leg === null) continue;
          acc += leg;
          idx = this.t.realAfter(route, cur);
        } else if (v.state === 'move') {
          if (v.mode === 'air' && v.flight) acc = Math.max(0, (v.flight.dist - v.flight.done) / v.speed);
          else acc = Math.max(0, v.path.length - 1 - v.pi - v.t) / v.speed;
          idx = cur;
        } else continue;
        for (let k = 0; k < n; k++) {
          if (route.orders[idx].stopId === stopId) {
            out.push({ routeId: route.id, vehicleId: v.id, eta: acc, stopped: false, leaveIn: 0, toward: nextName(idx) });
            break;
          }
          const leg = this.legTicks(route, idx);
          if (leg === null) break;
          acc += route.orders[idx].dwell + leg;
          idx = this.t.realAfter(route, idx);
        }
      }
    }
    return out.sort((a, b) => a.eta - b.eta);
  }

  /** Next departures of a timetable (timed orders): up to `count` per route, as ticks from now */
  timetable(stopId: number, tick: number, count = 3): { routeId: number; etas: number[] }[] {
    const res: { routeId: number; etas: number[] }[] = [];
    for (const route of this.t.routes.values()) {
      const o = route.orders.find((x) => x.stopId === stopId && x.kind === 'timed' && !x.pass);
      if (!o) continue;
      const P = route.period;
      const first = (((o.departTod - todOf(tick)) % P) + P) % P;
      res.push({ routeId: route.id, etas: Array.from({ length: count }, (_, i) => first + i * P) });
    }
    return res;
  }

  /** Auto-build a timetable from travel times (makes every order timed and decides the period). Returns false on failure */
  autoTimetable(routeId: number, startTod: number): boolean {
    const route = this.t.routes.get(routeId);
    if (!route) return false;
    const n = route.orders.length;
    const legs: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.t.isWay(route, i)) {
        legs.push(0);
        continue;
      }
      const l = route.legMeasured?.[i] ?? this.legTicks(route, i); // use the measured time if there is one
      if (l === null || l === undefined) return false;
      legs.push(l);
    }
    const unit = DAY_TICKS / 1440; // one minute
    let t = startTod;
    let cycle = 0;
    for (let i = 0; i < n; i++) {
      if (this.t.isWay(route, i)) continue;
      const o = route.orders[i];
      o.kind = 'timed';
      o.departTod = Math.round((t % DAY_TICKS) / unit) * unit;
      const leg = legs[i] * 1.15 + unit; // 15% margin + 1 minute
      const step = leg + o.dwell;
      t += step;
      cycle += step;
    }
    const fit = PERIOD_OPTIONS.filter(([, v]) => v >= cycle * 1.05).map(([, v]) => v);
    route.period = fit.length ? Math.min(...fit) : DAY_TICKS;
    this.t.version++;
    return true;
  }

  /**
   * Set the service class and pick stops automatically: the terminus and the turn-back stop (the farthest) always stop; of the intermediate stops, keep those with large population and more platforms, and make the rest pass.
   * If there is a timetable, rebuild it from travel times. Local (0) restores every stop.
   */
  applyRank(routeId: number, rank: number): boolean {
    const r = this.t.routes.get(routeId);
    if (!r || rank < 0 || rank >= RANKS.length) return false;
    // Consider every non-waypoint order, so stations already set to pass are candidates too
    const cand = r.orders.map((o, i) => (this.t.stops.get(o.stopId)?.waypoint ? -1 : i)).filter((i) => i >= 0);
    const ids = [...new Set(cand.map((i) => r.orders[i].stopId))];
    if (ids.length < 2) return false;
    const first = this.t.stops.get(r.orders[cand[0]].stopId)!;
    let far = ids[ids.length - 1];
    let fd = -1;
    for (const id of ids) {
      const s = this.t.stops.get(id)!;
      const d = Math.hypot(s.x - first.x, s.y - first.y);
      if (d > fd) {
        fd = d;
        far = id;
      }
    }
    const must = new Set([first.id, far]);
    const mid = ids.filter((id) => !must.has(id));
    const score = (id: number) => {
      const s = this.t.stops.get(id)!;
      return s.pop + (s.fpop ?? 0) + (s.station && s.station.tracks >= 2 ? 100000 : 0);
    };
    const keepN = rank === 0 ? mid.length : Math.ceil(mid.length * RANKS[rank].keep);
    const keep = new Set([...mid].sort((a, b) => score(b) - score(a)).slice(0, keepN));
    const firstTimed = r.orders.find((o, i) => o.kind === 'timed' && !this.t.isWay(r, i));
    for (const o of r.orders) {
      if (this.t.stops.get(o.stopId)?.waypoint) continue;
      o.pass = must.has(o.stopId) || keep.has(o.stopId) ? undefined : true;
    }
    r.rank = rank;
    r.legMeasured = undefined;
    if (firstTimed && r.orders.some((o) => o.kind === 'timed')) this.autoTimetable(r.id, firstTimed.departTod);
    this.t.orderEdit.syncOrders(r.id);
    this.t.version++;
    return true;
  }

  /**
   * The planned path the vehicle will follow (for display): from the stop it is heading to / stopped at, up to maxLegs legs to following stopping stops.
   * A train passes through intermediate waypoints and skipped stations in order. Each leg is a list of tile indexes. Empty for aircraft
   */
  planAhead(vehicleId: number, maxLegs = 3): { legs: number[][]; stops: number[] } | null {
    const v = this.t.vehicles.find((x) => x.id === vehicleId);
    const route = v && this.t.routes.get(v.routeId);
    if (!v || !route) return null;
    if (v.mode === 'air') return { legs: [], stops: [] };
    const n = route.orders.length;
    const legs: number[][] = [];
    const stops: number[] = [];
    let cur = v.order;
    let total = 0;
    for (let k = 0; k < maxLegs && total < 4000; k++) {
      const from = this.t.stops.get(route.orders[cur]?.stopId);
      if (!from) break;
      const tiles = [from.idx];
      let next = (cur + 1) % n;
      for (let g = 0; g < n; g++) {
        const w = this.t.stops.get(route.orders[next].stopId);
        if (!w || !this.t.isWay(route, next)) break;
        if (v.mode === 'rail') tiles.push(w.idx);
        next = (next + 1) % n;
      }
      const dest = this.t.stops.get(route.orders[next].stopId);
      if (!dest || next === cur) break;
      tiles.push(dest.idx);
      const leg: number[] = [];
      let ok = true;
      for (let q = 0; q + 1 < tiles.length; q++) {
        const p = this.t.route(tiles[q], tiles[q + 1], v.mode === 'rail');
        if (!p) {
          ok = false;
          break;
        }
        for (let i = leg.length ? 1 : 0; i < p.length; i++) leg.push(p[i]);
      }
      if (!ok) break;
      legs.push(leg);
      stops.push(next);
      total += leg.length;
      cur = next;
    }
    return { legs, stops };
  }

  /** Duplicate a route. reverse = opposite direction (orders reversed), shiftTicks = how much to shift the timetable. Vehicles are not duplicated */
  cloneRoute(routeId: number, reverse: boolean, shiftTicks: number): Route | null {
    const src = this.t.routes.get(routeId);
    if (!src) return null;
    const id = this.t.nextId++;
    const list = reverse ? [...src.orders].reverse() : src.orders;
    const copy: Route = {
      ...src,
      id,
      name: `${src.name}${reverse ? '(逆)' : shiftTicks ? `(+${Math.round(shiftTicks / (DAY_TICKS / 1440))}分)` : '(複製)'}`,
      color: ROUTE_COLORS[this.t.routes.size % ROUTE_COLORS.length],
      orders: list.map((o) => ({ ...o, cond: undefined, departTod: o.kind === 'timed' ? (((o.departTod + shiftTicks) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS : o.departTod })),
      shared: undefined,
      late: 0,
      carried: 0,
      legMeasured: undefined,
      dayRevenue: 0,
      income: 0,
      profit: 0,
      vs: undefined,
      legs: undefined,
      owner: this.t.actor || undefined,
    };
    this.t.routes.set(id, copy);
    if (reverse && copy.orders.some((o) => o.kind === 'timed')) {
      // A reversed timetable is rebuilt from travel times, starting a little after the original's last departure
      const last = [...src.orders].reverse().find((o) => o.kind === 'timed');
      if (last) this.autoTimetable(id, last.departTod + last.dwell + 5 * (DAY_TICKS / 1440) + shiftTicks);
    }
    this.t.version++;
    return copy;
  }

  /** For the timetable screen: travel time to the next stopping stop for each order of the route (measured if available). Empty if there are no timed orders */
  legsOf(route: Route): number[] {
    return route.orders.map((_, i) => (this.t.isWay(route, i) ? 0 : (route.legMeasured?.[i] ?? this.legTicks(route, i) ?? 0)));
  }
}
