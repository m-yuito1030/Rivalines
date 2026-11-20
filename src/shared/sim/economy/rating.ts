import type { GameMap } from '../../world/gameMap';
import { DAY_TICKS, type Transit, WAIT_CAP } from '../network/transit';

/** 会社の評価: 0〜100 の点数と、その内訳(各 0〜1) */
export interface RatingParts {
  /** 街の人口のうち、運行中の停留所の集客圏に入っている割合 */
  coverage: number;
  /** 待ち人数の少なさ(停留所の待ち / 上限の半分) */
  waiting: number;
  /** 渋滞・停滞のなさ(停滞中の車両の割合) */
  flow: number;
  /** 定時性(時刻表の平均遅延) */
  punctual: number;
}
export interface RatingState {
  score: number;
  /** 最悪のため新規の開発ができない状態(ヒステリシスあり) */
  locked: boolean;
  parts: RatingParts;
}

export const RATING_START = 65;
/** この点数未満で「最悪」(開発不可)になり、LOCK_RELEASE 以上で解除される */
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

/** 運行中(車両のいる路線を通る)の停留所 */
export function activeStopIds(t: Transit): Set<number> {
  const routesWithVehicles = new Set(t.vehicles.map((v) => v.routeId));
  const out = new Set<number>();
  for (const r of t.routes.values()) {
    if (!routesWithVehicles.has(r.id)) continue;
    for (const o of r.orders) if (!o.pass && !t.stops.get(o.stopId)?.waypoint) out.add(o.stopId);
  }
  return out;
}

/** 現在の状況から評価の目標点(0〜100)と内訳を求める。運行がなければ null(中立) */
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
  // 時刻表の路線がなければ定時性は評価に入れない(重みを他へ配分)
  const target = 100 * (lateN ? 0.3 * coverage + 0.3 * waiting + 0.25 * flow + 0.15 * punctual : 0.35 * coverage + 0.35 * waiting + 0.3 * flow);
  return { target, parts: { coverage, waiting, flow, punctual } };
}

/** 評価を1回更新する(なだらかに目標へ近づける)。運行がない間は中立(60)へゆっくり戻る */
export function stepRating(r: RatingState, map: GameMap, t: Transit, creditPenalty = 0): void {
  const m = measureRating(map, t);
  // 資金がマイナスだと信用が落ちる(最大20点)
  const target = Math.max(0, (m ? m.target : 60) - creditPenalty);
  if (m) r.parts = m.parts;
  r.score = Math.max(0, Math.min(100, r.score * 0.85 + target * 0.15));
  if (r.score < LOCK_BELOW) r.locked = true;
  else if (r.score >= LOCK_RELEASE) r.locked = false;
}
