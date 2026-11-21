import { SEA_LEVEL } from './constants';
import { DX, DY } from './directions';
import type { GameMap } from './gameMap';
import { canConnect, connect, hasRoad } from './roads';
import { SPRITE_VARIANTS, fillerOf, makeBuilding } from './buildings';
import { hospitalGrowth } from './hospital';
import { POP_PER_LEVEL, TIERS, popMul, townTier, type Town } from './town';

/** 決定論的な乱数(mulberry32)。状態を保存/復元できる */
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

/** 建物を置ける空き地か(陸・道路なし・建物なし) */
function isFree(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  return map.levelAt(x, y) > 0 && map.road.get(i) === 0 && map.building.get(i) === 0 && map.rail.get(i) === 0 && map.air.get(i) === 0;
}

export const GROWTH_BASE_TICKS = 150;
/** 道路タイル検索用(街の道路が数万になっても includes の総当たりにならないように) */
const roadSets = new WeakMap<Town, Set<number>>();
const roadSet = (t: Town): Set<number> => {
  let s = roadSets.get(t);
  if (!s || s.size !== t.roads.length) {
    s = new Set(t.roads);
    roadSets.set(t, s);
  }
  return s;
};

/** マップの広さで、生まれてよい街の最大段階(狭いマップに首都は入らない) */
export const maxTierFor = (size: number): number => (size < 512 ? 1 : size < 2048 ? 2 : size < 8192 ? 3 : 4);

/** 大きな街の予定地として十分な平地(中心と同じ高さ±1段の陸)が広がっているか */
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
      if (l > 0 && Math.abs(l - lv) <= (dx * dx + dy * dy < (rr * rr) / 4 ? 0 : 1)) ok++; // 中心側は同じ高さ(道と家は同じ高さにしか置けない)
    }
  }
  return ok >= n * 0.7;
}

/** 街どうしの最小間隔(広がりの合計の8割。狭いマップでは詰める) */
const spacing = (map: GameMap, a: number, b: number, base: number) => Math.min(Math.max(base, (TIERS[a].radius + TIERS[b].radius) * 0.8), map.size / 3);

/** 重みで段階を選ぶ */
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

/** 次の成長の時刻を決める。bonus: 病院などによる成長の速さの上乗せ(0.25 なら 25% 速い) */
export function scheduleNext(town: Town, now: number, rng: () => number, bonus = 0): void {
  const slow = 1 + town.houses / 150;
  const boost = (1 + Math.min(3, town.pax / 40)) * (1 + bonus); // 交通サービスで最大4倍速。病院でさらに速くなる
  town.nextGrowth = now + Math.round((GROWTH_BASE_TICKS * (0.6 + rng() * 0.8) * slow) / boost);
}

/** 街を設置する(中央に十字路 + 数軒)。成功したら Town を返す */
/** 街が生まれた直後(十字路と数軒ができたあと、人口を育てる前)に呼ばれる。市役所を先に置くのに使う */
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
  // 段階の最低人口まで一気に育てる(置ける場所がなくなったら諦める)
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

/** 街の道路に隣接する空き地へ建物を置く */
export interface PlaceOpts {
  /** 置いてよい場所(例: 運行中の停留所の集客圏) */
  filter?: (x: number, y: number) => boolean;
  /** 段階を指定(1〜3)。2x2 が確保できなければ 2 になる */
  level?: number;
}

export function tryPlaceHouse(map: GameMap, town: Town, rng: () => number, opts: PlaceOpts = {}): boolean {
  for (let tries = 0; tries < (opts.filter ? 60 : 12) && town.roads.length; tries++) {
    const ri = (rng() * town.roads.length) | 0;
    const idx = town.roads[ri];
    if (map.road.get(idx) === 0) {
      // 撤去された道路は抽選リストから除く
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
    const dist = Math.abs(x - town.x) + Math.abs(y - town.y);
    // 大都市ほど中心の高層域が広い
    const rs = TIERS[townTier(town)].radius / 10;
    const T = TIERS[townTier(town)];
    const maxLevel = Math.min(T.maxLevel, dist < 8 * rs ? 3 : dist < 20 * rs ? 2 : 1);
    // 低層が多く、高層は中心部にまれに
    const r = rng();
    let level = opts.level ?? Math.min(maxLevel, r < T.l1 ? 1 : r < T.l2 ? 2 : 3);
    // 中心ほどオフィス、外側は住宅
    const office = rng() < Math.max(0, T.office - dist / (22 * rs));
    const variant = (rng() * SPRITE_VARIANTS) | 0;
    let ax = x;
    let ay = y;
    if (level === 3) {
      // L は 2x2 の空き地が必要。(x,y) を角に含む4通りの配置を試し、置けなければ M にする
      const start = (rng() * 4) | 0;
      let found = false;
      for (let k = 0; k < 4 && !found; k++) {
        const o = (start + k) & 3;
        const bx = x - (o & 1); // ブロックの左上
        const by = y - (o >> 1);
        if ([0, 1, 2, 3].every((q) => isFree(map, bx + (q & 1), by + (q >> 1)) && map.levelAt(bx + (q & 1), by + (q >> 1)) === map.levelAt(rx, ry))) {
          ax = bx + 1;
          ay = by + 1;
          found = true;
        }
      }
      if (!found) level = 2;
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
    map.touch(ax, ay);
    return true;
  }
  return false;
}

/** 既存の道路タイルから側道を伸ばす */
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
    // 先が空き地でなければ中止(他の道路にぶつかるのは許容: 接続して終了)
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

/** 街を1段階成長させる */
export function growTown(map: GameMap, town: Town, now: number, rng: () => number): void {
  // 段階の上限に達したらそれ以上は成長しない(村は村、都市は都市のまま)
  if (town.pop < TIERS[townTier(town)].max && !tryPlaceHouse(map, town, rng)) tryExtendRoad(map, town, rng);
  scheduleNext(town, now, rng, hospitalGrowth(map, town).bonus);
}

/** 初期の街を配置する。数は面積に比例(最低2) */
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
      // 周囲7x7が同じ高さの陸(平坦地)
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

/** 巨大マップの街は、この一辺の区画ごとに決定論的に(近づいたとき)生まれる */
export const TOWN_REGION = 1024;

/** 区画 (rx,ry) の街を配置する。同じシードなら常に同じ街ができる(区画の発見順に依存しない) */
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
    // 大きな街は区画の縁から離して置く(隣の区画の街と重ならないように)
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
