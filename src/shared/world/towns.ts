import { SEA_LEVEL } from './constants';
import { DX, DY } from './directions';
import type { GameMap } from './gameMap';
import { canConnect, connect, hasRoad } from './roads';
import { SPRITE_VARIANTS, fillerOf, makeBuilding } from './buildings';
import { hospitalGrowth } from './hospital';
import { POP_PER_LEVEL, TIERS, popMul, townTier, type District, type Town } from './town';
import { POP_MARKS, demolishMisfit, districtAt, districtVariant, noteBuilt, planDistrict, type NewsSink } from './districts';

/** Deterministic random numbers (mulberry32). The state can be saved and restored */
export interface Rng {
  (): number;
  getState(): number;
  setState(s: number): void;
}
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const f = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  f.getState = () => a;
  f.setState = (s) => {
    a = s >>> 0;
  };
  return f;
}

const PREFIX = ['青', '白', '緑', '朝', '夕', '星', '月', '霧', '桜', '松', '朱', '雲', '風', '光', '銀', '金', '深', '新', '大', '小', '東', '西', '南', '北', '千', '八'];
const SUFFIX = ['原', '野', '崎', '浜', '台', '川', '丘', '橋', '里', '港', '沢', '見', '山', '島', '田'];

function townName(rng: () => number, used: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const n = PREFIX[(rng() * PREFIX.length) | 0] + SUFFIX[(rng() * SUFFIX.length) | 0];
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  return `街${used.size + 1}`;
}

/** Whether it is open ground where a building can go (land, no road, no building) */
function isFree(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  return map.levelAt(x, y) > 0 && map.road.get(i) === 0 && map.building.get(i) === 0 && map.rail.get(i) === 0 && map.air.get(i) === 0;
}

/** Baseline (ticks) for a town to grow by one building. The larger, the slower it grows */
export const GROWTH_BASE_TICKS = 600;
/** Days a building takes to construct (minimum to maximum; random within the range) */
export const BUILD_DAYS_MIN = 2;
export const BUILD_DAYS_MAX = 3;
/** For road tile lookups (so that a town with tens of thousands of road tiles does not turn into a brute-force includes) */
const roadSets = new WeakMap<Town, Set<number>>();
const roadSet = (t: Town): Set<number> => {
  let s = roadSets.get(t);
  if (!s || s.size !== t.roads.length) {
    s = new Set(t.roads);
    roadSets.set(t, s);
  }
  return s;
};

/** The largest tier a town may be born with, by map size (a narrow map cannot fit a capital) */
export const maxTierFor = (size: number): number => (size < 512 ? 1 : size < 2048 ? 2 : size < 8192 ? 3 : 4);

/** Whether enough flat land (land within one level of the centre's height) spreads out as the planned site of a big town */
function roomFor(map: GameMap, x: number, y: number, tier: number): boolean {
  if (tier === 0) return true;
  const rr = Math.min(36, Math.floor(TIERS[tier].radius * 0.6));
  const lv = map.levelAt(x, y);
  let ok = 0;
  let n = 0;
  for (let dy = -rr; dy <= rr; dy += 3) {
    for (let dx = -rr; dx <= rr; dx += 3) {
      if (dx * dx + dy * dy > rr * rr) continue;
      n++;
      const l = map.levelAt(x + dx, y + dy);
      if (l > 0 && Math.abs(l - lv) <= (dx * dx + dy * dy < (rr * rr) / 4 ? 0 : 1)) ok++; // near the centre, the same height (roads and houses can only be placed at the same height)
    }
  }
  return ok >= n * 0.7;
}

/** Minimum spacing between towns (80% of the sum of their extents; tighter on narrow maps) */
const spacing = (map: GameMap, a: number, b: number, base: number) => Math.min(Math.max(base, (TIERS[a].radius + TIERS[b].radius) * 0.8), map.size / 3);

/** Pick a tier by weight */
export function pickTier(rng: () => number, maxTier: number): number {
  let total = 0;
  for (let i = 0; i <= maxTier; i++) total += TIERS[i].weight;
  let r = rng() * total;
  for (let i = 0; i <= maxTier; i++) {
    r -= TIERS[i].weight;
    if (r < 0) return i;
  }
  return 0;
}

/** Decide the time of the next growth. bonus: extra growth speed from hospitals, etc. (0.25 means 25% faster) */
export function scheduleNext(town: Town, now: number, rng: () => number, bonus = 0): void {
  const slow = 1 + town.houses / 150;
  const boost = (1 + Math.min(3, town.pax / 40)) * (1 + bonus); // up to 4x faster with transit service. Hospitals make it faster still
  town.nextGrowth = now + Math.round((GROWTH_BASE_TICKS * (0.6 + rng() * 0.8) * slow) / boost);
}

/** Place a town (a crossroads in the middle + a few houses). Returns the Town on success */
/** Called right after a town is born (after the crossroads and a few houses, before the population is grown). Used to place the town hall first */
export type FoundHook = (town: Town) => void;

function foundTown(map: GameMap, x: number, y: number, used: Set<string>, rng: () => number, tier = 0, hook?: FoundHook): Town {
  const town: Town = {
    id: map.towns.length + 1,
    name: townName(rng, used),
    x,
    y,
    pop: 0,
    houses: 0,
    roads: [],
    nextGrowth: 0,
    pax: 0,
    tier,
  };
  map.towns.push(town);
  for (let d = 0; d < 4; d++) {
    let cx = x;
    let cy = y;
    for (let i = 0; i < 4; i++) {
      if (!connect(map, cx, cy, d, false)) break;
      cx += DX[d];
      cy += DY[d];
      addRoadTile(map, town, cx, cy);
    }
  }
  addRoadTile(map, town, x, y);
  for (let i = 0; i < 4; i++) tryPlaceHouse(map, town, rng);
  hook?.(town);
  // Grow it all at once up to the tier's minimum population (give up if there is no place left)
  const want = TIERS[tier].min;
  for (let it = 0, stall = 0; town.pop < want && it < Math.min(40000, want) && stall < 600; it++) {
    if (tryPlaceHouse(map, town, rng)) stall = 0;
    else {
      stall++;
      tryExtendRoad(map, town, rng);
    }
  }
  return town;
}

function addRoadTile(map: GameMap, town: Town, x: number, y: number): void {
  const i = map.idx(x, y);
  const set = roadSet(town);
  if (!set.has(i)) {
    set.add(i);
    town.roads.push(i);
  }
}

/** Place a building on open ground next to the town's roads */
export interface PlaceOpts {
  /** Places where building is allowed (e.g. the catchment of an operating stop) */
  filter?: (x: number, y: number) => boolean;
  /** Specify the tier (1-3). If a 2x2 cannot be secured, it becomes 2 */
  level?: number;
  /** Place it as under construction (finishes in 2-3 days). now = the current tick, ticksPerDay = ticks in a day */
  site?: { now: number; ticksPerDay: number };
  /** Build only inside this district, by its rules (redevelopment and the filling of a district) */
  district?: District;
  /** Where the news of a district that starts or finishes goes */
  news?: NewsSink;
}

export function tryPlaceHouse(map: GameMap, town: Town, rng: () => number, opts: PlaceOpts = {}): boolean {
  for (let tries = 0; tries < (opts.filter || opts.district ? 60 : 12) && town.roads.length; tries++) {
    const ri = (rng() * town.roads.length) | 0;
    const idx = town.roads[ri];
    if (map.road.get(idx) === 0) {
      // Demolished roads are dropped from the picking list
      town.roads[ri] = town.roads[town.roads.length - 1];
      town.roads.pop();
      continue;
    }
    const rx = idx % map.size;
    const ry = Math.floor(idx / map.size);
    const d = (rng() * 4) | 0;
    const x = rx + DX[d];
    const y = ry + DY[d];
    if (!isFree(map, x, y) || map.levelAt(x, y) !== map.levelAt(rx, ry)) continue;
    if (opts.filter && !opts.filter(x, y)) continue;
    const dis = districtAt(town, x, y);
    if (opts.district && dis !== opts.district) continue;
    const dist = Math.abs(x - town.x) + Math.abs(y - town.y);
    // The bigger the city, the wider its high-rise area at the centre
    const rs = TIERS[townTier(town)].radius / 10;
    const T = TIERS[townTier(town)];
    const maxLevel = Math.min(T.maxLevel, dist < 8 * rs ? 3 : dist < 20 * rs ? 2 : 1);
    // Mostly low-rise, with high-rise rarely, near the centre
    const r = rng();
    let level = opts.level ?? Math.min(maxLevel, r < T.l1 ? 1 : r < T.l2 ? 2 : 3);
    // More offices toward the centre, houses toward the outside
    let office = rng() < Math.max(0, T.office - dist / (22 * rs));
    let variant = (rng() * SPRITE_VARIANTS) | 0;
    if (dis && opts.level === undefined) {
      // Inside a district the buildings follow its character: the same big blocks, offices, or small shops
      office = dis.kind === 'office';
      level = dis.kind === 'danchi' ? 3 : dis.kind === 'office' ? (rng() < 0.6 ? 3 : 2) : rng() < 0.8 ? 1 : 2;
      variant = districtVariant(town, dis, (rng() * 1000) | 0);
    }
    let ax = x;
    let ay = y;
    if (level === 3) {
      // L needs a 2x2 open site. Try the four placements that include (x,y) at a corner, and fall back to M if none fits
      const start = (rng() * 4) | 0;
      let found = false;
      for (let k = 0; k < 4 && !found; k++) {
        const o = (start + k) & 3;
        const bx = x - (o & 1); // top-left of the block
        const by = y - (o >> 1);
        if ([0, 1, 2, 3].every((q) => isFree(map, bx + (q & 1), by + (q >> 1)) && map.levelAt(bx + (q & 1), by + (q >> 1)) === map.levelAt(rx, ry))) {
          ax = bx + 1;
          ay = by + 1;
          found = true;
        }
      }
      if (!found) {
        if (dis?.kind === 'danchi' && opts.level === undefined) continue; // a housing complex is only big blocks: look for another place
        level = 2;
      }
    }
    const i = map.idx(ax, ay);
    map.building.set(i, makeBuilding(level, variant, office));
    map.owner.set(i, town.id);
    if (level === 3) {
      for (const [ox, oy] of [
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const k = map.idx(ax - ox, ay - oy);
        map.building.set(k, fillerOf(ox, oy));
        map.owner.set(k, town.id);
        map.touch(ax - ox, ay - oy);
      }
    }
    town.pop += POP_PER_LEVEL[level] * popMul(town);
    town.houses++;
    if (opts.site) {
      map.construction.set(i, 1);
      map.sites.set(i, opts.site.now + Math.round(opts.site.ticksPerDay * (BUILD_DAYS_MIN + rng() * (BUILD_DAYS_MAX - BUILD_DAYS_MIN))));
    }
    map.touch(ax, ay);
    if (dis && dis.state !== 'done') noteBuilt(town, dis, opts.news);
    return true;
  }
  return false;
}

/** Extend a side road from an existing road tile */
function tryExtendRoad(map: GameMap, town: Town, rng: () => number): boolean {
  if (town.roads.length >= TIERS[townTier(town)].roads) return false;
  for (let tries = 0; tries < 12 && town.roads.length; tries++) {
    const idx = town.roads[(rng() * town.roads.length) | 0];
    const road = map.road.get(idx);
    if (road === 0) continue;
    const d = (rng() * 4) | 0;
    if (road & (1 << d)) continue;
    let x = idx % map.size;
    let y = Math.floor(idx / map.size);
    const len = 3 + ((rng() * 5) | 0);
    // Stop if the end is not open ground (running into another road is allowed: connect and finish)
    let built = 0;
    for (let i = 0; i < len; i++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (!canConnect(map, x, y, d)) break;
      const hit = hasRoad(map, nx, ny);
      connect(map, x, y, d, false);
      x = nx;
      y = ny;
      built++;
      if (!hit) addRoadTile(map, town, x, y);
      else break;
    }
    if (built > 0) return true;
  }
  return false;
}

/**
 * Districts: now and then the town plans a new one, and the district being redeveloped gets one more step (an old building that does not fit is
 * pulled down and a new one goes up, under construction). Also reports the population marks the town passes.
 */
function developDistricts(map: GameMap, town: Town, rng: () => number, site: PlaceOpts['site'], news?: NewsSink): void {
  town.districts ??= [];
  if (rng() < 0.15) planDistrict(map, town, rng, news);
  const active = town.districts.find((d) => d.state !== 'done');
  // Rebuilding may push a town a little past its tier's population limit (a big block holds more people than the houses it replaces)
  if (active && town.pop < TIERS[townTier(town)].max * 1.05 && rng() < 0.6) {
    demolishMisfit(map, town, active, rng);
    tryPlaceHouse(map, town, rng, { district: active, site, news });
  }
  if (town.milestone === undefined) town.milestone = POP_MARKS.filter((m) => town.pop >= m).length; // the marks it was born past are not news
  while (town.milestone < POP_MARKS.length && town.pop >= POP_MARKS[town.milestone]) news?.({ kind: 'pop', town: town.name, n: POP_MARKS[town.milestone++] });
}

/** Grow a town by one step */
export function growTown(map: GameMap, town: Town, now: number, rng: () => number, ticksPerDay = 0, news?: NewsSink): void {
  // Once the tier's limit is reached it does not grow any more (a village stays a village, a city stays a city). If ticksPerDay is passed, buildings start under construction
  const site = ticksPerDay ? { now, ticksPerDay } : undefined;
  const T = TIERS[townTier(town)];
  if (town.pop < T.max && !tryPlaceHouse(map, town, rng, { site, news })) tryExtendRoad(map, town, rng);
  developDistricts(map, town, rng, site, news);
  scheduleNext(town, now, rng, hospitalGrowth(map, town).bonus);
}

/** Place the initial towns. The count is proportional to the area (at least 2) */
export function placeTowns(map: GameMap, rng: () => number, hook?: FoundHook): void {
  const count = Math.max(2, Math.round((map.size * map.size) / 150000));
  const minDist = Math.max(24, map.size / 24);
  const used = new Set<string>();
  const maxTier = maxTierFor(map.size);
  for (let n = 0; n < count; n++) {
    const tier = pickTier(rng, maxTier);
    const edge = Math.min(Math.max(8, Math.floor(TIERS[tier].radius * 0.6)), Math.floor(map.size / 6));
    for (let attempt = 0; attempt < 4000; attempt++) {
      const x = edge + ((rng() * (map.size - 2 * edge)) | 0);
      const y = edge + ((rng() * (map.size - 2 * edge)) | 0);
      const h = map.heightAt(x, y);
      if (h <= SEA_LEVEL + 2 || h > SEA_LEVEL + 40) continue;
      if (map.towns.some((t) => Math.hypot(t.x - x, t.y - y) < spacing(map, townTier(t), tier, minDist))) continue;
      // The surrounding 7x7 is land of the same height (flat ground)
      const lv = map.levelAt(x, y);
      let flat = true;
      for (let dy = -3; dy <= 3 && flat; dy++) for (let dx = -3; dx <= 3; dx++) if (map.levelAt(x + dx, y + dy) !== lv) flat = false;
      if (!flat || !roomFor(map, x, y, tier)) continue;
      const town = foundTown(map, x, y, used, rng, tier, hook);
      scheduleNext(town, 0, rng);
      break;
    }
  }
}

/** On a huge map, towns are born deterministically (when approached) per region of this side length */
export const TOWN_REGION = 1024;

/** Place the towns of region (rx,ry). The same seed always gives the same towns (independent of the order regions are discovered) */
export function placeTownsRegion(map: GameMap, rx: number, ry: number, hook?: FoundHook): number {
  const x0 = rx * TOWN_REGION;
  const y0 = ry * TOWN_REGION;
  const w = Math.min(TOWN_REGION, map.size - x0);
  const h = Math.min(TOWN_REGION, map.size - y0);
  if (w <= 16 || h <= 16) return 0;
  const rng = makeRng((map.seed ^ Math.imul(rx + 1, 0x9e3779b1) ^ Math.imul(ry + 1, 0x85ebca6b)) >>> 0);
  const count = Math.max(1, Math.round((w * h) / 150000));
  const used = new Set(map.towns.map((t) => t.name));
  const minDist = 40;
  const mine: Town[] = [];
  for (let n = 0; n < count; n++) {
    const tier = pickTier(rng, 4);
    // Place big towns away from the region's edge (so they do not overlap towns of the neighbouring region)
    const edge = Math.max(8, Math.floor(TIERS[tier].radius * 0.6));
    if (w <= 2 * edge + 16 || h <= 2 * edge + 16) continue;
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = x0 + edge + ((rng() * (w - 2 * edge)) | 0);
      const y = y0 + edge + ((rng() * (h - 2 * edge)) | 0);
      const hh = map.heightAt(x, y);
      if (hh <= SEA_LEVEL + 2 || hh > SEA_LEVEL + 40) continue;
      if (mine.some((t) => Math.hypot(t.x - x, t.y - y) < Math.max(minDist, (TIERS[townTier(t)].radius + TIERS[tier].radius) * 0.8))) continue;
      const lv = map.levelAt(x, y);
      let flat = true;
      for (let dy = -3; dy <= 3 && flat; dy++) for (let dx = -3; dx <= 3; dx++) if (map.levelAt(x + dx, y + dy) !== lv) flat = false;
      if (!flat || !roomFor(map, x, y, tier)) continue;
      const town = foundTown(map, x, y, used, rng, tier, hook);
      scheduleNext(town, 0, rng);
      mine.push(town);
      break;
    }
  }
  return mine.length;
}
