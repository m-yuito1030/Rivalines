/**
 * Timetable (train diagram) calculations. Pure functions shared by the screen (drawing the diagram, suggesting passing loops) and the tests.
 * Time is in ticks (1 day = DAY_TICKS). A route's timetable repeats with period `period`: each order's departure time departTod plus each vehicle's offset.
 */
export const DAY = 30 * 60 * 10; // same value as transit.DAY_TICKS (avoids a circular import)
export const MIN = DAY / 1440; // one minute

export interface DiaStop {
  id: number;
  name: string;
  x: number;
  y: number;
  /** Number of platform tracks (a station with 2 or more can host a passing loop) */
  tracks: number;
}
export interface DiaOrder {
  stopId: number;
  kind: 'dwell' | 'full' | 'timed';
  departTod: number;
  dwell: number;
  /** Waypoint (no stop) */
  way?: boolean;
}
export interface DiaRoute {
  id: number;
  name: string;
  color: number;
  period: number;
  orders: DiaOrder[];
  /** For each order, the travel time to the next stopping stop (0 for a waypoint) */
  legs: number[];
  /** Vehicles (id, departure offset) */
  vs: [number, number][];
}

/** The plan for one lap of one train: arrival and departure at each stopping stop (ticks; absolute times within the period) */
export interface RunPoint {
  order: number;
  stopId: number;
  arr: number;
  dep: number;
}
export interface Run {
  routeId: number;
  vehicleId: number;
  offset: number;
  points: RunPoint[];
  /** Arrival time back at the first stop after one lap (to close the line) */
  backArr: number;
}

const mod = (a: number, p: number) => ((a % p) + p) % p;
/** The smallest value of s + j*P that is at least min */
const nextOcc = (s: number, min: number, P: number) => s + Math.ceil((min - s) / P - 1e-9) * P;

/** Build the plan for one lap of one train (offset) of a route */
export function buildRun(route: DiaRoute, vehicleId: number, offset: number): Run {
  const real = route.orders.map((o, i) => (o.way ? -1 : i)).filter((i) => i >= 0);
  const P = route.period;
  const points: RunPoint[] = [];
  let prevDep = 0;
  let prevLeg = 0;
  real.forEach((idx, k) => {
    const o = route.orders[idx];
    let arr: number;
    let dep: number;
    if (k === 0) {
      dep = o.kind === 'timed' ? mod(o.departTod + offset, P) : offset + o.dwell;
      arr = dep - o.dwell;
    } else {
      arr = prevDep + prevLeg;
      dep = o.kind === 'timed' ? nextOcc(o.departTod + offset, arr + o.dwell, P) : arr + o.dwell;
    }
    points.push({ order: idx, stopId: o.stopId, arr, dep });
    prevDep = dep;
    prevLeg = route.legs[idx] ?? 0;
  });
  return { routeId: route.id, vehicleId, offset, points, backArr: prevDep + prevLeg };
}

/** Plans for all trains of a route (one assumed line with offset=0 if there are no trains) */
export function routeRuns(route: DiaRoute): Run[] {
  return route.vs.length ? route.vs.map(([id, off]) => buildRun(route, id, off)) : [buildRun(route, 0, 0)];
}

/** A suggestion to overtake (use a passing loop) */
export interface PassSuggestion {
  /** The slow route that waits in the loop, and the order number of the station where it waits */
  routeId: number;
  orderIdx: number;
  stopName: string;
  /** The fast route that overtakes */
  byRouteId: number;
  byName: string;
  /** How much (ticks) to delay departures from that order onwards */
  delta: number;
  /** How many minutes it waits at this station (for display) */
  waitMin: number;
  /** Explanation when no station can host a loop (not enough platform tracks). If present, the suggestion cannot be applied */
  problem?: string;
}

/** Distance along the route's stopping-stop coordinates (for interpolating by ticks) */
function cumDist(stops: Map<number, DiaStop>, ids: number[]): number[] {
  const c = [0];
  for (let i = 1; i < ids.length; i++) {
    const a = stops.get(ids[i - 1]);
    const b = stops.get(ids[i]);
    c.push(c[i - 1] + (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1));
  }
  return c;
}

/**
 * For two routes on the same track, find where the fast train catches up with the slow one between stations,
 * and suggest having the slow train wait at a station with a passing loop.
 * Works when the fast route's stops are a subsequence of the slow route's stops (like local / rapid / limited express).
 */
export function suggestPassing(routes: DiaRoute[], stops: Map<number, DiaStop>): PassSuggestion[] {
  const out: PassSuggestion[] = [];
  const seen = new Set<string>();
  for (const A of routes) {
    const realA = A.orders.map((o, i) => (o.way ? -1 : i)).filter((i) => i >= 0);
    const La = realA.map((i) => A.orders[i].stopId);
    if (La.length < 2) continue;
    const cum = cumDist(stops, La);
    const runsA = routeRuns(A);
    for (const B of routes) {
      if (B.id === A.id) continue;
      const realB = B.orders.map((o, i) => (o.way ? -1 : i)).filter((i) => i >= 0);
      if (realB.length < 2) continue;
      // Whether B's stops appear in A's stop list in increasing order (a subsequence)
      const posB: number[] = [];
      let from = 0;
      let ok = true;
      for (const i of realB) {
        const p = La.indexOf(B.orders[i].stopId, from);
        if (p < 0) {
          ok = false;
          break;
        }
        posB.push(p);
        from = p;
      }
      if (!ok || realB.length >= La.length) continue; // not a subsequence / same number of stops or more (not faster)
      const runsB = routeRuns(B);
      for (const ra of runsA) {
        for (const rb of runsB) {
          for (let shift = -2; shift <= 2; shift++) {
            const dt = shift * B.period;
            // B's passing time at each station (per index of A's station list): arrival/departure at stops, interpolated by distance for skipped stations
            const passB: { arr: number; dep: number }[] = new Array(La.length);
            for (let m = 0; m < rb.points.length; m++) passB[posB[m]] = { arr: rb.points[m].arr + dt, dep: rb.points[m].dep + dt };
            for (let m = 0; m + 1 < rb.points.length; m++) {
              const i1 = posB[m];
              const i2 = posB[m + 1];
              const d0 = rb.points[m].dep + dt;
              const d1 = rb.points[m + 1].arr + dt;
              const tot = cum[i2] - cum[i1] || 1;
              for (let q = i1 + 1; q < i2; q++) {
                const t = d0 + ((cum[q] - cum[i1]) / tot) * (d1 - d0);
                passB[q] = { arr: t, dep: t };
              }
            }
            // For each leg of A, whether B catches up from behind
            for (let k = 0; k + 1 < ra.points.length; k++) {
              const u = passB[k];
              const v = passB[k + 1];
              if (!u || !v) continue;
              const depA = ra.points[k].dep;
              const arrA = ra.points[k + 1].arr;
              if (!(u.dep > depA && v.arr < arrA)) continue; // the overtaking condition
              // Waiting station: the last station before the overtake where A arrives before B and that has two or more platform tracks
              let w = -1;
              for (let q = k; q >= 0; q--) {
                if (!passB[q]) continue;
                const st = stops.get(La[q]);
                if (st && st.tracks >= 2 && ra.points[q].arr <= passB[q].arr) {
                  w = q;
                  break;
                }
              }
              const key = `${A.id}:${B.id}:${w < 0 ? 'x' + k : w}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const stopName = stops.get(La[w < 0 ? k : w])?.name ?? '?';
              if (w < 0) {
                out.push({
                  routeId: A.id,
                  orderIdx: realA[k],
                  stopName,
                  byRouteId: B.id,
                  byName: B.name,
                  delta: 0,
                  waitMin: 0,
                  problem: `${A.name} を ${B.name} が追い越しますが、手前に番線が2以上の駅がないため待避できません(駅の番線を増やしてください)`,
                });
                continue;
              }
              const newDep = passB[w].dep + MIN;
              const delta = Math.ceil((newDep - ra.points[w].dep) / MIN) * MIN;
              out.push({ routeId: A.id, orderIdx: realA[w], stopName, byRouteId: B.id, byName: B.name, delta, waitMin: Math.round((passB[w].dep + MIN - ra.points[w].arr) / MIN) });
            }
          }
        }
      }
    }
  }
  return out.sort((a, b) => Number(!!a.problem) - Number(!!b.problem));
}
