import type { BulldozeKinds } from '../../shared/protocol';
import type { GameMap } from '../../shared/world/gameMap';
import type { Transit } from '../../shared/sim/network/transit';
import { FACILITY_TILE, facilityTileMap } from '../../shared/world/facilities';
import { isUnderTile } from '../../shared/world/subway';
import { tr } from '../i18n';

/**
 * How many things that involve money or routes (stations, stops, waypoints, depots, facilities, airports) are inside the demolition area.
 * Used for the confirmation text before demolishing. Empty (no confirmation) if it is only roads, rails, signals, bridges, and town buildings.
 * Counted the same way as the server's demolition (only the company's own; other companies' things are not demolished, so they are not counted).
 */
export function bulldozeTargets(
  map: GameMap,
  transit: Transit,
  a: { x: number; y: number },
  b: { x: number; y: number },
  kinds: BulldozeKinds,
  me: number,
  under = false,
): string[] {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const x1 = Math.min(map.size - 1, Math.max(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const y1 = Math.min(map.size - 1, Math.max(a.y, b.y));
  let stop = 0;
  let waypoint = 0;
  let depot = 0;
  let airport = 0;
  const facs = new Set<number>();
  const grid = kinds.building ? facilityTileMap(map) : null;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (kinds.stop) {
        for (const k of ['road', 'rail', 'air'] as const) {
          if (under && k !== 'rail') continue;
          const s = transit.stopAtTile(x, y, k);
          if (s && !s.waypoint && (!s.owner || s.owner === me) && (!under || isUnderTile(map, s.idx))) stop++;
        }
      }
      if (kinds.waypoint) {
        const w = transit.stopAtTile(x, y, 'rail');
        if (w?.waypoint && (!w.owner || w.owner === me)) waypoint++;
      }
      if (kinds.depot) {
        const d = transit.depotAtTile(x, y);
        if (d && (!d.owner || d.owner === me) && (!under || isUnderTile(map, d.idx))) depot++;
      }
      if (kinds.airport && map.air.get(map.idx(x, y))) airport++;
      if (grid && map.building.get(map.idx(x, y)) === FACILITY_TILE) {
        const f = grid.get(map.idx(x, y));
        if (f && f.owner !== 'public' && ((f.owner ?? 'player') !== 'player' || f.playerId === undefined || f.playerId === me)) facs.add(f.id);
      }
    }
  }
  const out: string[] = [];
  if (stop) out.push(`${tr('停留所・駅')}${stop}`);
  if (waypoint) out.push(`${tr('経由点')}${waypoint}`);
  if (depot) out.push(`${tr('基地')}${depot}`);
  if (facs.size) out.push(`${tr('施設')}${facs.size}`);
  if (airport) out.push(`${tr('空港')}${airport}`);
  return out;
}
