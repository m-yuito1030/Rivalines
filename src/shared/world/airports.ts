import type { GameMap } from './gameMap';

export const AIRPORT_W = 3;
export const AIRPORT_H = 3;

/** 3x3の小空港を (x,y) 左上として置けるか(平坦な空き地) */
export function canPlaceAirport(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y) || !map.inBounds(x + AIRPORT_W - 1, y + AIRPORT_H - 1)) return false;
  const lv = map.levelAt(x, y);
  if (lv === 0) return false;
  for (let j = 0; j < AIRPORT_H; j++) {
    for (let i = 0; i < AIRPORT_W; i++) {
      const k = map.idx(x + i, y + j);
      if (map.levelAt(x + i, y + j) !== lv || map.road.get(k) || map.rail.get(k) || map.building.get(k) || map.air.get(k)) return false;
    }
  }
  return true;
}

/** 配置。ターミナルタイルの座標を返す */
export function placeAirport(map: GameMap, x: number, y: number): { x: number; y: number } | null {
  if (!canPlaceAirport(map, x, y)) return null;
  for (let j = 0; j < AIRPORT_H; j++) {
    for (let i = 0; i < AIRPORT_W; i++) {
      // 上段=エプロン(中央はターミナル)、中段=エプロン、下段=滑走路
      map.air.set(map.idx(x + i, y + j), j === 2 ? 2 : j === 0 && i === 1 ? 3 : 1);
      map.touch(x + i, y + j);
    }
  }
  return { x: x + 1, y };
}

/** 空港全体(連結した空港タイル)を撤去 */
export function removeAirport(map: GameMap, x: number, y: number): void {
  if (!map.inBounds(x, y) || !map.air.get(map.idx(x, y))) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (!map.inBounds(cx, cy)) continue;
    const k = map.idx(cx, cy);
    if (!map.air.get(k)) continue;
    map.air.set(k, 0);
    map.touch(cx, cy);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

/** 空港の任意タイルからターミナル(値3)を探す */
export function findTerminal(map: GameMap, x: number, y: number): { x: number; y: number } | null {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (map.inBounds(x + dx, y + dy) && map.air.get(map.idx(x + dx, y + dy)) === 3) return { x: x + dx, y: y + dy };
    }
  }
  return null;
}
