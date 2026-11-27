import { DX, DY } from '../../world/directions';
import { type FacilityType, SPRITE_TYPES, DESIGN_COUNT, facilityDims, placeFacility, planFacility } from '../../world/facilities';
import type { GameMap } from '../../world/gameMap';
import type { Transit } from '../network/transit';
import type { Rival } from '../economy/rivals';

/** Depending on town size, private department stores, hotels, and malls get built. They become listed properties owned by no company; buying one makes it the buyer's business asset (if no buyer comes before the deadline, it is demolished and the land is cleared) */
const RULES: { type: FacilityType; minPop: number; per: number }[] = [
  { type: 'department', minPop: 250, per: 600 },
  { type: 'hotel', minPop: 500, per: 900 },
  { type: 'mall', minPop: 800, per: 1500 },
];

/** For each town, with a low probability, build a missing facility type along a road near the town centre */
export function spawnCityBusiness(map: GameMap, transit: Transit, rng: () => number, chance = 0.35, _rivals: Rival[] = []): number {
  let built = 0;
  for (const town of map.towns) {
    if (rng() >= chance) continue;
    for (const rule of RULES) {
      if (town.pop < rule.minPop) continue;
      const have = map.facilities.filter((f) => f.type === rule.type && Math.hypot(f.x0 - town.x, f.y0 - town.y) < 28).length;
      if (have >= Math.max(1, Math.floor(town.pop / rule.per))) continue; // there are already enough for the size
      for (let tries = 0; tries < 40; tries++) {
        const r = 3 + rng() * 11;
        const a = rng() * Math.PI * 2;
        const cx = Math.round(town.x + Math.cos(a) * r);
        const cy = Math.round(town.y + Math.sin(a) * r);
        // Department stores and malls use sprites. The size (S/M/L) depends on town size (smaller if L does not fit)
        const sprite = SPRITE_TYPES.includes(rule.type);
        const size = town.pop < 400 ? 'S' : town.pop < 1000 ? 'M' : 'L';
        const plan = planFacility(
          map,
          cx,
          cy,
          rule.type,
          (i) => !!transit.stopAtTile(i % map.size, Math.floor(i / map.size)) || !!transit.depotAtTile(i % map.size, Math.floor(i / map.size)),
          sprite ? facilityDims(rule.type, size) : undefined,
        );
        if (!plan.ok) continue;
        // Must face a road (a road just outside the edge of the site)
        const onStreet = plan.tiles.some(([x, y]) => [0, 1, 2, 3].some((d) => map.inBounds(x + DX[d], y + DY[d]) && map.road.get(map.idx(x + DX[d], y + DY[d])) !== 0));
        if (!onStreet) continue;
        // A listed property with no owner (the listing date is set at the next day close)
        const f = placeFacility(map, plan, rule.type, 'city');
        if (sprite) {
          f.size = size;
          f.design = Math.floor(rng() * (DESIGN_COUNT[rule.type] ?? 20));
        }
        built++;
        break;
      }
      break; // at most one per call
    }
  }
  return built;
}
