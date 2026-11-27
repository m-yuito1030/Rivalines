import { Depot, Flight, KIND_INDEX, Route, Stop, Vehicle } from './types';
import type { Transit } from './transit';

/** Client: apply the structure, waiting counts, and vehicles that arrived from the server, and animate them smoothly */
export class MirrorSync {
  constructor(private readonly t: Transit) {}

  /** Client (viewer side): replace with the structure received from the server (stops, routes, depots, signals). The breakdown of waiting people is not kept */
  mirrorStruct(d: { nextId: number; routes: Route[]; stops: Stop[]; depots: Depot[]; signals: [number, number][]; grants?: [number, number[]][] }): void {
    this.t.nextId = d.nextId;
    this.t.grants = new Map((d.grants ?? []).map(([o, l]) => [o, new Set(l)]));
    const old = this.t.stops;
    this.t.stops = new Map(d.stops.map((s) => [s.id, { ...s, wait: new Map(), waiting: old.get(s.id)?.waiting ?? 0 }]));
    this.t.stopAt = new Map(d.stops.flatMap((s) => this.t.stopTiles(s).map((i) => [i * 3 + KIND_INDEX[s.kind], s.id] as [number, number])));
    this.t.routes = new Map(d.routes.map((r) => [r.id, r]));
    this.t.signals = new Map(d.signals);
    this.t.depots = new Map(d.depots.map((x) => [x.id, x]));
    this.t.depotAt = new Map(d.depots.map((x) => [x.idx, x.id]));
    this.t.version++;
  }

  /** Client: update only the number of people waiting */
  mirrorWaiting(list: [number, number][]): void {
    for (const s of this.t.stops.values()) s.waiting = 0;
    for (const [id, n] of list) {
      const s = this.t.stops.get(id);
      if (s) s.waiting = n;
    }
  }

  /** Client: apply the latest state of in-view vehicles (a path arrives only when it changes, so keep the previous one) */
  mirrorVehicles(list: (Omit<Vehicle, 'path' | 'cargo'> & { path?: number[] })[], gone: number[]): void {
    for (const id of gone) {
      this.t.mirrorVeh.delete(id);
      this.t.snaps.delete(id);
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let changed = false;
    for (const m of list) {
      const prev = this.t.mirrorVeh.get(m.id);
      const path = m.path ? Uint32Array.from(m.path) : prev?.path;
      if (!path) continue; // the path has not arrived yet (normally does not happen)
      this.t.mirrorVeh.set(m.id, { ...(prev ?? ({ arrived: 0, until: 0, retryAt: 0, offset: 0 } as Vehicle)), ...m, path, cargo: prev?.cargo ?? new Map() } as Vehicle);
      if (!prev) changed = true;
      // Record this state for interpolation (only when the path is the same can we interpolate between the previous state and this one)
      const old = this.t.snaps.get(m.id);
      const same = old !== undefined && old.path === path;
      const flight = m.flight as Flight | null;
      this.t.snaps.set(m.id, {
        path,
        prev: same ? old.cur : null,
        prevAt: same ? old.curAt : now,
        curAt: now,
        cur: { pi: m.pi, t: m.t, trail: m.trail, done: flight ? flight.done : 0 },
      });
    }
    this.t.vehicles = [...this.t.mirrorVeh.values()];
    if (changed || gone.length) this.t.version++;
  }

  /**
   * Client: call on every draw. The server's state arrives only at about 10 Hz, so interpolate linearly between the last two states, delayed by one interval
   * (progress along the path pi+t; for trains the formation's trail; for aircraft the flight distance), so motion is smooth even at 60 fps.
   * When arrival is late, extrapolate a little, then hold. When the path changed, do not interpolate and just show the state.
   */
  smoothMirror(now: number = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
    for (const [id, v] of this.t.mirrorVeh) {
      const sn = this.t.snaps.get(id);
      if (!sn || !sn.prev) continue;
      const dt = sn.curAt - sn.prevAt;
      if (dt <= 0 || dt > 600) continue;
      const delay = Math.min(250, Math.max(60, dt));
      const a = Math.max(0, Math.min(1.25, (now - delay - sn.prevAt) / dt));
      const { prev, cur, path } = sn;
      if (v.flight) {
        const f = v.flight as Flight;
        f.done = Math.min(f.dist, prev.done + (cur.done - prev.done) * a);
        continue;
      }
      const last = path.length - 1;
      const p = Math.max(0, Math.min(last, prev.pi + prev.t + (cur.pi + cur.t - (prev.pi + prev.t)) * a));
      const pi = Math.min(last, Math.floor(p));
      v.pi = pi;
      v.t = pi >= last ? 0 : p - pi;
      if (v.mode === 'rail' && cur.trail.length) {
        // The train's trail when its head is at pi (in head-first order): built from the current server trail and path
        const diff = cur.pi - pi; // the displayed head is diff tiles behind the server's head
        const tr: number[] = [];
        for (let j = 0; j < cur.trail.length; j++) {
          const n = j + diff; // n tiles behind the server's head
          let tile: number;
          if (n < 0) tile = path[Math.min(last, cur.pi - n)];
          else if (n < cur.trail.length) tile = cur.trail[n];
          else tile = cur.pi - n >= 0 ? path[cur.pi - n] : cur.trail[cur.trail.length - 1];
          tr.push(tile);
        }
        v.trail = tr;
      }
    }
  }
}
