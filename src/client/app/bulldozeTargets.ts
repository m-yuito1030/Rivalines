import type { BulldozeKinds } from '../../shared/protocol';
import type { GameMap } from '../../shared/world/gameMap';
import type { Transit } from '../../shared/sim/network/transit';
import { FACILITY_TILE, facilityTileMap } from '../../shared/world/facilities';
import { tr } from '../i18n';

/**
 * 撤去の範囲の中に、お金や路線に関わるもの(駅・停留所・経由点・車両基地・施設・空港)がどれだけあるか。
 * 撤去を実行する前の確認の文に使う。道路・線路・信号・橋・街の建物だけなら空(確認しない)。
 * 数え方は、サーバーの撤去と同じ(自社のものだけ。他社のものは撤去されないので数えない)。
 */
export function bulldozeTargets(map: GameMap, transit: Transit, a: { x: number; y: number }, b: { x: number; y: number }, kinds: BulldozeKinds, me: number): string[] {
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
          const s = transit.stopAtTile(x, y, k);
          if (s && !s.waypoint && (!s.owner || s.owner === me)) stop++;
        }
      }
      if (kinds.waypoint) {
        const w = transit.stopAtTile(x, y, 'rail');
        if (w?.waypoint && (!w.owner || w.owner === me)) waypoint++;
      }
      if (kinds.depot) {
        const d = transit.depotAtTile(x, y);
        if (d && (!d.owner || d.owner === me)) depot++;
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
