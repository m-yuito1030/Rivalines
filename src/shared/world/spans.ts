import { CONN, DX, DY, OUT, opposite } from './directions';
import type { GameMap } from './gameMap';
import { crossingOk } from './tileRules';
import { lineTiles } from './roads';

export const SPAN_BRIDGE = 16;
export const SPAN_TUNNEL = 32;
/** 橋・トンネルの最大長(中間タイル数) */
export const MAX_SPAN = 12;

export type SpanMode = 'road' | 'rail';
export interface SpanPlan {
  ok: boolean;
  kind?: 'bridge' | 'tunnel';
  reason?: string;
  /** 始点→終点の向き(0..3) */
  d: number;
  /** 始点、中間…、終点のタイル index */
  tiles: number[];
  level: number;
}

const fail = (reason: string, d = 0, tiles: number[] = [], level = 0): SpanPlan => ({ ok: false, reason, d, tiles, level });

/**
 * (x0,y0)→(x1,y1) の橋/トンネルを検討する。両端は同じ高さの陸(建物・空港なし)、
 * 中間は橋なら全て低い(水含む)、トンネルなら全て高い空きタイル。
 */
export function planSpan(map: GameMap, x0: number, y0: number, x1: number, y1: number, mode: SpanMode): SpanPlan {
  const line = lineTiles(x0, y0, x1, y1);
  const d = line[0] ? line[0].d : 0;
  const n = line.length - 1;
  if (n < 2) return fail('2タイル以上離してください', d);
  if (n > MAX_SPAN + 1) return fail(`長すぎます(最大${MAX_SPAN}タイル)`, d);
  if (line.some((t) => !map.inBounds(t.x, t.y))) return fail('範囲外です', d);
  const tiles = line.map((t) => map.idx(t.x, t.y));
  const a = tiles[0];
  const b = tiles[n];
  const L = map.levelAt(line[0].x, line[0].y);
  if (L === 0 || map.levelAt(line[n].x, line[n].y) !== L) return fail('両端は同じ高さの陸地にしてください', d, tiles);
  for (const k of [a, b]) {
    if (map.building.get(k) || map.air.get(k) || map.span.get(k)) return fail('端点に建物・空港・橋があります', d, tiles, L);
  }
  const od = opposite(d);
  const roadA = mode === 'road' ? map.road.get(a) | CONN(d) : map.road.get(a);
  const railA = mode === 'rail' ? map.rail.get(a) | CONN(d) : map.rail.get(a);
  const roadB = mode === 'road' ? map.road.get(b) | CONN(od) : map.road.get(b);
  const railB = mode === 'rail' ? map.rail.get(b) | CONN(od) : map.rail.get(b);
  if (!crossingOk(roadA, railA) || !crossingOk(roadB, railB)) return fail('端点で道路と線路が交差できません', d, tiles, L);
  let lower = 0;
  let higher = 0;
  for (let i = 1; i < n; i++) {
    const k = tiles[i];
    if (map.road.get(k) || map.rail.get(k) || map.building.get(k) || map.air.get(k) || map.span.get(k)) return fail('途中に道路・線路・建物があります', d, tiles, L);
    const lv = map.levelAt(line[i].x, line[i].y);
    if (lv < L) lower++;
    else if (lv > L) higher++;
    else return fail('途中に同じ高さのタイルがあります(通常の敷設を使ってください)', d, tiles, L);
  }
  if (lower && higher) return fail('橋とトンネルが混在しています', d, tiles, L);
  return { ok: true, kind: lower ? 'bridge' : 'tunnel', d, tiles, level: L };
}

export function buildSpan(map: GameMap, x0: number, y0: number, x1: number, y1: number, mode: SpanMode): SpanPlan {
  const plan = planSpan(map, x0, y0, x1, y1, mode);
  if (!plan.ok) return plan;
  const { d, tiles } = plan;
  const od = opposite(d);
  const n = tiles.length - 1;
  const flag = (plan.kind === 'bridge' ? SPAN_BRIDGE : SPAN_TUNNEL) | plan.level;
  const layer = mode === 'road' ? map.road : map.rail;
  const bit = (dir: number) => (mode === 'road' ? CONN(dir) | OUT(dir) : CONN(dir));
  layer.set(tiles[0], layer.get(tiles[0]) | bit(d));
  for (let i = 1; i < n; i++) {
    layer.set(tiles[i], layer.get(tiles[i]) | (bit(d) | bit(od)));
    map.span.set(tiles[i], flag);
  }
  layer.set(tiles[n], layer.get(tiles[n]) | bit(od));
  for (const k of tiles) map.touch(k % map.size, Math.floor(k / map.size));
  return plan;
}

/** (x,y) が橋/トンネルの中間タイルなら全体を撤去、端点なら隣接する橋/トンネルを撤去 */
export function removeSpansAround(map: GameMap, x: number, y: number): boolean {
  const i = map.idx(x, y);
  if (map.span.get(i)) return removeSpanChain(map, i);
  let any = false;
  for (let d = 0; d < 4; d++) {
    const nx = x + DX[d];
    const ny = y + DY[d];
    if (!map.inBounds(nx, ny)) continue;
    const k = map.idx(nx, ny);
    if (map.span.get(k) && (map.road.get(i) | map.rail.get(i)) & CONN(d)) any = removeSpanChain(map, k) || any;
  }
  return any;
}

function removeSpanChain(map: GameMap, start: number): boolean {
  const s = map.size;
  const chain = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const k = stack.pop()!;
    for (let d = 0; d < 4; d++) {
      const nx = (k % s) + DX[d];
      const ny = Math.floor(k / s) + DY[d];
      if (!map.inBounds(nx, ny)) continue;
      const nk = ny * s + nx;
      if (map.span.get(nk) && !chain.has(nk) && (map.road.get(k) | map.rail.get(k)) & CONN(d)) {
        chain.add(nk);
        stack.push(nk);
      }
    }
  }
  for (const k of chain) {
    for (let d = 0; d < 4; d++) {
      const nx = (k % s) + DX[d];
      const ny = Math.floor(k / s) + DY[d];
      if (!map.inBounds(nx, ny)) continue;
      const nk = ny * s + nx;
      if (chain.has(nk)) continue;
      const od = opposite(d);
      map.road.set(nk, map.road.get(nk) & ~(CONN(od) | OUT(od)));
      map.rail.set(nk, map.rail.get(nk) & ~CONN(od));
      map.touch(nx, ny);
    }
  }
  for (const k of chain) {
    map.road.set(k, 0);
    map.rail.set(k, 0);
    map.span.set(k, 0);
    map.touch(k % s, Math.floor(k / s));
  }
  return true;
}
