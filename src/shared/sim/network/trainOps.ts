import { modelOf } from '../../data/models';
import { CONN, DX8, DY8, opposite8 } from '../../world/directions';
import { MAX_CARS, Vehicle, dirBetween, trainLen } from './types';
import type { Transit } from './transit';

/** Train formation operations (split, couple, depart while held) */
export class TrainOps {
  constructor(private readonly t: Transit) {}

  // ---------------------------------------------------------------- Splitting and coupling
  capPerCar(v: Vehicle): number {
    return modelOf(v.modelId).cap; // for rail, the capacity per car
  }

  /** An unreserved adjacent tile that the track allows moving to from `tile` (not part of the trail) */
  freeNeighbor(tile: number, avoid: Set<number>): number {
    const s = this.t.map.size;
    for (let d = 0; d < 8; d++) {
      if (!(this.t.map.rail.get(tile) & CONN(d))) continue;
      const n = (Math.floor(tile / s) + DY8[d]) * s + (tile % s) + DX8[d];
      if (!avoid.has(n) && !this.t.reserved.has(n)) return n;
    }
    return -1;
  }

  /**
   * Split off the rear k cars of a stopped train. The detached train becomes a held train of the same route (depart it with departHeld).
   * Returns null if there is not enough track behind.
   */
  splitTrain(vid: number, k: number, tick: number): Vehicle | null {
    const v = this.t.vehicles.find((x) => x.id === vid);
    if (!v || v.mode !== 'rail' || v.state !== 'load' || !Number.isInteger(k) || k < 1 || k >= v.cars) return null;
    const front = v.cars - k;
    const lenA = trainLen(front);
    const lenB = trainLen(k);
    const trailA = v.trail.slice(0, lenA);
    const trailB = v.trail.slice(trailA.length);
    const used = new Set<number>(v.trail);
    // If there is not enough track behind, extend further back (unreserved track only)
    while (trailB.length < lenB) {
      const last = trailB.length ? trailB[trailB.length - 1] : trailA[trailA.length - 1];
      const n = this.freeNeighbor(last, used);
      if (n < 0) break;
      trailB.push(n);
      used.add(n);
    }
    if (!trailB.length) return null;
    const per = this.capPerCar(v);
    const cargoB = new Map<number, number>();
    let loadB = 0;
    for (const [d, n] of v.cargo) {
      const nb = Math.floor((n * k) / v.cars);
      if (nb <= 0) continue;
      cargoB.set(d, nb);
      v.cargo.set(d, n - nb);
      if (n - nb <= 0) v.cargo.delete(d);
      loadB += nb;
    }
    v.load -= loadB;
    const b: Vehicle = {
      ...v,
      id: this.t.nextId++,
      path: Uint32Array.of(trailB[0]),
      pi: 0,
      t: 0,
      state: 'load',
      arrived: tick,
      until: tick,
      retryAt: 0,
      load: loadB,
      cargo: cargoB,
      cap: per * k,
      trail: trailB,
      len: lenB,
      stuck: 0,
      cars: k,
      hold: true,
      resTo: 0,
    };
    v.cars = front;
    v.cap = per * front;
    v.len = lenA;
    v.trail = trailA;
    for (const t of trailB) this.t.reserved.set(t, b.id);
    this.t.vehicles.push(b);
    this.t.version++;
    return b;
  }

  /** Make a held train depart */
  departHeld(vid: number, tick: number): boolean {
    const v = this.t.vehicles.find((x) => x.id === vid);
    if (!v || !v.hold) return false;
    v.hold = false;
    v.until = tick;
    this.t.version++;
    return true;
  }

  /** If the ends of two stopped trains are connected by track, returns the arrangement for coupling (null if not) */
  coupleOrder(a: Vehicle, b: Vehicle): number[] | null {
    if (a === b || a.mode !== 'rail' || b.mode !== 'rail' || a.state !== 'load' || b.state !== 'load') return null;
    if (a.cars + b.cars > MAX_CARS || !a.trail.length || !b.trail.length) return null;
    const m = this.t.map;
    const s = m.size;
    const adj = (p: number, q: number) => {
      const d = dirBetween(p, q, s);
      return d >= 0 && (m.rail.get(p) & CONN(d)) !== 0 && (m.rail.get(q) & CONN(opposite8(d))) !== 0;
    };
    const aEnds: [number, boolean][] = [
      [a.trail[a.trail.length - 1], false],
      [a.trail[0], true],
    ]; // [tile, whether it is the head side]
    const bEnds: [number, boolean][] = [
      [b.trail[0], true],
      [b.trail[b.trail.length - 1], false],
    ];
    for (const [ea, aHead] of aEnds) {
      for (const [eb, bHead] of bEnds) {
        if (!adj(ea, eb)) continue;
        const aSeq = aHead ? [...a.trail].reverse() : a.trail; // so that ea comes last
        const bSeq = bHead ? b.trail : [...b.trail].reverse(); // so that eb comes first
        return [...aSeq, ...bSeq];
      }
    }
    return null;
  }

  canCouple(aId: number, bId: number): boolean {
    const a = this.t.vehicles.find((x) => x.id === aId);
    const b = this.t.vehicles.find((x) => x.id === bId);
    return !!a && !!b && this.coupleOrder(a, b) !== null;
  }

  /** Couple two trains and merge into a (b disappears). False if they cannot be coupled */
  coupleTrains(aId: number, bId: number): boolean {
    const a = this.t.vehicles.find((x) => x.id === aId);
    const b = this.t.vehicles.find((x) => x.id === bId);
    if (!a || !b) return false;
    const order = this.coupleOrder(a, b);
    if (!order) return false;
    this.t.releaseAll(b.id);
    this.t.vehicles = this.t.vehicles.filter((x) => x.id !== b.id);
    a.trail = order;
    a.cars += b.cars;
    a.cap += b.cap;
    a.len = trainLen(a.cars);
    for (const [d, n] of b.cargo) a.cargo.set(d, (a.cargo.get(d) ?? 0) + n);
    a.load += b.load;
    a.hold = a.hold && b.hold;
    for (const t of order) this.t.reserved.set(t, a.id);
    this.t.version++;
    return true;
  }

  /** Rail trains stopped near a station (within Chebyshev distance r; 9 tiles fits a 15-car train) */
  trainsNear(stopId: number, r = 9): Vehicle[] {
    const s = this.t.stops.get(stopId);
    if (!s) return [];
    const size = this.t.map.size;
    const st = s.station;
    const x0 = st ? st.x0 : s.x;
    const y0 = st ? st.y0 : s.y;
    const x1 = st ? st.x0 + (st.axis === 1 ? st.len : st.tracks) - 1 : s.x;
    const y1 = st ? st.y0 + (st.axis === 1 ? st.tracks : st.len) - 1 : s.y;
    return this.t.vehicles.filter(
      (v) =>
        v.mode === 'rail' &&
        v.state === 'load' &&
        v.trail.some((t) => {
          const tx = t % size;
          const ty = Math.floor(t / size);
          return tx >= x0 - r && tx <= x1 + r && ty >= y0 - r && ty <= y1 + r;
        }),
    );
  }
}
