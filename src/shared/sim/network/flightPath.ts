import type { Flight } from './types';

/**
 * A flight is a polyline in tile coordinates with an altitude on every point: (x, y, z), z = 0 on the ground, 1 at cruising height.
 * Taxiing, the takeoff roll, the climb, the cruise, circling and the landing are all just parts of one polyline;
 * each segment has a speed multiplier (a taxiing aircraft is much slower than a cruising one).
 * The server moves `done` along it, and the screen (which gets the polyline once, then only `done`) works out where the aircraft is.
 */

export interface FlightPoint {
  x: number;
  y: number;
  z: number;
  /** Speed multiplier for the segment that ENDS at this point (ignored for the first point) */
  sp?: number;
}

let nextFlightId = 1;

/** Build a flight from points (at least two) */
export function buildFlight(points: FlightPoint[]): Flight {
  const pts: number[] = [];
  const sp: number[] = [];
  const cum: number[] = [0];
  points.forEach((p, i) => {
    pts.push(p.x, p.y, p.z);
    if (i > 0) {
      sp.push(p.sp ?? 1);
      const dx = p.x - points[i - 1].x;
      const dy = p.y - points[i - 1].y;
      cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
  });
  return { id: nextFlightId++, pts, sp, cum, dist: cum[cum.length - 1], done: 0 };
}

/** The cumulative lengths for a polyline (the screen works them out itself when it receives a flight) */
export function cumulative(pts: number[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length / 3; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 3] - pts[(i - 1) * 3], pts[i * 3 + 1] - pts[(i - 1) * 3 + 1]));
  return cum;
}

/** Index of the segment that contains distance d (segment i runs from point i to point i+1) */
function segmentAt(f: Flight, d: number): number {
  const n = f.cum.length - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (f.cum[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, Math.min(n - 1, lo));
}

/** The speed multiplier at distance d along the flight */
export function speedAt(f: Flight, d: number): number {
  return f.sp[segmentAt(f, d)] ?? 1;
}

/** Position (tile coordinates), altitude (0..1) and heading (unit vector) at distance d along the flight */
export function flightAt(f: Flight, d: number): { x: number; y: number; z: number; dx: number; dy: number } {
  const i = segmentAt(f, Math.max(0, Math.min(f.dist, d)));
  const a = i * 3;
  const b = a + 3;
  const len = f.cum[i + 1] - f.cum[i];
  const k = len > 1e-9 ? Math.max(0, Math.min(1, (d - f.cum[i]) / len)) : 0;
  const x0 = f.pts[a];
  const y0 = f.pts[a + 1];
  const x1 = f.pts[b];
  const y1 = f.pts[b + 1];
  const dx = len > 1e-9 ? (x1 - x0) / len : 1;
  const dy = len > 1e-9 ? (y1 - y0) / len : 0;
  return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, z: f.pts[a + 2] + (f.pts[b + 2] - f.pts[a + 2]) * k, dx, dy };
}

/** The heading at the end of the flight (an aircraft that has parked keeps facing this way) */
export function endHeading(f: Flight): { dx: number; dy: number } {
  const e = flightAt(f, f.dist);
  return { dx: e.dx, dy: e.dy };
}

/** The old flights (a straight line with a climb and a descent of 12 tiles) are turned into polylines when an old save is loaded */
export function straightFlight(x0: number, y0: number, x1: number, y1: number, climb = 12): Flight {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const dx = dist > 0 ? (x1 - x0) / dist : 1;
  const dy = dist > 0 ? (y1 - y0) / dist : 0;
  const c = Math.min(climb, dist / 2);
  const pts: FlightPoint[] = [{ x: x0, y: y0, z: 0 }];
  if (c > 0 && dist > 2 * c) pts.push({ x: x0 + dx * c, y: y0 + dy * c, z: 1 }, { x: x1 - dx * c, y: y1 - dy * c, z: 1 });
  else if (dist > 0) pts.push({ x: x0 + dx * c, y: y0 + dy * c, z: Math.min(1, c / climb) });
  pts.push({ x: x1, y: y1, z: 0 });
  return buildFlight(pts);
}
