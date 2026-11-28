import { REVERSE_MIN_TILES, REVERSE_RATIO, Route, Stop, Vehicle } from './types';
import type { Transit } from './transit';

/** Vehicle departure: pick the path to the next stop and set off (bus, rail, air) */
export class Dispatcher {
  constructor(private readonly t: Transit) {}

  /** Depart toward the next order (noroute if there is no path) */
  depart(v: Vehicle, route: Route, tick: number, advance: boolean): void {
    this.departInner(v, route, tick, advance, route.orders.length);
  }

  departInner(v: Vehicle, route: Route, tick: number, advance: boolean, n: number): void {
    if (advance) {
      v.from = v.order;
      v.departedAt = tick;
    }
    let next = advance ? (v.order + 1) % n : v.order;
    // Conditional order: if the condition holds on departure, jump to the specified order
    if (advance) {
      const c = route.orders[v.order]?.cond;
      if (c && c.to >= 0 && c.to < n && c.to !== v.order && this.t.flow.condHolds(v, route, c, tick)) next = c.to;
    }
    // Rail: an intermediate waypoint is a marker to pass through without stopping. Build a path through the waypoint tiles in order
    const vias: number[] = [];
    for (let g = 0; g < n; g++) {
      const w = this.t.stops.get(route.orders[next].stopId);
      if (!w || !this.t.isWay(route, next)) break;
      if (v.mode === 'rail') vias.push(w.idx); // rail passes through skipped stations and waypoint tiles in order (road and air just skip them)
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
      if (!c.length && vias.length) c = this.t.planner.railCandidates(v, [], dest); // if it cannot go via them, go direct
      return c;
    };
    let cands = build();
    if (v.trail.length > 1) {
      // Heading is opposite: reverse the train (the tail becomes the head). Besides when no forward path exists, also reverse at a stop
      // when going forward is a long detour (a loop line, etc.) and reversing is much shorter (the driver moves to the other cab)
      const fwd = cands.length ? cands[0].length : Infinity;
      if (fwd > REVERSE_MIN_TILES) {
        v.trail.reverse();
        const rev = build();
        if (rev.length && rev[0].length * REVERSE_RATIO < fwd) cands = rev;
        else v.trail.reverse();
      }
    }
    if (!cands.length) return this.blocked(v, tick, 30);
    // Reserve the block ahead (the whole path if there are no signals; so trains neither collide nor meet head-on). Try the free platform tracks in turn
    for (const c of cands) {
      v.path = Uint32Array.from(c);
      v.resTo = 0;
      if (!this.t.signalsSys.extendReservation(v)) continue;
      v.pi = 0;
      v.t = 0;
      v.stuck = 0;
      v.sf = 0.3; // departure starts slow and accelerates
      v.state = 'move';
      if (v.path.length === 1) this.t.motion.arrive(v, route, tick);
      return;
    }
    v.path = Uint32Array.of(v.trail[0]);
    this.blocked(v, tick, 10);
  }

  departAir(v: Vehicle, dest: Stop, route: Route, tick: number): void {
    this.t.air.depart(v, dest, route, tick);
  }

  blocked(v: Vehicle, tick: number, wait: number): void {
    v.state = 'noroute';
    v.retryAt = tick + wait;
    v.stuck += wait;
  }

  /** @returns true if the vehicle survives */
  /**
   * The track it runs on changed, so whether to search the path from the current tile to the destination again. Clears the mark and returns true.
   * For a leg with a waypoint before the destination, do not search again, to keep the waypoint (it takes effect at the next departure).
   */
  takeReplan(v: Vehicle, route: Route): boolean {
    if (!v.replan) return false;
    v.replan = false;
    const n = route.orders.length;
    if (this.t.isWay(route, (v.order - 1 + n) % n)) return false;
    return true;
  }
}
