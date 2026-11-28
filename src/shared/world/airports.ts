import type { GameMap } from './gameMap';
import { AIR, type AirportAxis, type AirportSize, airportFootprint, buildLayout, isTaxiable } from './airportLayout';

/** The footprint of the old airport (a single 3x3 size), which still exists in old saves */
export const LEGACY_AIRPORT_W = 3;
export const LEGACY_AIRPORT_H = 3;

/** Whether an airport can be placed with (x,y) at the top left: the whole footprint must be flat, dry and empty */
export function canPlaceAirport(map: GameMap, x: number, y: number, size: AirportSize = 'S', axis: AirportAxis = 'x'): boolean {
  const { w, h } = airportFootprint(size, axis);
  if (!map.inBounds(x, y) || !map.inBounds(x + w - 1, y + h - 1)) return false;
  const lv = map.levelAt(x, y);
  if (lv === 0) return false;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = map.idx(x + i, y + j);
      if (map.levelAt(x + i, y + j) !== lv || map.road.get(k) || map.rail.get(k) || map.building.get(k) || map.air.get(k) || map.span.get(k)) return false;
    }
  }
  return true;
}

/** Place it. Returns the coordinates of the terminal tile (the stop), or null if it cannot be placed */
export function placeAirport(map: GameMap, x: number, y: number, size: AirportSize = 'S', axis: AirportAxis = 'x'): { x: number; y: number } | null {
  if (!canPlaceAirport(map, x, y, size, axis)) return null;
  const { w, h, codes } = buildLayout(size, axis);
  let terminal: { x: number; y: number } | null = null;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const code = codes[j * w + i];
      map.air.set(map.idx(x + i, y + j), code);
      if (code === AIR.TERMINAL) terminal = { x: x + i, y: y + j };
      map.touch(x + i, y + j);
    }
  }
  map.airVer++;
  return terminal;
}

/** Remove the whole airport (connected airport tiles) */
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
  map.airVer++;
}

/** From any tile of an airport, find the terminal (the stop tile). Looks over the whole connected airport */
export function findTerminal(map: GameMap, x: number, y: number): { x: number; y: number } | null {
  if (!map.inBounds(x, y) || !map.air.get(map.idx(x, y))) return null;
  const a = airportAt(map, map.idx(x, y));
  if (!a || a.terminal < 0) return null;
  return { x: a.terminal % map.size, y: Math.floor(a.terminal / map.size) };
}

// ---------------------------------------------------------------- What an airport is (worked out from its tiles)

/** One runway: its tiles in order along its direction, from one end to the other */
export interface Runway {
  /** Tile indices from end A to end B (a straight line) */
  tiles: number[];
  /** Direction of the line: 'x' = east-west, 'y' = north-south */
  axis: 'x' | 'y';
  /** Tiles beside the runway that aircraft can use to get onto / off it (taxiway or apron) */
  access: number[];
}

export interface Airport {
  /** The smallest tile index of the airport (a stable name for it) */
  id: number;
  tiles: number[];
  /** Tile of the terminal that is the stop, or -1 */
  terminal: number;
  hangars: number[];
  stands: number[];
  runways: Runway[];
  /** 'S' / 'M' / 'L' / 'H' for the new airports, or 'legacy' for the old 3x3 airports (no stands: aircraft fly straight from the terminal) */
  size: AirportSize | 'legacy';
}

const STANDS_TO_SIZE: Record<number, AirportSize> = { 2: 'S', 8: 'M', 24: 'L', 60: 'H' };

interface Cache {
  ver: number;
  byTile: Map<number, Airport>;
}
const cache = new WeakMap<GameMap, Cache>();

/** The airport that has this tile (null if the tile is not an airport tile). Rebuilt when the airport tiles change (map.airVer) */
export function airportAt(map: GameMap, idx: number): Airport | null {
  let c = cache.get(map);
  if (!c || c.ver !== map.airVer) {
    c = { ver: map.airVer, byTile: new Map() };
    cache.set(map, c);
  }
  const hit = c.byTile.get(idx);
  if (hit) return hit;
  if (!map.air.get(idx)) return null;
  const a = analyse(map, idx);
  for (const t of a.tiles) c.byTile.set(t, a);
  return a;
}

function analyse(map: GameMap, start: number): Airport {
  const s = map.size;
  const seen = new Set<number>([start]);
  const tiles: number[] = [];
  const stack = [start];
  while (stack.length) {
    const k = stack.pop()!;
    tiles.push(k);
    const x = k % s;
    const y = (k - x) / s;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (!map.inBounds(nx, ny)) continue;
      const n = map.idx(nx, ny);
      if (seen.has(n) || !map.air.get(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  tiles.sort((a, b) => a - b);
  let terminal = -1;
  const hangars: number[] = [];
  const stands: number[] = [];
  const runwayTiles = new Set<number>();
  for (const k of tiles) {
    const c = map.air.get(k);
    if (c === AIR.TERMINAL) terminal = k;
    else if (c === AIR.HANGAR) hangars.push(k);
    else if (c === AIR.STAND) stands.push(k);
    else if (c === AIR.RUNWAY) runwayTiles.add(k);
  }
  // Runways: straight lines of runway tiles
  const runways: Runway[] = [];
  const done = new Set<number>();
  for (const k of tiles) {
    if (!runwayTiles.has(k) || done.has(k)) continue;
    const x = k % s;
    const y = (k - x) / s;
    // The legacy 3-tile runway and the new ones are rows (axis x) or columns (axis y). Decide by which neighbour is also runway
    const alongX = runwayTiles.has(k + 1) || runwayTiles.has(k - 1);
    const line: number[] = [];
    let cx = x;
    let cy = y;
    if (alongX) while (runwayTiles.has(cy * s + cx - 1) && cx > 0) cx--;
    else while (runwayTiles.has((cy - 1) * s + cx) && cy > 0) cy--;
    while (map.inBounds(cx, cy) && runwayTiles.has(cy * s + cx)) {
      line.push(cy * s + cx);
      cx += alongX ? 1 : 0;
      cy += alongX ? 0 : 1;
    }
    for (const t of line) done.add(t);
    const access: number[] = [];
    for (const t of line) {
      const tx = t % s;
      const ty = (t - tx) / s;
      for (const [nx, ny] of alongX
        ? [
            [tx, ty - 1],
            [tx, ty + 1],
          ]
        : [
            [tx - 1, ty],
            [tx + 1, ty],
          ]) {
        if (map.inBounds(nx, ny) && isTaxiable(map.air.get(map.idx(nx, ny)))) access.push(map.idx(nx, ny));
      }
    }
    runways.push({ tiles: line, axis: alongX ? 'x' : 'y', access });
  }
  const size: Airport['size'] = stands.length === 0 ? 'legacy' : (STANDS_TO_SIZE[stands.length] ?? 'S');
  return { id: tiles[0], tiles, terminal, hangars, stands, runways, size };
}
