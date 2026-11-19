import { CONN, DX, DY, OUT, opposite } from './directions';
import type { GameMap } from './gameMap';
import { POP_PER_LEVEL, popMul } from './town';
import { removeAirport } from './airports';
import { disconnectRail } from './rails';
import { crossingOk } from './tileRules';
import { removeSpansAround } from './spans';
import { fillerAnchorOffset } from './buildings';
import { FACILITY_TILE, facilityAt, removeFacility } from './facilities';

export const hasRoad = (map: GameMap, x: number, y: number) => map.inBounds(x, y) && map.road.get(map.idx(x, y)) !== 0;

/** (x,y) から方向 d へ道路をつなげられるか(両タイルが陸・同じ高さ・建物なし) */
export function canConnect(map: GameMap, x: number, y: number, d: number, slope = false): boolean {
  const nx = x + DX[d];
  const ny = y + DY[d];
  if (!map.inBounds(x, y) || !map.inBounds(nx, ny)) return false;
  const lv = map.levelAt(x, y);
  const nl = map.levelAt(nx, ny);
  if (lv === 0 || nl === 0 || (lv !== nl && !(slope && Math.abs(lv - nl) === 1))) return false;
  const a = map.idx(x, y);
  const b = map.idx(nx, ny);
  if (map.span.get(a) || map.span.get(b)) return false;
  if (map.building.get(a) || map.building.get(b) || map.air.get(a) || map.air.get(b)) return false;
  // 線路との踏切は直線かつ直交のときのみ
  return crossingOk(map.road.get(a) | CONN(d), map.rail.get(a)) && crossingOk(map.road.get(b) | CONN(opposite(d)), map.rail.get(b));
}

/**
 * (x,y)→d の辺を敷設する。oneway=true なら (x,y) から d 方向への一方通行。
 * 既存の辺は上書き(双方向⇄一方通行の切替にも使う)。
 */
export function connect(map: GameMap, x: number, y: number, d: number, oneway: boolean, slope = false): boolean {
  if (!canConnect(map, x, y, d, slope)) return false;
  const nx = x + DX[d];
  const ny = y + DY[d];
  const a = map.idx(x, y);
  const b = map.idx(nx, ny);
  const od = opposite(d);
  map.road.set(a, map.road.get(a) | (CONN(d) | OUT(d)));
  map.road.set(b, map.road.get(b) | (CONN(od)));
  if (oneway) map.road.set(b, map.road.get(b) & (~OUT(od)));
  else map.road.set(b, map.road.get(b) | (OUT(od)));
  map.touch(x, y);
  map.touch(nx, ny);
  return true;
}

/** 既存の辺を双方向に戻す(辺がなければ何もしない) */
export function makeTwoWay(map: GameMap, x: number, y: number, d: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const nx = x + DX[d];
  const ny = y + DY[d];
  if (!map.inBounds(nx, ny)) return false;
  const a = map.idx(x, y);
  const b = map.idx(nx, ny);
  if (!(map.road.get(a) & CONN(d))) return false;
  map.road.set(a, map.road.get(a) | (OUT(d)));
  map.road.set(b, map.road.get(b) | (OUT(opposite(d))));
  map.touch(x, y);
  map.touch(nx, ny);
  return true;
}

/** 辺を撤去 */
export function disconnect(map: GameMap, x: number, y: number, d: number): void {
  const nx = x + DX[d];
  const ny = y + DY[d];
  if (!map.inBounds(x, y)) return;
  map.road.set(map.idx(x, y), map.road.get(map.idx(x, y)) & (~(CONN(d) | OUT(d))));
  if (map.inBounds(nx, ny)) {
    map.road.set(map.idx(nx, ny), map.road.get(map.idx(nx, ny)) & (~(CONN(opposite(d)) | OUT(opposite(d)))));
    map.touch(nx, ny);
  }
  map.touch(x, y);
}

/** 建物を撤去(街の人口も更新) */
export function removeBuilding(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  let i = map.idx(x, y);
  let b = map.building.get(i);
  if (!b) return false;
  if (b === FACILITY_TILE) {
    const f = facilityAt(map, x, y);
    if (f && f.owner === 'public') return false; // 市役所・学校などの公共施設は撤去できない
    if (f) removeFacility(map, f);
    return !!f;
  }
  if ((b & 3) === 0) {
    // 2x2 建物の付属タイル: アンカーを探して建物ごと撤去
    const [ax, ay] = fillerAnchorOffset(b);
    x += ax;
    y += ay;
    if (!map.inBounds(x, y)) return false;
    i = map.idx(x, y);
    b = map.building.get(i);
    if ((b & 3) !== 3) return false;
  }
  const town = map.towns[map.owner.get(i) - 1];
  if (town) {
    town.pop -= POP_PER_LEVEL[b & 3] * popMul(town);
    town.houses--;
  }
  const clear = (cx: number, cy: number) => {
    if (!map.inBounds(cx, cy)) return;
    const k = map.idx(cx, cy);
    map.building.set(k, 0);
    map.owner.set(k, 0);
    map.touch(cx, cy);
  };
  clear(x, y);
  if ((b & 3) === 3) {
    clear(x - 1, y);
    clear(x, y - 1);
    clear(x - 1, y - 1);
  }
  return true;
}

/** ブルドーザー: タイルの道路と建物を撤去 */
export function bulldoze(map: GameMap, x: number, y: number): void {
  if (!map.inBounds(x, y)) return;
  removeSpansAround(map, x, y);
  for (let d = 0; d < 4; d++) disconnect(map, x, y, d);
  for (let d = 0; d < 8; d++) disconnectRail(map, x, y, d);
  removeBuilding(map, x, y);
  removeAirport(map, x, y);
}

/** 始点→終点を軸に揃えた直線のタイル列 */
export function lineTiles(x0: number, y0: number, x1: number, y1: number): { x: number; y: number; d: number }[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const n = horizontal ? Math.abs(dx) : Math.abs(dy);
  const d = horizontal ? (dx >= 0 ? 1 : 3) : dy >= 0 ? 2 : 0;
  const out: { x: number; y: number; d: number }[] = [];
  for (let i = 0; i <= n; i++) out.push({ x: x0 + DX[d] * i, y: y0 + DY[d] * i, d });
  return out;
}
