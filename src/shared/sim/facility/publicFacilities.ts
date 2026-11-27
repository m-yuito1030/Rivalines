import { TIERS, townTier } from '../../world/town';
import { DX, DY } from '../../world/directions';
import { FACILITY_SPECS, type Facility, type FacilityType, placeFacility, planFacility } from '../../world/facilities';
import type { GameMap } from '../../world/gameMap';
import type { Town } from '../../world/town';
import type { Transit } from '../network/transit';
import sightsJson from '../../data/sights.json';
import { type SightMeta, sightFits, sightLabel } from '../../data/sightTiers';

const sights = sightsJson as SightMeta[];
/** List of sightseeing designs allowed for each tier (village / town / city) */
const sightPool = [0, 1, 2].map((t) => sights.map((m, i) => (sightFits(m, t) ? i : -1)).filter((i) => i >= 0));
const pickSight = (town: Town, rng: () => number): number => {
  const pool = sightPool[Math.min(2, townTier(town))];
  return pool[Math.floor(rng() * pool.length)];
};

/** Minimum spacing between schools (tiles; the x or y distance must be at least this) */
export const SCHOOL_MIN_DISTANCE = 15;
/** Guideline for the number of schools: from population 150, one more school per 250 people */
export const schoolTarget = (pop: number): number => (pop >= 150 ? Math.floor(pop / 250) + 1 : 0);

const DIMS = { S: { w: 1, h: 1 }, M: { w: 1, h: 1 }, L: { w: 2, h: 2 } } as const;
type Size = 'S' | 'M' | 'L';

const cityhallSize = (pop: number): Size => (pop < 150 ? 'S' : pop < 500 ? 'M' : 'L');
const schoolSize = (pop: number, r: number): Size => (pop < 400 ? (r < 0.7 ? 'S' : 'M') : pop < 1200 ? (r < 0.3 ? 'S' : r < 0.8 ? 'M' : 'L') : r < 0.2 ? 'M' : 'L');

const center = (f: Facility) => ({ x: f.x0 + (f.w - 1) / 2, y: f.y0 + (f.h - 1) / 2 });

/** A school must be at least SCHOOL_MIN_DISTANCE tiles from other schools (in x or y) */
export function schoolSpacingOk(map: GameMap, x: number, y: number): boolean {
  return map.facilities.every((f) => {
    if (f.type !== 'school') return true;
    const c = center(f);
    return Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) >= SCHOOL_MIN_DISTANCE;
  });
}

/** Whether there is a road just outside the edge of the site */
function onStreet(map: GameMap, tiles: [number, number][]): boolean {
  return tiles.some(([x, y]) => [0, 1, 2, 3].some((d) => map.inBounds(x + DX[d], y + DY[d]) && map.road.get(map.idx(x + DX[d], y + DY[d])) !== 0));
}

function tryPlace(
  map: GameMap,
  transit: Transit,
  rng: () => number,
  town: Town,
  type: FacilityType,
  size: Size,
  rMin: number,
  rMax: number,
  tries: number,
  extra?: (x: number, y: number) => boolean,
): Facility | null {
  const occ = (i: number) => !!transit.stopAtTile(i % map.size, Math.floor(i / map.size)) || !!transit.depotAtTile(i % map.size, Math.floor(i / map.size));
  for (let t = 0; t < tries; t++) {
    const r = rMin + rng() * (rMax - rMin);
    const a = rng() * Math.PI * 2;
    const cx = Math.round(town.x + Math.cos(a) * r);
    const cy = Math.round(town.y + Math.sin(a) * r);
    const plan = planFacility(map, cx, cy, type, occ, DIMS[size]);
    if (!plan.ok || !onStreet(map, plan.tiles)) continue;
    if (extra && !extra(plan.x0 + (plan.w - 1) / 2, plan.y0 + (plan.h - 1) / 2)) continue;
    const f = placeFacility(map, plan, type, 'public');
    f.size = size;
    f.townId = town.id;
    f.design = type === 'school' ? Math.floor(rng() * 20) : Math.floor(rng() * 100);
    f.name = `${town.name}${FACILITY_SPECS[type].name}`;
    return f;
  }
  return null;
}

/** Number of sights (1-3): decided per town (deterministically from coordinates). Only villages, towns, and cities have them, not very large cities or capitals */
export const sightTarget = (town: Town): number => (townTier(town) <= 2 ? 1 + ((((Math.imul(town.x, 73856093) ^ Math.imul(town.y, 19349663)) >>> 0) >>> 3) % 3) : 0);
const sightSize = (town: Town, r: number): Size =>
  townTier(town) === 0 ? (r < 0.6 ? 'S' : 'M') : townTier(town) === 1 ? (r < 0.25 ? 'S' : r < 0.65 ? 'M' : 'L') : r < 0.2 ? 'M' : 'L';

/** Place the town hall first, right after a town is born (after the population has grown the town is full of buildings and it would not fit) */
export function placeTownHall(map: GameMap, town: Town, rng: () => number): boolean {
  const none = { stopAtTile: () => undefined, depotAtTile: () => undefined } as unknown as Transit;
  const sz = cityhallSize(TIERS[townTier(town)].min);
  const order: Size[] = sz === 'L' ? ['L', 'M', 'S'] : sz === 'M' ? ['M', 'S'] : ['S'];
  for (const s of order) if (tryPlace(map, none, rng, town, 'cityhall', s, 2, 9, 60)) return true;
  return false;
}

/**
 * Towns build public facilities automatically (players cannot build them).
 * Town hall: one per town (near the centre). Schools: any number depending on population, but at least 15 tiles apart.
 * @returns the number newly built
 */
export function placePublicFacilities(map: GameMap, transit: Transit, rng: () => number): number {
  let built = 0;
  for (const town of map.towns) {
    // Town hall (one per town. Tried every time until it fits. Made smaller if the site is too small)
    if (!map.facilities.some((f) => f.type === 'cityhall' && f.townId === town.id)) {
      const order: Size[] = cityhallSize(town.pop) === 'L' ? ['L', 'M', 'S'] : cityhallSize(town.pop) === 'M' ? ['M', 'S'] : ['S'];
      for (const sz of order) {
        const rs = TIERS[townTier(town)].radius / 10; // the bigger the town, the wider the search
        const f = tryPlace(map, transit, rng, town, 'cityhall', sz, 2, 9 * rs, 30 + 25 * townTier(town));
        if (f) {
          built++;
          break;
        }
      }
    }
    // Sights (1-3 in villages, towns, and cities. Added gradually if short. Near the edge of the town)
    const wantSights = sightTarget(town);
    // A look that does not suit the size (an old save or a change of tier) is replaced
    for (const f of map.facilities)
      if (f.type === 'sight' && f.townId === town.id && f.design !== undefined && !sightFits(sights[f.design], Math.min(2, townTier(town)))) {
        f.design = pickSight(town, rng);
        f.name = `${town.name}の${sightLabel(sights[f.design])}`;
        map.facilityVer++;
      }
    if (wantSights > 0 && rng() < 0.5 && map.facilities.filter((f) => f.type === 'sight' && f.townId === town.id).length < wantSights) {
      const rs = TIERS[townTier(town)].radius / 10;
      const sz = sightSize(town, rng());
      const order: Size[] = sz === 'L' ? ['L', 'M', 'S'] : sz === 'M' ? ['M', 'S'] : ['S'];
      for (const s of order) {
        const f = tryPlace(map, transit, rng, town, 'sight', s, 4, 14 * rs, 60 + 20 * townTier(town));
        if (f) {
          const d = pickSight(town, rng); // pick from types that suit the town size (shrine, hot spring, tower, ...)
          f.design = d;
          f.name = `${town.name}の${sightLabel(sights[d])}`;
          built++;
          break;
        }
      }
    }
    // Schools (one at a time if short. Thinned out by chance)
    const have = map.facilities.filter((f) => f.type === 'school' && f.townId === town.id).length;
    if (have < schoolTarget(town.pop) && rng() < 0.5) {
      const sz = schoolSize(town.pop, rng());
      const order: Size[] = sz === 'L' ? ['L', 'M', 'S'] : sz === 'M' ? ['M', 'S'] : ['S'];
      for (const s of order) {
        const rs = TIERS[townTier(town)].radius / 10;
        const f = tryPlace(map, transit, rng, town, 'school', s, 3, 18 * rs, 40 + 30 * townTier(town), (x, y) => schoolSpacingOk(map, x, y));
        if (f) {
          built++;
          break;
        }
      }
    }
  }
  return built;
}
