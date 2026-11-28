import { type Airport, type Runway, airportAt } from '../../world/airports';
import { AIR, isTaxiable } from '../../world/airportLayout';
import { type FlightPoint, buildFlight, endHeading, straightFlight } from './flightPath';
import type { Flight, Route, Stop, Vehicle } from './types';
import type { Transit } from './transit';

/**
 * Air traffic: how aircraft move on and around an airport.
 *
 *  - On the ground an aircraft rolls along taxiways and aprons from its stand (or the hangar) to the end of a runway.
 *  - A runway takes ONE aircraft at a time (a takeoff or a landing). Each runway keeps a list of reserved time windows.
 *    A departing aircraft waits at its stand until a window is free; a landing aircraft that finds no free window
 *    flies circles at the arrival fix (a holding pattern) and asks again every lap.
 *  - Each stand takes one aircraft. An arriving aircraft needs a free stand too; if all are taken it keeps circling.
 *  - The big airports have two runways, so they can land and take off at the same time (one on each).
 *
 * Old 3x3 airports (no stands) keep the old behaviour: a straight flight from terminal to terminal.
 * All of this is decided on the server; the screen only draws the path (flightPath.ts).
 */

/** Speed multipliers (times the aircraft's speed) */
export const TAXI = 0.2;
export const ROLL = 0.9;
export const APPROACH = 0.85;
export const LAND = 0.5;
export const HOLD = 1;
/** Geometry, in tiles */
export const FIX_DIST = 18;
export const HOLD_RADIUS = 3;
const CLIMB_LEN = 12;
const DESCENT_LEN = 14;
const ROLLOUT = 5;
/** Altitude at the arrival fix, and while circling */
export const HOLD_Z = 0.7;

type Stage = 'toFix' | 'hold' | 'landing' | 'taxiHome' | 'toLegacy';
interface AirState {
  stage: Stage;
  /** The arrival fix (where it holds): position and the heading it arrives with */
  fix?: { x: number; y: number; dx: number; dy: number };
  /** Tile of the stand it parks at when the flight ends (or the terminal tile for an old airport) */
  park: number;
}

interface Window {
  start: number;
  end: number;
}

const centerOf = (idx: number, size: number) => ({ x: (idx % size) + 0.5, y: Math.floor(idx / size) + 0.5 });

export class AirTraffic {
  /** Reserved time windows for each runway: key = airport id * 8 + runway index */
  private busy = new Map<number, Window[]>();
  /** Which aircraft holds each stand (tile index → vehicle id) */
  private standOwner = new Map<number, number>();
  private state = new Map<number, AirState>();
  /** Why landings had to wait (counted for tests and tuning) */
  readonly stats = { noExit: 0, runwayBusy: 0, noStand: 0, landed: 0 };

  constructor(private readonly t: Transit) {}

  // ---------------------------------------------------------------- Reservations
  private windows(airportId: number, ri: number, now: number): Window[] {
    const key = airportId * 8 + ri;
    let w = this.busy.get(key);
    if (!w) this.busy.set(key, (w = []));
    // Forget windows that ended a while ago
    for (let i = w.length - 1; i >= 0; i--) if (w[i].end < now - 20) w.splice(i, 1);
    return w;
  }

  private overlaps(list: Window[], start: number, end: number): Window | undefined {
    return list.find((w) => w.start < end && start < w.end);
  }

  /** The earliest start at or after `from` where a window of this length does not overlap a reserved one */
  private firstFree(list: Window[], from: number, length: number): number {
    let start = from;
    for (let guard = 0; guard < 200; guard++) {
      const hit = this.overlaps(list, start, start + length);
      if (!hit) return start;
      start = hit.end;
    }
    return start;
  }

  private alive(id: number): boolean {
    return this.t.vehicles.some((x) => x.id === id);
  }

  private standFree(idx: number): boolean {
    const o = this.standOwner.get(idx);
    return o === undefined || !this.alive(o);
  }

  /** Number of aircraft holding a stand (for tests and displays) */
  standsInUse(airportId: number): number {
    let n = 0;
    for (const [idx, o] of this.standOwner) {
      const a = airportAt(this.t.map, idx);
      if (a && a.id === airportId && this.alive(o)) n++;
    }
    return n;
  }

  /** Whether the aircraft is circling at an arrival fix, waiting for a free runway or stand */
  holding(id: number): boolean {
    return this.state.get(id)?.stage === 'hold';
  }

  /** Reserved windows of a runway (for tests) */
  reservations(airportId: number, ri: number): Window[] {
    return [...(this.busy.get(airportId * 8 + ri) ?? [])];
  }

  // ---------------------------------------------------------------- Ground
  /** Shortest path over taxiable tiles from one tile to another (tile indices, inclusive), not through stands that are taken */
  taxiPath(from: number, to: number, ownerId: number): number[] | null {
    const m = this.t.map;
    const s = m.size;
    if (from === to) return [from];
    const prev = new Map<number, number>([[from, -1]]);
    const queue = [from];
    for (let h = 0; h < queue.length; h++) {
      const k = queue[h];
      if (k === to) break;
      const x = k % s;
      const y = (k - x) / s;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (!m.inBounds(nx, ny)) continue;
        const n = m.idx(nx, ny);
        if (prev.has(n)) continue;
        const c = m.air.get(n);
        if (!isTaxiable(c)) continue;
        // Another aircraft's stand is in the way (a stand is a parking place, not a road)
        if (c === AIR.STAND && n !== to && !this.standFree(n) && this.standOwner.get(n) !== ownerId) continue;
        prev.set(n, k);
        queue.push(n);
      }
    }
    if (!prev.has(to)) return null;
    const path: number[] = [];
    for (let k = to; k !== -1; k = prev.get(k)!) path.push(k);
    return path.reverse();
  }

  /** The tile of a runway end's neighbour that aircraft use to get on / off (the taxiway beside the end tile) */
  private accessNear(r: Runway, runwayIdx: number): number | undefined {
    const s = this.t.map.size;
    const x = runwayIdx % s;
    const y = (runwayIdx - x) / s;
    const cand = r.axis === 'x' ? [y + 1, y - 1].map((yy) => yy * s + x) : [x + 1, x - 1].map((xx) => y * s + xx);
    return cand.find((c) => r.access.includes(c) && isTaxiable(this.t.map.air.get(c)));
  }

  private taxiTicks(path: number[], speed: number): number {
    return Math.max(0, path.length - 1) / (speed * TAXI);
  }

  private taxiPoints(path: number[], first = false): FlightPoint[] {
    const s = this.t.map.size;
    return path.map((k, i) => ({ ...centerOf(k, s), z: 0, sp: i === 0 && first ? 1 : TAXI }));
  }

  // ---------------------------------------------------------------- Departure
  /** Called when a vehicle sets off for its next stop (it is parked on the ground at v.path[0]) */
  depart(v: Vehicle, dest: Stop, route: Route, tick: number): void {
    const m = this.t.map;
    const s = m.size;
    let from = v.path[0];
    const oa = airportAt(m, from);
    const da = airportAt(m, dest.idx);
    if (!oa || !da) return this.t.dispatch.blocked(v, tick, 60);
    const advancedOrigin = oa.size !== 'legacy';
    const advancedDest = da.size !== 'legacy';
    if (advancedOrigin && !isTaxiable(m.air.get(from))) {
      // Not on the ground network (e.g. put on the terminal by an old save): move it onto a free stand first
      const st = this.pickStand(oa, from, v.id);
      if (!st) return this.t.dispatch.blocked(v, tick, 20);
      v.path = Uint32Array.of(st.stand);
      this.standOwner.set(st.stand, v.id);
      from = st.stand;
    }

    // Same airport (a new aircraft from this airport's hangar to its first stop here, or the restart after loading a save)
    if (advancedOrigin && oa.id === da.id) return this.taxiHome(v, da, route, tick);

    const pts: FlightPoint[] = [];
    let liftoff: { x: number; y: number; dx: number; dy: number };
    if (advancedOrigin) {
      const plan = this.planTakeoff(v, oa, dest, tick);
      if (plan === null) return this.t.dispatch.blocked(v, tick, 40);
      if (typeof plan === 'number') return this.t.dispatch.blocked(v, tick, Math.max(1, Math.ceil(plan)));
      pts.push(...plan.points);
      liftoff = plan.liftoff;
      if (this.standOwner.get(from) === v.id) this.standOwner.delete(from);
      const win = this.windows(oa.id, plan.runway, tick);
      win.push(plan.window);
    } else {
      // Old airport: the aircraft is on the ground at the terminal and climbs straight away
      const c = centerOf(from, s);
      const dx = dest.x + 0.5 - c.x;
      const dy = dest.y + 0.5 - c.y;
      const l = Math.hypot(dx, dy) || 1;
      pts.push({ ...c, z: 0 });
      liftoff = { ...c, dx: dx / l, dy: dy / l };
    }

    // Cruise to the arrival fix (or straight to an old airport's terminal)
    const target = { x: dest.x + 0.5, y: dest.y + 0.5 };
    const dx = target.x - liftoff.x;
    const dy = target.y - liftoff.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return this.t.motion.arrive(v, route, tick);
    const ux = dx / dist;
    const uy = dy / dist;
    if (advancedDest) {
      const fixDist = Math.max(0, dist - FIX_DIST);
      const fix = { x: liftoff.x + ux * fixDist, y: liftoff.y + uy * fixDist };
      pts.push(...this.cruisePoints(liftoff, fix, ux, uy, HOLD_Z));
      this.state.set(v.id, { stage: 'toFix', fix: { ...fix, dx: ux, dy: uy }, park: -1 });
    } else {
      pts.push(...this.cruisePoints(liftoff, target, ux, uy, 0));
      this.state.set(v.id, { stage: 'toLegacy', park: dest.idx });
    }
    this.start(v, buildFlight(pts));
  }

  /** Points of the climb and cruise from `from` to `to` (altitude `endZ` at the end) */
  private cruisePoints(from: { x: number; y: number }, to: { x: number; y: number }, ux: number, uy: number, endZ: number): FlightPoint[] {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const out: FlightPoint[] = [];
    const climb = Math.min(CLIMB_LEN, dist / 2);
    const descent = Math.min(endZ > 0 ? CLIMB_LEN * 0.5 : DESCENT_LEN, dist / 2);
    if (dist > climb + descent + 0.5) {
      out.push({ x: from.x + ux * climb, y: from.y + uy * climb, z: 1 });
      out.push({ x: to.x - ux * descent, y: to.y - uy * descent, z: 1 });
    } else if (dist > 0.5) {
      const k = climb / dist;
      out.push({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: Math.min(1, 0.5 + climb / CLIMB_LEN / 2) });
    }
    out.push({ x: to.x, y: to.y, z: endZ });
    return out;
  }

  /**
   * Choose a runway and an end for taking off, and the path there.
   * Returns the plan (the taxi and roll points, where it lifts off, and the window to reserve), a number of ticks to wait,
   * or null when there is no way to a runway.
   */
  private planTakeoff(v: Vehicle, a: Airport, dest: Stop, tick: number) {
    const s = this.t.map.size;
    const from = v.path[0];
    const fc = centerOf(from, s);
    const toDx = dest.x + 0.5 - fc.x;
    const toDy = dest.y + 0.5 - fc.y;
    interface Plan {
      score: number;
      wait: number;
      runway: number;
      entry: number[];
      order: number[];
      window: Window;
    }
    let best: Plan | null = null;
    for (let ri = 0; ri < a.runways.length; ri++) {
      const r = a.runways[ri];
      for (const end of ['A', 'B'] as const) {
        const order = end === 'A' ? r.tiles : [...r.tiles].reverse();
        const access = this.accessNear(r, order[0]);
        if (access === undefined) continue;
        const path = this.taxiPath(from, access, v.id);
        if (!path) continue;
        // It is on the runway from the moment it steps onto the first runway tile (one tile after the end of the taxi path)
        const enterTicks = this.taxiTicks(path, v.speed);
        const lineUp = 1 / (v.speed * TAXI);
        // It lifts off after about three quarters of the runway
        const roll = Math.max(4, Math.floor((order.length - 1) * 0.75)) / (v.speed * ROLL);
        const list = this.windows(a.id, ri, tick);
        const wantStart = tick + enterTicks;
        const start = this.firstFree(list, wantStart, lineUp + roll + 8);
        const wait = start - wantStart;
        const oc = centerOf(order[0], s);
        const oe = centerOf(order[order.length - 1], s);
        const along = (oe.x - oc.x) * toDx + (oe.y - oc.y) * toDy;
        // Prefer the soonest slot; take off toward the destination if it costs little
        const score = wait + path.length * 2 + (along < 0 ? 60 : 0);
        if (!best || score < best.score) best = { score, wait, runway: ri, entry: path, order, window: { start, end: start + lineUp + roll + 8 } };
      }
    }
    const b = best as Plan | null;
    if (!b) return null;
    if (b.wait > 0.5) return b.wait;
    const first = centerOf(b.order[0], s);
    const last = centerOf(b.order[b.order.length - 1], s);
    const rl = Math.hypot(last.x - first.x, last.y - first.y) || 1;
    const rx = (last.x - first.x) / rl;
    const ry = (last.y - first.y) / rl;
    const points: FlightPoint[] = [...this.taxiPoints(b.entry, true)];
    // Line up on the runway, roll to its far end and lift off
    points.push({ ...first, z: 0, sp: TAXI });
    const liftAt = Math.max(4, Math.floor((b.order.length - 1) * 0.75));
    const lp = centerOf(b.order[liftAt], s);
    points.push({ ...lp, z: 0, sp: ROLL });
    // Past the lift-off point it keeps its heading and climbs
    const lift = { x: lp.x + rx * 6, y: lp.y + ry * 6 };
    points.push({ ...lift, z: 0.35, sp: 1 });
    return { points, liftoff: { ...lift, dx: rx, dy: ry }, runway: b.runway, window: b.window };
  }

  /** Taxi from where the aircraft is to a free stand of this airport and park there (no flying) */
  private taxiHome(v: Vehicle, a: Airport, route: Route, tick: number): void {
    const from = v.path[0];
    const stand = this.pickStand(a, from, v.id);
    if (!stand) return this.t.dispatch.blocked(v, tick, 20); // every stand is taken: wait
    const park = stand.stand;
    if (this.standOwner.get(from) === v.id) this.standOwner.delete(from);
    this.standOwner.set(park, v.id);
    if (!isTaxiable(this.t.map.air.get(from))) {
      // Not on the ground network (e.g. loaded from an old save): just put it on the stand
      v.path = Uint32Array.of(park);
      return this.t.motion.arrive(v, route, tick);
    }
    if (stand.path.length < 2) {
      v.path = Uint32Array.of(park);
      return this.t.motion.arrive(v, route, tick);
    }
    this.state.set(v.id, { stage: 'taxiHome', park });
    this.start(v, buildFlight(this.taxiPoints(stand.path, true)));
  }

  /** The free stand that is nearest by taxiing from `from`, and the way there */
  private pickStand(a: Airport, from: number, id: number): { stand: number; path: number[] } | null {
    const free = a.stands.filter((k) => this.standFree(k) || this.standOwner.get(k) === id);
    let best: { stand: number; path: number[] } | null = null;
    if (!isTaxiable(this.t.map.air.get(from))) return free.length ? { stand: free[0], path: [free[0]] } : null;
    for (const k of free) {
      const p = this.taxiPath(from, k, id);
      if (p && (!best || p.length < best.path.length)) best = { stand: k, path: p };
    }
    return best;
  }

  private start(v: Vehicle, f: Flight): void {
    v.flight = f;
    const x = f.pts[3] - f.pts[0];
    const y = f.pts[4] - f.pts[1];
    const l = Math.hypot(x, y);
    if (l > 1e-9) {
      v.hx = x / l;
      v.hy = y / l;
    }
    v.state = 'move';
    v.stuck = 0;
  }

  // ---------------------------------------------------------------- Arrival
  /** The flight ended: park, or decide what to do at the arrival fix (land, or circle) */
  onFlightEnd(v: Vehicle, route: Route, tick: number): void {
    const f = v.flight!;
    const st = this.state.get(v.id);
    const head = endHeading(f);
    v.hx = head.dx;
    v.hy = head.dy;
    const stage = st?.stage;
    if (stage === 'toFix' || stage === 'hold') return this.atFix(v, route, tick, st!);
    // Parked (landed and taxied in / taxied home / reached an old airport)
    v.flight = null;
    const dest = this.t.stops.get(route.orders[v.order].stopId);
    v.path = Uint32Array.of(st && st.park >= 0 ? st.park : dest ? dest.idx : v.path[0]);
    this.state.delete(v.id);
    this.t.motion.arrive(v, route, tick);
  }

  private atFix(v: Vehicle, route: Route, tick: number, st: AirState): void {
    const m = this.t.map;
    const dest = this.t.stops.get(route.orders[v.order].stopId);
    const da = dest ? airportAt(m, dest.idx) : null;
    if (!dest || !da || da.size === 'legacy') {
      // The airport changed under it (removed or an old one): land straight on the terminal
      v.flight = null;
      v.path = Uint32Array.of(dest ? dest.idx : v.path[0]);
      this.state.delete(v.id);
      return this.t.motion.arrive(v, route, tick);
    }
    const fix = st.fix ?? { x: v.flight!.pts[v.flight!.pts.length - 3], y: v.flight!.pts[v.flight!.pts.length - 2], dx: v.hx, dy: v.hy };
    const plan = this.planLanding(v, da, fix, tick);
    if (!plan) {
      // No free runway window or no free stand: circle once more and ask again
      this.state.set(v.id, { ...st, stage: 'hold', fix });
      return this.start(v, this.circle(fix));
    }
    this.windows(da.id, plan.runway, tick).push(plan.window);
    this.standOwner.set(plan.stand, v.id);
    this.state.set(v.id, { stage: 'landing', park: plan.stand });
    // Keep the heading it arrived with at the first point (the loop and the approach join at the fix)
    this.start(v, buildFlight(plan.points));
  }

  /** One lap around the fix (starts and ends at the fix, heading the way it arrived) */
  private circle(fix: { x: number; y: number; dx: number; dy: number }): Flight {
    // Turn left: the centre is to the left of the heading; position(θ) = C + r(-n cosθ + d sinθ), n = left normal
    const nx = -fix.dy;
    const ny = fix.dx;
    const cx = fix.x + nx * HOLD_RADIUS;
    const cy = fix.y + ny * HOLD_RADIUS;
    const pts: FlightPoint[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      pts.push({ x: cx + HOLD_RADIUS * (-nx * Math.cos(th) + fix.dx * Math.sin(th)), y: cy + HOLD_RADIUS * (-ny * Math.cos(th) + fix.dy * Math.sin(th)), z: HOLD_Z, sp: HOLD });
    }
    return buildFlight(pts);
  }

  /** Whether the aircraft can land now: a runway window and a stand. Returns the whole landing path, or null */
  private planLanding(v: Vehicle, a: Airport, fix: { x: number; y: number; dx: number; dy: number }, tick: number) {
    const s = this.t.map.size;
    interface Plan {
      tcross: number;
      runway: number;
      stand: number;
      points: FlightPoint[];
      window: Window;
    }
    let best: Plan | null = null;
    for (let ri = 0; ri < a.runways.length; ri++) {
      const r = a.runways[ri];
      for (const end of ['A', 'B'] as const) {
        const order = end === 'A' ? r.tiles : [...r.tiles].reverse();
        const thr = centerOf(order[0], s);
        const nxt = centerOf(order[1], s);
        const rl = Math.hypot(nxt.x - thr.x, nxt.y - thr.y) || 1;
        const rx = (nxt.x - thr.x) / rl;
        const ry = (nxt.y - thr.y) / rl;
        // Exit: a tile beside the runway a few tiles in
        let k = Math.min(order.length - 1, ROLLOUT);
        let exit: number | undefined;
        while (k < order.length && exit === undefined) exit = this.accessNear(r, order[k++]);
        if (exit === undefined) {
          this.stats.noExit++;
          continue;
        }
        k = Math.min(order.length - 1, k - 1);
        const ap = { x: thr.x - rx * DESCENT_LEN, y: thr.y - ry * DESCENT_LEN };
        const approachLen = Math.hypot(ap.x - fix.x, ap.y - fix.y) + DESCENT_LEN;
        const tcross = tick + approachLen / (v.speed * APPROACH);
        const rollTicks = (k + 1) / (v.speed * LAND);
        const window = { start: tcross - 3, end: tcross + rollTicks + 12 };
        if (this.overlaps(this.windows(a.id, ri, tick), window.start, window.end)) {
          this.stats.runwayBusy++;
          continue;
        }
        const stand = this.pickStand(a, exit, v.id);
        if (!stand) {
          this.stats.noStand++;
          continue;
        }
        if (best && best.tcross <= tcross) continue;
        const points: FlightPoint[] = [
          { x: fix.x, y: fix.y, z: HOLD_Z },
          { ...ap, z: 0.5, sp: APPROACH },
          { x: thr.x - rx * 0.5, y: thr.y - ry * 0.5, z: 0.1, sp: APPROACH },
          { x: thr.x + rx, y: thr.y + ry, z: 0, sp: LAND },
          { ...centerOf(order[k], s), z: 0, sp: LAND },
          ...this.taxiPoints(stand.path),
        ];
        best = { tcross, runway: ri, stand: stand.stand, points, window };
      }
    }
    return best as Plan | null;
  }

  // ---------------------------------------------------------------- Housekeeping
  /** After a save is loaded: aircraft in flight are put down at their destination (their paths are not saved), and parked ones take their stand */
  afterRestore(): void {
    this.busy.clear();
    this.standOwner.clear();
    this.state.clear();
    const m = this.t.map;
    for (const v of this.t.vehicles) {
      if (v.mode !== 'air') continue;
      const old = v.flight as unknown as { pts?: number[] } | null;
      if (old) {
        // The path is gone or in the old format: put it on the ground at the stop it was heading for (it takes a stand when it next departs)
        v.flight = null;
        const stop = this.t.stops.get(this.t.routes.get(v.routeId)?.orders[v.order]?.stopId ?? -1);
        if (stop) v.path = Uint32Array.of(stop.idx);
        v.state = 'noroute';
        v.retryAt = 0;
      }
      const tile = v.path[0];
      if (m.air.get(tile) === AIR.STAND) this.standOwner.set(tile, v.id);
    }
  }

  /** Forget everything about a vehicle that is gone */
  forget(id: number): void {
    this.state.delete(id);
    for (const [k, o] of this.standOwner) if (o === id) this.standOwner.delete(k);
  }
}

/** For the old save format: a straight flight from (x0,y0) to (x1,y1) */
export { straightFlight };
