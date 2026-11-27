import type { GameMap } from './gameMap';
import { gradeCapMul, gradeOf, gradeUpkeepMul } from './facilityQuality';

/** Large facilities (stadiums, amusement parks, etc.). They raise passenger demand at nearby stops */
/** Facilities added later where the player picks the design and size (cinema, zoo, ski resort, beach, arena, convention centre, business hotel, university, golf course, hospital, station building) */
export const NEW_FACILITY_TYPES = ['cinema', 'zoo', 'ski', 'beach', 'arena', 'convention', 'bizhotel', 'campus', 'golf', 'hospital', 'stationmall'] as const;
export type NewFacilityType = (typeof NEW_FACILITY_TYPES)[number];
export type FacilityType = 'stadium' | 'amusement' | 'mall' | 'park' | 'department' | 'hotel' | 'school' | 'cityhall' | 'sight' | NewFacilityType;

export interface FacilitySpec {
  type: FacilityType;
  name: string;
  icon: string;
  /** Site (tiles) */
  w: number;
  h: number;
  /** Demand (people, converted to the population of a stop's catchment) */
  attract: number;
  /** Hours when people gather [start, end). Outside it is 15% */
  hours: [number, number];
  desc: string;
  /** Construction cost (yen), upkeep (per day), sales per visitor (yen), and the share of visitors who shop or otherwise spend */
  cost: number;
  upkeep: number;
  spend: number;
  conversion: number;
  /** Public facility (built automatically by towns. Players cannot build, demolish, or acquire it) */
  public?: boolean;
  /** When there are several busy periods: a list of [start, end) (used instead of hours). The coefficient outside is base */
  windows?: [number, number][];
  base?: number;
}

export const FACILITY_SPECS: Record<FacilityType, FacilitySpec> = {
  stadium: {
    type: 'stadium',
    name: 'スタジアム',
    icon: '🏟',
    w: 4,
    h: 4,
    attract: 1500,
    hours: [17, 22],
    desc: 'ナイターの時間帯(17〜22時)に大勢が来ます',
    cost: 6_000_000,
    upkeep: 40_000,
    spend: 1800,
    conversion: 0.5,
  },
  amusement: {
    type: 'amusement',
    name: '遊園地',
    icon: '🎡',
    w: 5,
    h: 5,
    attract: 2000,
    hours: [9, 19],
    desc: '日中(9〜19時)に家族連れが来ます',
    cost: 8_000_000,
    upkeep: 55_000,
    spend: 2400,
    conversion: 0.5,
  },
  mall: {
    type: 'mall',
    name: 'ショッピングモール',
    icon: '🏬',
    w: 2,
    h: 2,
    attract: 1200,
    hours: [10, 20],
    desc: '買い物客が日中から夜(10〜20時)に来ます',
    cost: 3_000_000,
    upkeep: 30_000,
    spend: 1200,
    conversion: 0.5,
  },
  park: {
    type: 'park',
    name: '公園',
    icon: '🌳',
    w: 3,
    h: 3,
    attract: 150,
    hours: [6, 18],
    desc: '日中、少しずつ人が訪れます(売上はありません)',
    cost: 500_000,
    upkeep: 3_000,
    spend: 0,
    conversion: 0,
  },
  department: {
    type: 'department',
    name: '百貨店',
    icon: '🏢',
    w: 2,
    h: 2,
    attract: 1500,
    hours: [10, 20],
    desc: '買い物客が10〜20時に来ます。駅前に置くと売上が大きい',
    cost: 5_000_000,
    upkeep: 35_000,
    spend: 2000,
    conversion: 0.5,
  },
  school: {
    type: 'school',
    name: '学校',
    icon: '🏫',
    w: 1,
    h: 1,
    attract: 1200,
    hours: [8, 9],
    windows: [
      [8, 9],
      [17, 18],
    ],
    base: 0.08,
    desc: '登校の8時台と下校の17時台に、周辺の駅・バス停の利用が大きく増えます',
    cost: 0,
    upkeep: 0,
    spend: 0,
    conversion: 0,
    public: true,
  },
  cityhall: {
    type: 'cityhall',
    name: '市役所',
    icon: '🏛',
    w: 1,
    h: 1,
    attract: 300,
    hours: [0, 24],
    desc: '一日中、一定の人が訪れます(1つの街に1つ)',
    cost: 0,
    upkeep: 0,
    spend: 0,
    conversion: 0,
    public: true,
  },
  sight: {
    type: 'sight',
    name: '観光地',
    icon: '⛩',
    w: 1,
    h: 1,
    attract: 1000,
    hours: [9, 17],
    windows: [[9, 17]],
    base: 0.02,
    desc: 'ご当地の観光地。日中(9〜17時)だけ観光客が周辺の駅・バス停を利用します(夜はほとんど来ません)。1つの市区町村に1〜3か所、自動で生まれます',
    cost: 0,
    upkeep: 0,
    spend: 0,
    conversion: 0,
    public: true,
  },
  hotel: {
    type: 'hotel',
    name: 'ホテル',
    icon: '🏨',
    w: 3,
    h: 3,
    attract: 600,
    hours: [0, 24],
    desc: '一日を通して宿泊客が訪れます',
    cost: 4_000_000,
    upkeep: 25_000,
    spend: 4000,
    conversion: 0.5,
  },
  cinema: {
    type: 'cinema',
    name: '映画館',
    icon: '🎬',
    w: 3,
    h: 3,
    attract: 900,
    hours: [10, 23],
    windows: [
      [10, 14],
      [17, 23],
    ],
    base: 0.2,
    desc: '昼と夜(17〜23時)に人が来ます。休日と雨の日に強く、遊園地とは逆に雨でも客足が落ちません',
    cost: 4_000_000,
    upkeep: 28_000,
    spend: 1500,
    conversion: 0.5,
  },
  zoo: {
    type: 'zoo',
    name: '動物園・水族館',
    icon: '🐧',
    w: 3,
    h: 3,
    attract: 1300,
    hours: [9, 17],
    desc: '日中(9〜17時)に家族連れが来ます。休日と春・秋に強く、雨や雪の日は少なめ',
    cost: 6_000_000,
    upkeep: 42_000,
    spend: 2000,
    conversion: 0.5,
  },
  ski: {
    type: 'ski',
    name: 'スキー場',
    icon: '⛷',
    w: 3,
    h: 3,
    attract: 2200,
    hours: [8, 17],
    desc: '標高4以上の高地にだけ建てられます。12〜3月、特に雪の日に客が殺到し、夏はほとんど来ません',
    cost: 9_000_000,
    upkeep: 70_000,
    spend: 3500,
    conversion: 0.5,
  },
  beach: {
    type: 'beach',
    name: 'ビーチ',
    icon: '🏖',
    w: 3,
    h: 3,
    attract: 1800,
    hours: [9, 18],
    desc: '海のそば(2タイル以内)にだけ建てられます。7〜8月の晴れた休日に大勢が来て、冬や雨の日はほとんど来ません',
    cost: 3_500_000,
    upkeep: 25_000,
    spend: 1600,
    conversion: 0.5,
  },
  arena: {
    type: 'arena',
    name: 'アリーナ・コンサートホール',
    icon: '🎤',
    w: 3,
    h: 3,
    attract: 2500,
    hours: [18, 22],
    windows: [[18, 22]],
    base: 0.05,
    desc: '夜(18〜22時)だけ人が来ます。コンサートの日は需要が数倍になります',
    cost: 12_000_000,
    upkeep: 85_000,
    spend: 3000,
    conversion: 0.5,
  },
  convention: {
    type: 'convention',
    name: 'コンベンションセンター',
    icon: '🧳',
    w: 3,
    h: 3,
    attract: 1400,
    hours: [9, 18],
    desc: '平日の日中に出張客が来ます(休日は閑散)。大型の展示会の日は需要が3倍になります',
    cost: 9_000_000,
    upkeep: 60_000,
    spend: 2800,
    conversion: 0.5,
  },
  bizhotel: {
    type: 'bizhotel',
    name: 'ビジネスホテル',
    icon: '🏩',
    w: 3,
    h: 3,
    attract: 500,
    hours: [0, 24],
    desc: '出張客が平日に泊まります(休日は少なめ)。リゾートのホテルとは売上の波が逆になります',
    cost: 3_000_000,
    upkeep: 20_000,
    spend: 3500,
    conversion: 0.5,
  },
  campus: {
    type: 'campus',
    name: '大学',
    icon: '🎓',
    w: 3,
    h: 3,
    attract: 1600,
    hours: [8, 19],
    windows: [
      [8, 10],
      [16, 19],
    ],
    base: 0.2,
    desc: '平日の登校(8〜10時)と下校(16〜19時)に学生が集まります。夏休み・春休み・休日は閑散。売上は小さいが需要が安定します',
    cost: 7_000_000,
    upkeep: 40_000,
    spend: 600,
    conversion: 0.5,
  },
  golf: {
    type: 'golf',
    name: 'ゴルフ場',
    icon: '⛳',
    w: 3,
    h: 3,
    attract: 700,
    hours: [6, 15],
    desc: '朝〜昼(6〜15時)に来ます。休日と春・秋に強く、雨や雪の日は閑散。1人あたりの売上が高い施設です',
    cost: 5_000_000,
    upkeep: 32_000,
    spend: 5000,
    conversion: 0.5,
  },
  hospital: {
    type: 'hospital',
    name: '病院',
    icon: '🏥',
    w: 3,
    h: 3,
    attract: 900,
    hours: [8, 17],
    windows: [[8, 17]],
    base: 0.3,
    desc: '日中(8〜17時)を中心に、一日を通して安定して人が訪れます。冬は少し増えます。近くの街(街の広がりの1.2倍以内)の成長が速くなります(大で+25%、複数で最大+60%。持ち主を問わず街全体に効きます)',
    cost: 8_000_000,
    upkeep: 50_000,
    spend: 1000,
    conversion: 0.5,
  },
  stationmall: {
    type: 'stationmall',
    name: '駅ビル',
    icon: '🛍',
    w: 3,
    h: 3,
    attract: 2200,
    hours: [8, 22],
    desc: '鉄道の駅から4タイル以内にだけ建てられます。駅の利用者がそのまま買い物をするので、売上が大きい施設です',
    cost: 10_000_000,
    upkeep: 60_000,
    spend: 1800,
    conversion: 0.5,
  },
};
/**
 * Facilities drawn with sprites (school, town hall, department store, shopping mall). Only those whose design is decided.
 * Department stores and malls (4x3) in old saves without a design keep the earlier procedural drawing.
 */
export const SPRITE_TYPES: FacilityType[] = ['school', 'cityhall', 'department', 'mall', 'sight', 'hotel', 'park', ...NEW_FACILITY_TYPES, 'amusement', 'stadium'];

export type FacilitySize = 'S' | 'M' | 'L';
/** Facilities whose design can be chosen (players can build them with any design and size), and the number of designs */
export const DESIGN_COUNT: Partial<Record<FacilityType, number>> = {
  department: 20,
  mall: 20,
  hotel: 30,
  park: 20,
  ...Object.fromEntries(NEW_FACILITY_TYPES.map((t) => [t, 16])),
  amusement: 16,
  stadium: 16,
};
export const CHOOSABLE: FacilityType[] = ['hotel', 'park', 'department', 'mall', ...NEW_FACILITY_TYPES, 'amusement', 'stadium'];
/** Facilities whose sizes S/M/L are 1x1 / 2x2 / 3x3 tiles (other sprite facilities are 1x1 / 1x1 / 2x2) */
export const SIZED3: FacilityType[] = ['hotel', 'park', ...NEW_FACILITY_TYPES];
/** Sprite facilities whose cells differ by size (the site is n x n tiles). In addition to SIZED3, the large amusement park and stadium */
export const SIZED_TYPES: FacilityType[] = [...SIZED3, 'amusement', 'stadium'];
/** Side length in tiles of sizes S/M/L (SIZED3 members not listed here use 1/2/3). For large facilities, the earlier size (amusement park 5x5, stadium 4x4) is L */
const SIDE_TILES: Partial<Record<FacilityType, Record<FacilitySize, number>>> = {
  amusement: { S: 3, M: 4, L: 5 },
  stadium: { S: 2, M: 3, L: 4 },
};
/** Multiplier by size (construction cost, upkeep, visitor cap). Hotels and parks: S=1x1 M=2x2 L=3x3; department stores and malls: S/M=1x1 L=2x2 */
const SIZE_MUL: Partial<Record<FacilityType, Record<FacilitySize, number>>> = {
  hotel: { S: 0.4, M: 0.7, L: 1 },
  park: { S: 0.4, M: 0.7, L: 1 },
  department: { S: 0.5, M: 0.75, L: 1 },
  mall: { S: 0.5, M: 0.75, L: 1 },
  sight: { S: 0.5, M: 0.75, L: 1 },
  amusement: { S: 0.4, M: 0.7, L: 1 },
  stadium: { S: 0.4, M: 0.7, L: 1 },
  ...Object.fromEntries(NEW_FACILITY_TYPES.map((t) => [t, { S: 0.4, M: 0.7, L: 1 }])),
};
export const sizeMul = (type: FacilityType, size: FacilitySize | undefined): number => (size ? (SIZE_MUL[type]?.[size] ?? 1) : 1);

/** A facility's site (tiles). Sizes S/M/L: hotels and parks 1x1 / 2x2 / 3x3, other sprite facilities 1x1 / 1x1 / 2x2 */
export function facilityDims(type: FacilityType, size: FacilitySize): { w: number; h: number } {
  const side = SIDE_TILES[type]?.[size];
  if (side) return { w: side, h: side };
  if (SIZED3.includes(type)) return size === 'L' ? { w: 3, h: 3 } : size === 'M' ? { w: 2, h: 2 } : { w: 1, h: 1 };
  return size === 'L' ? { w: 2, h: 2 } : { w: 1, h: 1 };
}
/** Construction cost and upkeep (per day) of facilities with a size and design (sprite-drawn). Old procedurally drawn facilities have no size and stay as before */
export const facilityCost = (type: FacilityType, size?: FacilitySize): number => Math.round((FACILITY_SPECS[type].cost * sizeMul(type, size)) / 1000) * 1000;
export const facilityUpkeep = (f: Pick<Facility, 'type' | 'size' | 'design' | 'grade'>): number =>
  Math.round(FACILITY_SPECS[f.type].upkeep * (f.design !== undefined && CHOOSABLE.includes(f.type) ? sizeMul(f.type, f.size) : 1) * gradeUpkeepMul(gradeOf(f)));
export const isSpriteFacility = (f: Facility): boolean => SPRITE_TYPES.includes(f.type) && f.design !== undefined && f.size !== undefined;

/** Sizes S and M are one tile, L is 2x2 tiles */
export const spriteDims = (size: 'S' | 'M' | 'L'): { w: number; h: number } => (size === 'L' ? { w: 2, h: 2 } : { w: 1, h: 1 });
/** A facility's construction cost (varies with size when it has a size and design) */
export const facilityBuildCost = (f: Pick<Facility, 'type' | 'size' | 'design'>): number =>
  f.design !== undefined && CHOOSABLE.includes(f.type) ? facilityCost(f.type, f.size) : FACILITY_SPECS[f.type].cost;

/** Redesign cost: a fraction of the construction cost */
export const REDESIGN_RATE = 0.15;
/** Cost of redesigning a built facility (the size cannot change) */
export const redesignCost = (f: Pick<Facility, 'type' | 'size' | 'design'>): number => Math.round((facilityBuildCost(f) * REDESIGN_RATE) / 1000) * 1000;
/**
 * Whether a facility's design can be changed (at the same size). Sprite facilities (with design and size) can.
 * Old procedurally drawn facilities (no design) can be replaced by an L sprite if their site is the same size as L. If not, the reason
 */
export function redesignRule(f: Pick<Facility, 'type' | 'size' | 'design' | 'w' | 'h'>): { ok: true; size: FacilitySize } | { ok: false; reason: string } {
  if (!CHOOSABLE.includes(f.type)) return { ok: false, reason: 'この施設はデザインを変えられません' };
  if (f.design !== undefined && f.size !== undefined) return { ok: true, size: f.size };
  const L = facilityDims(f.type, 'L');
  if (f.w === L.w && f.h === L.h) return { ok: true, size: 'L' };
  return { ok: false, reason: 'この施設は古い形式で、デザインを変えられません' };
}

/** Department stores and malls change demand with size (S=0.5 M=0.75 L=1). Other facilities are constant */
export function facilityAttract(f: Facility): number {
  const a = FACILITY_SPECS[f.type].attract * gradeCapMul(gradeOf(f)); // the higher the grade, the more people it draws
  if ((CHOOSABLE.includes(f.type) || f.type === 'sight') && f.design !== undefined) return a * sizeMul(f.type, f.size);
  return a;
}

/** Facilities players can build (public facilities excluded) */
export const FACILITY_TYPES = (Object.keys(FACILITY_SPECS) as FacilityType[]).filter((t) => !FACILITY_SPECS[t].public);

export interface Facility {
  id: number;
  type: FacilityType;
  /** Top-left (smallest x,y) tile */
  x0: number;
  y0: number;
  w: number;
  h: number;
  name: string;
  /** Owner: player = the player's own / city = another company (can be acquired). The player's own if absent */
  owner?: 'player' | 'city' | 'public';
  /** Look of a public facility: size S/M (1x1) L (2x2), and the design number (school 0-19, town hall 0-99). The town it belongs to */
  size?: 'S' | 'M' | 'L';
  design?: number;
  townId?: number;
  /** The rival company ID that owns it when owner is city (another company) */
  ownerId?: number;
  /** Multiplayer: the company (account ID) that owns a player-owned (player) facility */
  playerId?: number;
  /** Advertising: its kind and the day it ran (running day number). How long it lasts and how long until the next one are decided by kind and constants */
  ad?: { kind: 'news' | 'sns' | 'tv'; from: number };
  /** Price level (0 = cheapest to 4 = luxury; unset is standard = 2) and price sensitivity (computed at the day close; also used for sales from station visitors) */
  price?: number;
  elast?: number;
  /** Grade (stars 1-5; unset is 1), reputation (0-100; unset is 50), and the day it was built / renovated (running day number) */
  grade?: number;
  rep?: number;
  renov?: number;
  /** For a listed property, the day it was listed (running day number). If no buyer comes within LISTING_DAYS days, it is demolished */
  listedDay?: number;
  /** Cumulative visitors (people) */
  visits?: number;
  /** Today's sales (yen) and the sales per day recently (exponential moving average) */
  dayIncome?: number;
  income?: number;
}

/** The value that represents a facility's site in the building layer (tier 0, the largest kind number, the office bit; it never overlaps an ordinary building) */
export const FACILITY_TILE = 0xfc;

/** How easily people gather by time of day (0-1). The time is 0-24. With windows, each window is 1 and outside it is base (default 0.15) */
export function hourFactor(spec: FacilitySpec, hour: number): number {
  const win = (a: number, b: number): number => {
    if (hour >= a && hour < b) return 1;
    // Ramps smoothly over 30 minutes either side
    if (hour >= a - 0.5 && hour < a) return 0.15 + 0.85 * ((hour - (a - 0.5)) / 0.5);
    if (hour >= b && hour < b + 0.5) return 1 - 0.85 * ((hour - b) / 0.5);
    return 0.15;
  };
  const base = spec.base ?? 0.15;
  const ws = spec.windows ?? [spec.hours];
  if (ws.length === 1 && !spec.windows) {
    // A single window (the earlier behaviour): ramps smoothly over an hour either side, and 15% outside
    const [a, b] = spec.hours;
    if (hour >= a && hour < b) return 1;
    if (hour >= a - 1 && hour < a) return 0.15 + 0.85 * (hour - (a - 1));
    if (hour >= b && hour < b + 1) return 1 - 0.85 * (hour - b);
    return 0.15;
  }
  return Math.max(base, ...ws.map(([a, b]) => (win(a, b) - 0.15) / 0.85));
}

export interface FacilityPlan {
  ok: boolean;
  reason?: string;
  x0: number;
  y0: number;
  w: number;
  h: number;
  tiles: [number, number][];
}

/** Altitude (levels) needed for a ski resort */
export const SKI_MIN_LEVEL = 4;
/** How far (tiles) a beach may be from the sea */
export const BEACH_SEA_RANGE = 2;
/** Location conditions (ski resort = highland, beach = near the sea). If not met, the reason */
export function siteRule(map: GameMap, type: FacilityType, x0: number, y0: number, w: number, h: number, lv: number): string | null {
  if (type === 'ski' && lv < SKI_MIN_LEVEL) return `スキー場は標高${SKI_MIN_LEVEL}以上の高地にだけ建てられます(ここは標高${lv})`;
  if (type === 'beach') {
    for (let y = y0 - BEACH_SEA_RANGE; y < y0 + h + BEACH_SEA_RANGE; y++)
      for (let x = x0 - BEACH_SEA_RANGE; x < x0 + w + BEACH_SEA_RANGE; x++) if (map.inBounds(x, y) && map.levelAt(x, y) === 0) return null;
    return `ビーチは海のそば(${BEACH_SEA_RANGE}タイル以内)にだけ建てられます`;
  }
  return null;
}

/** How far (tiles) a station building may be from a railway station */
export const STATIONMALL_RANGE = 4;
/** Whether there is a railway station (waypoints excluded) near plan (within `range` tiles) */
export function nearRailStop(
  stops: Iterable<{ kind: string; waypoint?: boolean; x: number; y: number }>,
  plan: { x0: number; y0: number; w: number; h: number },
  range: number,
): boolean {
  for (const s of stops)
    if (s.kind === 'rail' && !s.waypoint && s.x >= plan.x0 - range && s.x < plan.x0 + plan.w + range && s.y >= plan.y0 - range && s.y < plan.y0 + plan.h + range) return true;
  return false;
}

/** Whether it can be placed with (cx,cy) as the centre (the site must be land of the same height with nothing on it) */
export function planFacility(map: GameMap, cx: number, cy: number, type: FacilityType, occupied: (idx: number) => boolean, dims?: { w: number; h: number }): FacilityPlan {
  const spec = FACILITY_SPECS[type];
  const w = dims?.w ?? spec.w;
  const h = dims?.h ?? spec.h;
  const x0 = cx - Math.floor(w / 2);
  const y0 = cy - Math.floor(h / 2);
  const tiles: [number, number][] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) tiles.push([x, y]);
  const fail = (reason: string): FacilityPlan => ({ ok: false, reason, x0, y0, w, h, tiles });
  if (!map.inBounds(x0, y0) || !map.inBounds(x0 + w - 1, y0 + h - 1)) return fail('マップの範囲外です');
  const lv = map.levelAt(x0, y0);
  if (lv === 0) return fail('陸地に置いてください');
  for (const [x, y] of tiles) {
    if (map.levelAt(x, y) !== lv) return fail('敷地を同じ高さの平地にしてください');
    const i = map.idx(x, y);
    if (map.building.get(i) || map.road.get(i) || map.rail.get(i) || map.air.get(i) || map.span.get(i)) return fail('建物・道路・線路・空港・橋があります');
    if (occupied(i)) return fail('停留所や車両基地と重なっています');
  }
  const why = siteRule(map, type, x0, y0, w, h, lv);
  if (why) return fail(why);
  return { ok: true, x0, y0, w, h, tiles };
}

export function placeFacility(map: GameMap, plan: FacilityPlan, type: FacilityType, owner: 'player' | 'city' | 'public' = 'player'): Facility {
  const spec = FACILITY_SPECS[type];
  const id = map.facilities.reduce((m, f) => Math.max(m, f.id), 0) + 1;
  const f: Facility = { id, type, x0: plan.x0, y0: plan.y0, w: plan.w, h: plan.h, name: `${spec.name}${id}`, owner };
  map.facilities.push(f);
  map.facilityVer++;
  for (const [x, y] of plan.tiles) {
    map.building.set(map.idx(x, y), FACILITY_TILE);
    map.owner.set(map.idx(x, y), 0);
    map.touch(x, y);
  }
  return f;
}

export function facilityAt(map: GameMap, x: number, y: number): Facility | undefined {
  return map.facilities.find((f) => x >= f.x0 && x < f.x0 + f.w && y >= f.y0 && y < f.y0 + f.h);
}

export function removeFacility(map: GameMap, f: Facility): void {
  for (let y = f.y0; y < f.y0 + f.h; y++) {
    for (let x = f.x0; x < f.x0 + f.w; x++) {
      if (!map.inBounds(x, y)) continue;
      const i = map.idx(x, y);
      if (map.building.get(i) === FACILITY_TILE) map.building.set(i, 0);
      map.touch(x, y);
    }
  }
  const k = map.facilities.indexOf(f);
  if (k >= 0) map.facilities.splice(k, 1);
  map.facilityVer++;
}

const tileCache = new WeakMap<GameMap, { ver: number; n: number; grid: Map<number, Facility> }>();

/** Tile index -> facility. For drawing (can be looked up from any tile of the site; rebuilt only when facilities are added or removed) */
export function facilityTileMap(map: GameMap): Map<number, Facility> {
  const c = tileCache.get(map);
  if (c && c.ver === map.facilityVer && c.n === map.facilities.length) return c.grid;
  const grid = new Map<number, Facility>();
  for (const f of map.facilities) for (let y = f.y0; y < f.y0 + f.h; y++) for (let x = f.x0; x < f.x0 + f.w; x++) grid.set(y * map.size + x, f);
  tileCache.set(map, { ver: map.facilityVer, n: map.facilities.length, grid });
  return grid;
}

/** The front tile (largest x+y) of a facility. Large buildings are drawn relative to it */
export const facilityAnchor = (map: GameMap, f: Facility): number => (f.y0 + f.h - 1) * map.size + (f.x0 + f.w - 1);

/** Facilities overlapping the catchment (a square of radius R) of the stop at (x,y) */
export function facilitiesNear(map: GameMap, x: number, y: number, R: number): Facility[] {
  return map.facilities.filter((f) => x + R >= f.x0 && x - R < f.x0 + f.w && y + R >= f.y0 && y - R < f.y0 + f.h);
}
