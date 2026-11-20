import { DX, DY } from '../world/directions';
import { type FacilityType, SPRITE_TYPES, DESIGN_COUNT, facilityDims, placeFacility, planFacility } from '../world/facilities';
import type { GameMap } from '../world/gameMap';
import type { Transit } from './transit';
import type { Rival } from './rivals';

/** 街の規模に応じて、民間(他社)の百貨店・ホテル・モールが建つ。買収すると自社の経営資源になる */
const RULES: { type: FacilityType; minPop: number; per: number }[] = [
  { type: 'department', minPop: 250, per: 600 },
  { type: 'hotel', minPop: 500, per: 900 },
  { type: 'mall', minPop: 800, per: 1500 },
];

/** 街ごとに低い確率で、足りない種類の施設を街の中心近くの道沿いに建てる */
export function spawnCityBusiness(map: GameMap, transit: Transit, rng: () => number, chance = 0.35, rivals: Rival[] = []): number {
  let built = 0;
  for (const town of map.towns) {
    if (rng() >= chance) continue;
    for (const rule of RULES) {
      if (town.pop < rule.minPop) continue;
      const have = map.facilities.filter((f) => f.type === rule.type && Math.hypot(f.x0 - town.x, f.y0 - town.y) < 28).length;
      if (have >= Math.max(1, Math.floor(town.pop / rule.per))) continue; // 規模に見合う数がすでにある
      for (let tries = 0; tries < 40; tries++) {
        const r = 3 + rng() * 11;
        const a = rng() * Math.PI * 2;
        const cx = Math.round(town.x + Math.cos(a) * r);
        const cy = Math.round(town.y + Math.sin(a) * r);
        // 百貨店・モールはスプライト。街の規模で大きさ(S/M/L)を決める(Lが置けなければ小さく)
        const sprite = SPRITE_TYPES.includes(rule.type);
        const size = town.pop < 400 ? 'S' : town.pop < 1000 ? 'M' : 'L';
        const plan = planFacility(map, cx, cy, rule.type, (i) => !!transit.stopAtTile(i % map.size, Math.floor(i / map.size)) || !!transit.depotAtTile(i % map.size, Math.floor(i / map.size)), sprite ? facilityDims(rule.type, size) : undefined);
        if (!plan.ok) continue;
        // 道路に面している(敷地の外周のすぐ外に道路がある)
        const onStreet = plan.tiles.some(([x, y]) => [0, 1, 2, 3].some((d) => map.inBounds(x + DX[d], y + DY[d]) && map.road.get(map.idx(x + DX[d], y + DY[d])) !== 0));
        if (!onStreet) continue;
        // 持ち主は競合会社のどれか(傘下に入っている会社が建てた施設は自社のもの)
        const owner = rivals.length ? rivals[Math.floor(rng() * rivals.length)] : undefined;
        const f = placeFacility(map, plan, rule.type, owner?.acquired ? 'player' : 'city');
        if (owner && !owner.acquired) f.ownerId = owner.id;
        if (sprite) {
          f.size = size;
          f.design = Math.floor(rng() * (DESIGN_COUNT[rule.type] ?? 20));
        }
        built++;
        break;
      }
      break; // 1回につき1軒まで
    }
  }
  return built;
}
