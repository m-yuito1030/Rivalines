import type { Route } from './transit';

/** Cost of one transfer (in terms of number of stops) */
export const TRANSFER_PENALTY = 6;
const K = 2097152; // state key: stopId * K + routeId

export interface RouteTable {
  /** Destination stop -> the route to take now */
  next: Map<number, number>;
  /** List of destinations (the keys of next). For choosing a passenger's destination at random */
  dests: number[];
  /** Destination weights (cumulative). A weak dependence on population. Computed once when the table is built */
  cum: Float64Array;
}

/**
 * From the shortest paths over the route network (number of stops + transfer penalty), work out for each stop
 * "which route to take to reach which destination". Cached until the routes change.
 */
export class Router {
  private cache = new Map<number, RouteTable>();
  private ver = -1;

  constructor(
    private getRoutes: () => Iterable<Route>,
    private weightOf: (stopId: number) => number = () => 1,
  ) {}

  table(stopId: number, version: number): RouteTable {
    if (version !== this.ver) {
      this.cache.clear();
      this.ver = version;
    }
    let t = this.cache.get(stopId);
    if (!t) {
      t = this.compute(stopId);
      this.cache.set(stopId, t);
    }
    return t;
  }

  private compute(src: number): RouteTable {
    const routes = [...this.getRoutes()];
    // stop -> the routes that pass through that stop
    const byStop = new Map<number, Route[]>();
    for (const r of routes) {
      for (const o of r.orders) {
        const l = byStop.get(o.stopId) ?? [];
        if (!l.includes(r)) l.push(r);
        byStop.set(o.stopId, l);
      }
    }
    const dist = new Map<number, number>();
    const first = new Map<number, number>();
    // A simple Dijkstra (the number of states is small, so a linear scan over an array is enough)
    let open: number[] = [];
    for (const r of byStop.get(src) ?? []) {
      const k = src * K + r.id;
      dist.set(k, 0);
      first.set(k, r.id);
      open.push(k);
    }
    const routeById = new Map(routes.map((r) => [r.id, r]));
    const done = new Set<number>();
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (dist.get(open[i])! < dist.get(open[bi])!) bi = i;
      const k = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (done.has(k)) continue;
      done.add(k);
      const stop = Math.floor(k / K);
      const rid = k % K;
      const d = dist.get(k)!;
      const f = first.get(k)!;
      const relax = (nk: number, nd: number) => {
        if (nd < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nd);
          first.set(nk, f);
          open.push(nk);
        }
      };
      const r = routeById.get(rid)!;
      const n = r.orders.length;
      for (let i = 0; i < n; i++) if (r.orders[i].stopId === stop) relax(r.orders[(i + 1) % n].stopId * K + rid, d + 1);
      for (const r2 of byStop.get(stop) ?? []) if (r2.id !== rid) relax(stop * K + r2.id, d + TRANSFER_PENALTY);
    }
    // For each destination, adopt the "first route" of the lowest-cost state
    const best = new Map<number, number>();
    const next = new Map<number, number>();
    for (const [k, d] of dist) {
      const stop = Math.floor(k / K);
      if (stop === src) continue;
      if (d < (best.get(stop) ?? Infinity)) {
        best.set(stop, d);
        next.set(stop, first.get(k)!);
      }
    }
    open = [];
    const dests = [...next.keys()];
    const cum = new Float64Array(dests.length);
    let acc = 0;
    dests.forEach((d, i) => {
      acc += this.weightOf(d);
      cum[i] = acc;
    });
    return { next, dests, cum };
  }
}
