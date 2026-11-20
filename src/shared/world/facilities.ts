import type { GameMap } from './gameMap';

/** 大型施設(スタジアム・遊園地など)。周辺の停留所の乗客需要が増える */
export type FacilityType = 'stadium' | 'amusement' | 'mall' | 'park' | 'department' | 'hotel' | 'school' | 'cityhall' | 'sight';

export interface FacilitySpec {
  type: FacilityType;
  name: string;
  icon: string;
  /** 敷地(タイル) */
  w: number;
  h: number;
  /** 需要(停留所の集客圏の人口に換算した人数) */
  attract: number;
  /** 人が集まる時間帯 [開始時, 終了時)。外は 15% */
  hours: [number, number];
  desc: string;
  /** 建設費(円)・維持費(1日)・来場1人あたりの売上(円)・来場者のうち買い物などをする割合 */
  cost: number;
  upkeep: number;
  spend: number;
  conversion: number;
  /** 公共施設(街が自動で建てる。プレイヤーは建てられず、撤去も買収もできない) */
  public?: boolean;
  /** 人が集まる時間帯が複数あるとき [開始時, 終了時) の一覧(hours の代わり)。外の時間帯の係数は base */
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
};
/**
 * スプライトで描く施設(学校・市役所・百貨店・ショッピングモール)。design が決まっているものだけ。
 * design が無い古いセーブの百貨店・モール(4×3)は従来の手続き描画のまま。
 */
export const SPRITE_TYPES: FacilityType[] = ['school', 'cityhall', 'department', 'mall', 'sight', 'hotel', 'park'];

export type FacilitySize = 'S' | 'M' | 'L';
/** デザインを選べる施設(プレイヤーが好きなデザインと大きさで建てられる)と、デザインの数 */
export const DESIGN_COUNT: Partial<Record<FacilityType, number>> = { department: 20, mall: 20, hotel: 30, park: 20 };
export const CHOOSABLE: FacilityType[] = ['hotel', 'park', 'department', 'mall'];
/** 大きさによる倍率(建設費・維持費・来場者の上限)。ホテル・公園は S=1x1 M=2x2 L=3x3、百貨店・モールは S/M=1x1 L=2x2 */
const SIZE_MUL: Partial<Record<FacilityType, Record<FacilitySize, number>>> = {
  hotel: { S: 0.4, M: 0.7, L: 1 },
  park: { S: 0.4, M: 0.7, L: 1 },
  department: { S: 0.5, M: 0.75, L: 1 },
  mall: { S: 0.5, M: 0.75, L: 1 },
  sight: { S: 0.5, M: 0.75, L: 1 },
};
export const sizeMul = (type: FacilityType, size: FacilitySize | undefined): number => (size ? (SIZE_MUL[type]?.[size] ?? 1) : 1);

/** 施設の敷地(タイル)。大きさ S/M/L: ホテル・公園は 1x1 / 2x2 / 3x3、ほかのスプライト施設は 1x1 / 1x1 / 2x2 */
export function facilityDims(type: FacilityType, size: FacilitySize): { w: number; h: number } {
  if (type === 'hotel' || type === 'park') return size === 'L' ? { w: 3, h: 3 } : size === 'M' ? { w: 2, h: 2 } : { w: 1, h: 1 };
  return size === 'L' ? { w: 2, h: 2 } : { w: 1, h: 1 };
}
/** 大きさ・デザインを持つ(スプライトの)施設の建設費と維持費(1日)。古い手続き描画の施設は大きさがなく、従来どおり */
export const facilityCost = (type: FacilityType, size?: FacilitySize): number => Math.round((FACILITY_SPECS[type].cost * sizeMul(type, size)) / 1000) * 1000;
export const facilityUpkeep = (f: Pick<Facility, 'type' | 'size' | 'design'>): number =>
  Math.round(FACILITY_SPECS[f.type].upkeep * (f.design !== undefined && CHOOSABLE.includes(f.type) ? sizeMul(f.type, f.size) : 1));
export const isSpriteFacility = (f: Facility): boolean => SPRITE_TYPES.includes(f.type) && f.design !== undefined && f.size !== undefined;

/** 大きさ S/M は1タイル、L は 2x2 タイル */
export const spriteDims = (size: 'S' | 'M' | 'L'): { w: number; h: number } => (size === 'L' ? { w: 2, h: 2 } : { w: 1, h: 1 });
/** 施設の建設費(大きさ・デザインがあれば大きさで変わる) */
export const facilityBuildCost = (f: Pick<Facility, 'type' | 'size' | 'design'>): number =>
  f.design !== undefined && CHOOSABLE.includes(f.type) ? facilityCost(f.type, f.size) : FACILITY_SPECS[f.type].cost;

/** 百貨店・モールは大きさで需要が変わる(S=0.5 M=0.75 L=1)。ほかの施設は一定 */
export function facilityAttract(f: Facility): number {
  const a = FACILITY_SPECS[f.type].attract;
  if ((f.type === 'department' || f.type === 'mall' || f.type === 'sight' || f.type === 'hotel' || f.type === 'park') && f.design !== undefined) return a * sizeMul(f.type, f.size);
  return a;
}

/** プレイヤーが建てられる施設(公共施設は含まない) */
export const FACILITY_TYPES = (Object.keys(FACILITY_SPECS) as FacilityType[]).filter((t) => !FACILITY_SPECS[t].public);

export interface Facility {
  id: number;
  type: FacilityType;
  /** 左上(最小 x,y)のタイル */
  x0: number;
  y0: number;
  w: number;
  h: number;
  name: string;
  /** 持ち主: player=自社 / city=他社(買収できる)。なければ自社 */
  owner?: 'player' | 'city' | 'public';
  /** 公共施設の見た目: 大きさ S/M(1x1) L(2x2) と、デザイン番号(学校0〜19・市役所0〜99)。所属する街 */
  size?: 'S' | 'M' | 'L';
  design?: number;
  townId?: number;
  /** 他社(city)のときの持ち主の競合会社ID */
  ownerId?: number;
  /** マルチプレイ: 自社(player)施設の持ち主の会社(アカウントID) */
  playerId?: number;
  /** 広告: 種類と、打った日(日の通し番号)。効く日数と次に打てるまでの日数は種類・定数で決まる */
  ad?: { kind: 'news' | 'sns' | 'tv'; from: number };
  /** 来場者の累計(人) */
  visits?: number;
  /** 今日の売上(円)と、直近の1日あたりの売上(指数移動平均) */
  dayIncome?: number;
  income?: number;
}

/** building レイヤーで施設の敷地を表す値(段階0・最大の種類番号・オフィスbit。通常の建物とは重ならない) */
export const FACILITY_TILE = 0xfc;

/** 時間帯による人の集まりやすさ(0〜1)。時刻は 0〜24。windows があれば、その各時間帯が 1、外は base(既定0.15) */
export function hourFactor(spec: FacilitySpec, hour: number): number {
  const win = (a: number, b: number): number => {
    if (hour >= a && hour < b) return 1;
    // 前後30分はなだらかに
    if (hour >= a - 0.5 && hour < a) return 0.15 + 0.85 * ((hour - (a - 0.5)) / 0.5);
    if (hour >= b && hour < b + 0.5) return 1 - 0.85 * ((hour - b) / 0.5);
    return 0.15;
  };
  const base = spec.base ?? 0.15;
  const ws = spec.windows ?? [spec.hours];
  if (ws.length === 1 && !spec.windows) {
    // 単一の時間帯(従来): 前後1時間をなだらかに、外は15%
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

/** 中心を (cx,cy) として置けるか(敷地が同じ高さの陸で、何もない) */
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

/** タイル index → 施設。描画用(敷地のどのタイルからでも引ける。施設が増減したときだけ作り直す) */
export function facilityTileMap(map: GameMap): Map<number, Facility> {
  const c = tileCache.get(map);
  if (c && c.ver === map.facilityVer && c.n === map.facilities.length) return c.grid;
  const grid = new Map<number, Facility>();
  for (const f of map.facilities) for (let y = f.y0; y < f.y0 + f.h; y++) for (let x = f.x0; x < f.x0 + f.w; x++) grid.set(y * map.size + x, f);
  tileCache.set(map, { ver: map.facilityVer, n: map.facilities.length, grid });
  return grid;
}

/** 施設の手前側(x+y が最大)のタイル。大きな建物はここを基準に描く */
export const facilityAnchor = (map: GameMap, f: Facility): number => (f.y0 + f.h - 1) * map.size + (f.x0 + f.w - 1);

/** 停留所(x,y)の集客圏(半径 R の正方形)と重なる施設 */
export function facilitiesNear(map: GameMap, x: number, y: number, R: number): Facility[] {
  return map.facilities.filter((f) => x + R >= f.x0 && x - R < f.x0 + f.w && y + R >= f.y0 && y - R < f.y0 + f.h);
}
