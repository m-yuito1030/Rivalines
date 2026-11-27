import type { GameMap } from '../../world/gameMap';
import { DAY_TICKS, type Transit, WAIT_CAP } from '../network/transit';

/** Company rating: a score of 0-100 and its breakdown (each 0-1) */
export interface RatingParts {
  /** Share of the towns' population that falls within the catchment of an operating stop */
  coverage: number;
  /** Few people waiting (waiting at stops / half the cap) */
  waiting: number;
  /** No congestion or stalls (share of stalled vehicles) */
  flow: number;
  /** Punctuality (average delay against the timetable) */
  punctual: number;
}
export interface RatingState {
  score: number;
  /** The worst state: no new development allowed (with hysteresis) */
  locked: boolean;
  parts: RatingParts;
}

export const RATING_START = 65;
/** Below this score the rating is "worst" (no development); it is lifted at LOCK_RELEASE and above */
export const LOCK_BELOW = 15;
export const LOCK_RELEASE = 25;
export const RATING_NAMES: [number, string][] = [
  [15, '最悪'],
  [35, '悪い'],
  [55, '普通'],
  [75, '良い'],
  [101, '優良'],
];
export const ratingName = (score: number): string => RATING_NAMES.find(([lim]) => score < lim)![1];

export const newRating = (): RatingState => ({ score: RATING_START, locked: false, parts: { coverage: 0, waiting: 1, flow: 1, punctual: 1 } });

/** Stops that are operating (served by a route that has vehicles) */
export function activeStopIds(t: Transit): Set<number> {
  const routesWithVehicles = new Set(t.vehicles.map((v) => v.routeId));
  const out = new Set<number>();
  for (const r of t.routes.values()) {
    if (!routesWithVehicles.has(r.id)) continue;
    for (const o of r.orders) if (!o.pass && !t.stops.get(o.stopId)?.waypoint) out.add(o.stopId);
  }
  return out;
}

/** From the current situation, work out the target score (0-100) and the breakdown. Null (neutral) if nothing operates */
export function measureRating(map: GameMap, t: Transit): { target: number; parts: RatingParts } | null {
  const active = activeStopIds(t);
  if (active.size === 0 || t.vehicles.length === 0) return null;
  const totalPop = map.towns.reduce((s, x) => s + x.pop, 0) || 1;
  let servedPop = 0;
  let waitFrac = 0;
  for (const id of active) {
    const s = t.stops.get(id);
    if (!s) continue;
    servedPop += s.pop;
    waitFrac += Math.min(1, s.waiting / (WAIT_CAP[s.kind] * 0.5));
  }
  const coverage = Math.min(1, servedPop / (totalPop * 0.6));
  const waiting = 1 - waitFrac / active.size;
  const stuck = t.vehicles.filter((v) => v.stuck > 20).length;
  const flow = Math.max(0, 1 - (stuck / t.vehicles.length) * 2);
  let lateSum = 0;
  let lateN = 0;
  for (const r of t.routes.values()) {
    if (r.orders.some((o) => o.kind === 'timed')) {
      lateSum += r.late;
      lateN++;
    }
  }
  const punctual = lateN ? Math.max(0, 1 - lateSum / lateN / (DAY_TICKS / 24)) : 1;
  // Without timetabled routes, punctuality is left out of the rating (its weight goes to the others)
  const target = 100 * (lateN ? 0.3 * coverage + 0.3 * waiting + 0.25 * flow + 0.15 * punctual : 0.35 * coverage + 0.35 * waiting + 0.3 * flow);
  return { target, parts: { coverage, waiting, flow, punctual } };
}

/** Update the rating once (approach the target gradually). While nothing operates, it drifts slowly back to neutral (60) */
export function stepRating(r: RatingState, map: GameMap, t: Transit, creditPenalty = 0): void {
  const m = measureRating(map, t);
  // Negative funds hurt credit (up to 20 points)
  const target = Math.max(0, (m ? m.target : 60) - creditPenalty);
  if (m) r.parts = m.parts;
  r.score = Math.max(0, Math.min(100, r.score * 0.85 + target * 0.15));
  if (r.score < LOCK_BELOW) r.locked = true;
  else if (r.score >= LOCK_RELEASE) r.locked = false;
}
