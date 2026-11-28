import { FACILITY_TILE } from './facilities';
import type { GameMap } from './gameMap';
import { buildingLevel, isOffice } from './buildings';
import { POP_PER_LEVEL, TIERS, popMul, townTier, type District, type DistrictKind, type Town } from './town';

/** A news item about the towns (shown in the menu's town news). The sentence is made on the screen, from these facts */
export interface TownNews {
  id: number;
  tick: number;
  kind: 'plan' | 'start' | 'done' | 'pop';
  town: string;
  /** plan / start / done: the district's name and kind */
  name?: string;
  d?: DistrictKind;
  /** pop: the population passed */
  n?: number;
}
export type NewsSink = (e: Omit<TownNews, 'id' | 'tick'>) => void;

/**
 * How each kind of district looks and how it is built.
 * size: side of the rectangle. target: buildings to put up before it counts as finished. minTier: the smallest town tier that gets one.
 * ring: where it lies, as a share of the town's radius (the office district at the centre, housing complexes further out).
 */
export const DISTRICT_SPEC: Record<DistrictKind, { size: number; target: number; minTier: number; ring: [number, number] }> = {
  danchi: { size: 12, target: 8, minTier: 1, ring: [0.3, 0.8] },
  shop: { size: 10, target: 10, minTier: 1, ring: [0.05, 0.45] },
  office: { size: 14, target: 12, minTier: 2, ring: [0, 0.3] },
};
/** How many districts a town of each tier has when fully planned */
export const DISTRICTS_WANTED = [0, 2, 4, 7, 10] as const;
/** The order in which a town plans its districts (kinds its tier does not allow are skipped) */
const ORDER: DistrictKind[] = ['office', 'danchi', 'shop', 'danchi', 'shop', 'office', 'danchi', 'shop', 'office', 'danchi'];
/** Population marks announced in the news */
export const POP_MARKS = [1000, 5000, 10000, 30000, 100000, 300000] as const;

const PREFIX = ['青', '白', '緑', '朝', '夕', '星', '月', '霧', '桜', '松', '朱', '雲', '風', '光', '銀', '金', '深', '新', '大', '小', '東', '西', '南', '北'];
const SUFFIX: Record<DistrictKind, string[]> = {
  danchi: ['台団地', 'ヶ丘団地', 'が丘ハイツ', '園団地'],
  office: ['オフィス街', 'ビジネス街', 'ビジネスパーク'],
  shop: ['商店街', 'マーケット通り', '中央通り商店街'],
};

export const districtAt = (town: Town, x: number, y: number): District | undefined => town.districts?.find((d) => x >= d.x0 && x <= d.x1 && y >= d.y0 && y <= d.y1);

/** The look of the buildings in a district: the same few designs over and over (rows of the same apartment blocks) */
export function districtVariant(town: Town, d: District, pick: number): number {
  const base = (town.id * 13 + d.id * 7) % 25;
  return d.kind === 'danchi' ? base : (base + (pick % (d.kind === 'office' ? 2 : 3)) * 5) % 25;
}

const want = (town: Town): number => DISTRICTS_WANTED[townTier(town)];

/** Plan one more district for a town if it has fewer than its tier wants. Picks a developed spot in the right ring that does not overlap the others */
export function planDistrict(map: GameMap, town: Town, rng: () => number, news?: NewsSink, tick = 0): District | null {
  const districts = (town.districts ??= []);
  if (districts.length >= want(town) || !town.roads.length) return null;
  const tier = townTier(town);
  const kinds = ORDER.filter((k) => DISTRICT_SPEC[k].minTier <= tier);
  const kind = kinds[districts.length % kinds.length];
  const spec = DISTRICT_SPEC[kind];
  const R = TIERS[tier].radius;
  for (let t = 0; t < 40; t++) {
    const idx = town.roads[(rng() * town.roads.length) | 0];
    const cx = idx % map.size;
    const cy = Math.floor(idx / map.size);
    const dist = Math.hypot(cx - town.x, cy - town.y);
    if (dist < spec.ring[0] * R || dist > spec.ring[1] * R) continue;
    const half = spec.size >> 1;
    const x0 = cx - half;
    const y0 = cy - half;
    const x1 = x0 + spec.size - 1;
    const y1 = y0 + spec.size - 1;
    if (x0 < 1 || y0 < 1 || x1 >= map.size - 1 || y1 >= map.size - 1) continue;
    // Keep a gap of 2 tiles from the other districts
    if (districts.some((o) => x0 <= o.x1 + 2 && x1 >= o.x0 - 2 && y0 <= o.y1 + 2 && y1 >= o.y0 - 2)) continue;
    if (map.levelAt(cx, cy) <= 0) continue;
    // A developed spot: the town already has some roads inside
    let roads = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (map.road.get(map.idx(x, y))) roads++;
    if (roads < 8) continue;
    const name = `${PREFIX[(rng() * PREFIX.length) | 0]}${SUFFIX[kind][(rng() * SUFFIX[kind].length) | 0]}`;
    const d: District = { id: districts.reduce((m, o) => Math.max(m, o.id), 0) + 1, kind, name, x0, y0, x1, y1, state: 'planned', placed: 0 };
    districts.push(d);
    news?.({ kind: 'plan', town: town.name, name, d: kind });
    void tick;
    return d;
  }
  return null;
}

/** Called when a building has been put up under a district's rules: counts it, and reports the start and the finish */
export function noteBuilt(town: Town, d: District, news?: NewsSink): void {
  d.placed++;
  if (d.state === 'planned') {
    d.state = 'building';
    news?.({ kind: 'start', town: town.name, name: d.name, d: d.kind });
  }
  if (d.state === 'building' && d.placed >= DISTRICT_SPEC[d.kind].target) {
    d.state = 'done';
    news?.({ kind: 'done', town: town.name, name: d.name, d: d.kind });
  }
}

/** Whether a building does not fit its district (so it is a candidate for being rebuilt) */
const misfit = (kind: DistrictKind, building: number): boolean => {
  const lv = buildingLevel(building);
  const off = isOffice(building);
  // A shopping street only gives up offices (tall housing is left alone: pulling it down would shrink the town)
  return kind === 'danchi' ? lv < 3 || off : kind === 'office' ? !off || lv < 2 : off;
};

/**
 * Pull down one building of the town that does not fit the district (and holds no more people than maxPop), and take its people off the town's count.
 * Returns false if there is none.
 * Only the town's own houses and offices are touched: never a facility, a building under construction, or another company's property.
 */
export function demolishMisfit(map: GameMap, town: Town, d: District, rng: () => number, maxPop = Infinity): boolean {
  const cand: number[] = [];
  for (let y = d.y0; y <= d.y1; y++) {
    for (let x = d.x0; x <= d.x1; x++) {
      const i = map.idx(x, y);
      const b = map.building.get(i);
      if (!b || b === FACILITY_TILE || buildingLevel(b) === 0 || map.construction.get(i) || map.owner.get(i) !== town.id) continue;
      // Only a building whose people the new one makes up for: rebuilding must not shrink the town
      if (misfit(d.kind, b) && POP_PER_LEVEL[buildingLevel(b)] * popMul(town) <= maxPop) cand.push(i);
    }
  }
  if (!cand.length) return false;
  const i = cand[(rng() * cand.length) | 0];
  const b = map.building.get(i);
  const level = buildingLevel(b);
  const ax = i % map.size;
  const ay = Math.floor(i / map.size);
  map.building.set(i, 0);
  map.owner.set(i, 0);
  map.touch(ax, ay);
  if (level === 3) {
    // The anchor is the frontmost tile of the 2x2: the other three lie behind it
    for (const [ox, oy] of [
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const k = map.idx(ax - ox, ay - oy);
      map.building.set(k, 0);
      map.owner.set(k, 0);
      map.touch(ax - ox, ay - oy);
    }
  }
  town.pop = Math.max(0, town.pop - POP_PER_LEVEL[level] * popMul(town));
  town.houses = Math.max(0, town.houses - 1);
  return true;
}
