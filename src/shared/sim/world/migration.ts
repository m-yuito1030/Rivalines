import { removeBuilding } from '../../world/roads';
import { DX, DY } from '../../world/directions';
import type { GameMap } from '../../world/gameMap';
import { tryPlaceHouse } from '../../world/towns';
import { activeStopIds } from '../economy/rating';
import type { Transit } from '../network/transit';
import { POP_PER_LEVEL, popMul } from '../../world/town';

/** 停留所の集客圏の半径(transit.ts の CATCH と同じ値) */
const RADIUS = { road: 4, rail: 6, air: 10 } as const;
/** 他の街への移住を考える距離(タイル) */
const NEIGHBOR_DIST = 60;

/** 運行中の停留所の集客圏。(x,y) がどれかに入っていれば「サービスのある地域」 */
export function servedAreas(t: Transit): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  for (const id of activeStopIds(t)) {
    const s = t.stops.get(id);
    if (s) out.push({ x: s.x, y: s.y, r: RADIUS[s.kind] });
  }
  return out;
}

const inAreas = (areas: { x: number; y: number; r: number }[], x: number, y: number) => areas.some((a) => Math.abs(a.x - x) <= a.r && Math.abs(a.y - y) <= a.r);

/**
 * 人口移動: バス・鉄道などが通り始めた地域へ、サービスのない地域から住民がちらほら移る。
 * 街ごとに低い確率で、サービス圏外の建物を1棟(同じ段階で)取り壊し、サービス圏内の空き地(同じ街、なければ近くの街)へ建て直す。
 * @returns 移住した人数
 */
export function migrateStep(map: GameMap, transit: Transit, rng: () => number, chance = 0.2): number {
  const areas = servedAreas(transit);
  if (!areas.length) return 0;
  const served = (x: number, y: number) => inAreas(areas, x, y);
  let moved = 0;
  for (const town of map.towns) {
    if (rng() >= chance || town.houses <= 4) continue;
    // 移住元: 街の道路に面した、サービス圏外の建物
    let src: { x: number; y: number; level: number } | null = null;
    for (let tries = 0; tries < 20 && !src && town.roads.length; tries++) {
      const ri = town.roads[(rng() * town.roads.length) | 0];
      const d = (rng() * 4) | 0;
      const x = (ri % map.size) + DX[d];
      const y = (Math.floor(ri / map.size)) + DY[d];
      if (!map.inBounds(x, y)) continue;
      const b = map.building.get(map.idx(x, y));
      const level = b & 3;
      if (level >= 1 && map.owner.get(map.idx(x, y)) === town.id && !served(x, y)) src = { x, y, level };
    }
    if (!src) continue;
    // 移住先: まず同じ街のサービス圏内、なければ近くの街(近い順)のサービス圏内
    const targets = [town, ...map.towns.filter((o) => o !== town && Math.hypot(o.x - town.x, o.y - town.y) < NEIGHBOR_DIST).sort((a, b) => Math.hypot(a.x - town.x, a.y - town.y) - Math.hypot(b.x - town.x, b.y - town.y))];
    const before = (t: { houses: number }) => t.houses;
    for (const dst of targets) {
      const h0 = before(dst);
      if (!tryPlaceHouse(map, dst, rng, { filter: served, level: src.level })) continue;
      if (before(dst) !== h0 + 1) continue;
      removeBuilding(map, src.x, src.y);
      moved += POP_PER_LEVEL[src.level] * popMul(town);
      break;
    }
  }
  return moved;
}
