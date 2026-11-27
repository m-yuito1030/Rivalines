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

/** Whether a road can be connected from (x,y) in direction d (both tiles land of the same height with no buildings) */
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
  // A crossing with rail is allowed only when straight and perpendicular
  return crossingOk(map.road.get(a) | CONN(d), map.rail.get(a)) && crossingOk(map.road.get(b) | CONN(opposite(d)), map.rail.get(b));
}

/**
 * Lay the edge (x,y)->d. With oneway=true, one-way from (x,y) in direction d.
 * An existing edge is overwritten (also used to switch between two-way and one-way).
 */
export function connect(map: GameMap, x: number, y: number, d: number, oneway: boolean, slope = false): boolean {
  if (!canConnect(map, x, y, d, slope)) return false;
  const nx = x + DX[d];
  const ny = y + DY[d];
  const a = map.idx(x, y);
  const b = map.idx(nx, ny);
  const od = opposite(d);
  map.road.set(a, map.road.get(a) | (CONN(d) | OUT(d)));
  map.road.set(b, map.road.get(b) | CONN(od));
  if (oneway) map.road.set(b, map.road.get(b) & ~OUT(od));
  else map.road.set(b, map.road.get(b) | OUT(od));
  map.touch(x, y);
  map.touch(nx, ny);
  return true;
}

/** Turn an existing edge back into two-way (nothing if there is no edge) */
export function makeTwoWay(map: GameMap, x: number, y: number, d: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const nx = x + DX[d];
  const ny = y + DY[d];
  if (!map.inBounds(nx, ny)) return false;
  const a = map.idx(x, y);
  const b = map.idx(nx, ny);
  if (!(map.road.get(a) & CONN(d))) return false;
  map.road.set(a, map.road.get(a) | OUT(d));
  map.road.set(b, map.road.get(b) | OUT(opposite(d)));
  map.touch(x, y);
  map.touch(nx, ny);
  return true;
}

/** Remove an edge */
export function disconnect(map: GameMap, x: number, y: number, d: number): void {
  const nx = x + DX[d];
  const ny = y + DY[d];
  if (!map.inBounds(x, y)) return;
  map.road.set(map.idx(x, y), map.road.get(map.idx(x, y)) & ~(CONN(d) | OUT(d)));
  if (map.inBounds(nx, ny)) {
    map.road.set(map.idx(nx, ny), map.road.get(map.idx(nx, ny)) & ~(CONN(opposite(d)) | OUT(opposite(d))));
    map.touch(nx, ny);
  }
  map.touch(x, y);
}

/** Demolish a building (also updates the town's population) */
export function removeBuilding(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  let i = map.idx(x, y);
  let b = map.building.get(i);
  if (!b) return false;
  if (b === FACILITY_TILE) {
    const f = facilityAt(map, x, y);
    if (f && f.owner === 'public') return false; // public facilities such as town halls and schools cannot be demolished
    if (f) removeFacility(map, f);
    return !!f;
  }
  if ((b & 3) === 0) {
    // Attached tile of a 2x2 building: find the anchor and demolish the whole building
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
    map.construction.set(k, 0);
    map.sites.delete(k);
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

/** Bulldozer: remove a tile's road and building */
export function bulldoze(map: GameMap, x: number, y: number): void {
  if (!map.inBounds(x, y)) return;
  removeSpansAround(map, x, y);
  for (let d = 0; d < 4; d++) disconnect(map, x, y, d);
  for (let d = 0; d < 8; d++) disconnectRail(map, x, y, d);
  removeBuilding(map, x, y);
  removeAirport(map, x, y);
}

/** A straight tile list from start to end aligned to an axis */
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
