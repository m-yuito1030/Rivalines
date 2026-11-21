import type { GameMap } from './gameMap';
import { gradeCapMul, gradeOf, gradeUpkeepMul } from './facilityQuality';

/** 大型施設(スタジアム・遊園地など)。周辺の停留所の乗客需要が増える */
/** あとから加わった、デザインと大きさを選んで建てる施設(映画館・動物園・スキー場・ビーチ・アリーナ・コンベンション・ビジネスホテル・大学・ゴルフ場・病院・駅ビル) */
export const NEW_FACILITY_TYPES = ['cinema', 'zoo', 'ski', 'beach', 'arena', 'convention', 'bizhotel', 'campus', 'golf', 'hospital', 'stationmall'] as const;
export type NewFacilityType = (typeof NEW_FACILITY_TYPES)[number];
export type FacilityType = 'stadium' | 'amusement' | 'mall' | 'park' | 'department' | 'hotel' | 'school' | 'cityhall' | 'sight' | NewFacilityType;

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
 * スプライトで描く施設(学校・市役所・百貨店・ショッピングモール)。design が決まっているものだけ。
 * design が無い古いセーブの百貨店・モール(4×3)は従来の手続き描画のまま。
 */
export const SPRITE_TYPES: FacilityType[] = ['school', 'cityhall', 'department', 'mall', 'sight', 'hotel', 'park', ...NEW_FACILITY_TYPES, 'amusement', 'stadium'];

export type FacilitySize = 'S' | 'M' | 'L';
/** デザインを選べる施設(プレイヤーが好きなデザインと大きさで建てられる)と、デザインの数 */
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
/** 大きさ S/M/L が 1x1 / 2x2 / 3x3 タイルの施設(ほかのスプライト施設は 1x1 / 1x1 / 2x2) */
export const SIZED3: FacilityType[] = ['hotel', 'park', ...NEW_FACILITY_TYPES];
/** 大きさごとにセルが違う(敷地が n×n タイル)スプライト施設。SIZED3 に加えて、敷地の大きい遊園地・スタジアム */
export const SIZED_TYPES: FacilityType[] = [...SIZED3, 'amusement', 'stadium'];
/** 大きさ S/M/L の一辺のタイル数(ここにない SIZED3 は 1/2/3)。大きな施設は、従来の大きさ(遊園地 5×5・スタジアム 4×4)が L */
const SIDE_TILES: Partial<Record<FacilityType, Record<FacilitySize, number>>> = {
  amusement: { S: 3, M: 4, L: 5 },
  stadium: { S: 2, M: 3, L: 4 },
};
/** 大きさによる倍率(建設費・維持費・来場者の上限)。ホテル・公園は S=1x1 M=2x2 L=3x3、百貨店・モールは S/M=1x1 L=2x2 */
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

/** 施設の敷地(タイル)。大きさ S/M/L: ホテル・公園は 1x1 / 2x2 / 3x3、ほかのスプライト施設は 1x1 / 1x1 / 2x2 */
export function facilityDims(type: FacilityType, size: FacilitySize): { w: number; h: number } {
  const side = SIDE_TILES[type]?.[size];
  if (side) return { w: side, h: side };
  if (SIZED3.includes(type)) return size === 'L' ? { w: 3, h: 3 } : size === 'M' ? { w: 2, h: 2 } : { w: 1, h: 1 };
  return size === 'L' ? { w: 2, h: 2 } : { w: 1, h: 1 };
}
/** 大きさ・デザインを持つ(スプライトの)施設の建設費と維持費(1日)。古い手続き描画の施設は大きさがなく、従来どおり */
export const facilityCost = (type: FacilityType, size?: FacilitySize): number => Math.round((FACILITY_SPECS[type].cost * sizeMul(type, size)) / 1000) * 1000;
export const facilityUpkeep = (f: Pick<Facility, 'type' | 'size' | 'design' | 'grade'>): number =>
  Math.round(FACILITY_SPECS[f.type].upkeep * (f.design !== undefined && CHOOSABLE.includes(f.type) ? sizeMul(f.type, f.size) : 1) * gradeUpkeepMul(gradeOf(f)));
export const isSpriteFacility = (f: Facility): boolean => SPRITE_TYPES.includes(f.type) && f.design !== undefined && f.size !== undefined;

/** 大きさ S/M は1タイル、L は 2x2 タイル */
export const spriteDims = (size: 'S' | 'M' | 'L'): { w: number; h: number } => (size === 'L' ? { w: 2, h: 2 } : { w: 1, h: 1 });
/** 施設の建設費(大きさ・デザインがあれば大きさで変わる) */
export const facilityBuildCost = (f: Pick<Facility, 'type' | 'size' | 'design'>): number =>
  f.design !== undefined && CHOOSABLE.includes(f.type) ? facilityCost(f.type, f.size) : FACILITY_SPECS[f.type].cost;

/** デザイン変更の費用: 建設費の何割か */
export const REDESIGN_RATE = 0.15;
/** 建てた施設のデザイン変更の費用(大きさは変えられない) */
export const redesignCost = (f: Pick<Facility, 'type' | 'size' | 'design'>): number => Math.round((facilityBuildCost(f) * REDESIGN_RATE) / 1000) * 1000;
/**
 * デザインを変えられる施設か(同じ大きさのまま)。スプライト施設(design と size がある)は可。
 * 古い手続き描画の施設(design なし)は、敷地が L と同じ大きさなら、L のスプライトに替えられる。変えられなければ理由
 */
export function redesignRule(f: Pick<Facility, 'type' | 'size' | 'design' | 'w' | 'h'>): { ok: true; size: FacilitySize } | { ok: false; reason: string } {
  if (!CHOOSABLE.includes(f.type)) return { ok: false, reason: 'この施設はデザインを変えられません' };
  if (f.design !== undefined && f.size !== undefined) return { ok: true, size: f.size };
  const L = facilityDims(f.type, 'L');
  if (f.w === L.w && f.h === L.h) return { ok: true, size: 'L' };
  return { ok: false, reason: 'この施設は古い形式で、デザインを変えられません' };
}

/** 百貨店・モールは大きさで需要が変わる(S=0.5 M=0.75 L=1)。ほかの施設は一定 */
export function facilityAttract(f: Facility): number {
  const a = FACILITY_SPECS[f.type].attract * gradeCapMul(gradeOf(f)); // グレードが高いほど人を呼べる
  if ((CHOOSABLE.includes(f.type) || f.type === 'sight') && f.design !== undefined) return a * sizeMul(f.type, f.size);
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
  /** 料金の段階(0=格安〜4=高級。未設定は標準=2)と、値上げへの敏感さ(1日の締めに計算して、駅からの来場の売上にも使う) */
  price?: number;
  elast?: number;
  /** グレード(★1〜5。未設定は1)・評判(0〜100。未設定は50)・建てた/改装した日(日の通し番号) */
  grade?: number;
  rep?: number;
  renov?: number;
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

/** スキー場に必要な標高(段数) */
export const SKI_MIN_LEVEL = 4;
/** ビーチが海から離れてよい距離(タイル) */
export const BEACH_SEA_RANGE = 2;
/** 立地の条件(スキー場=高地、ビーチ=海のそば)。満たさなければ理由 */
export function siteRule(map: GameMap, type: FacilityType, x0: number, y0: number, w: number, h: number, lv: number): string | null {
  if (type === 'ski' && lv < SKI_MIN_LEVEL) return `スキー場は標高${SKI_MIN_LEVEL}以上の高地にだけ建てられます(ここは標高${lv})`;
  if (type === 'beach') {
    for (let y = y0 - BEACH_SEA_RANGE; y < y0 + h + BEACH_SEA_RANGE; y++)
      for (let x = x0 - BEACH_SEA_RANGE; x < x0 + w + BEACH_SEA_RANGE; x++) if (map.inBounds(x, y) && map.levelAt(x, y) === 0) return null;
    return `ビーチは海のそば(${BEACH_SEA_RANGE}タイル以内)にだけ建てられます`;
  }
  return null;
}

/** 駅ビルが鉄道の駅から離れてよい距離(タイル) */
export const STATIONMALL_RANGE = 4;
/** 敷地 plan の近く(range タイル以内)に、鉄道の駅(経由点を除く)があるか */
export function nearRailStop(
  stops: Iterable<{ kind: string; waypoint?: boolean; x: number; y: number }>,
  plan: { x0: number; y0: number; w: number; h: number },
  range: number,
): boolean {
  for (const s of stops)
    if (s.kind === 'rail' && !s.waypoint && s.x >= plan.x0 - range && s.x < plan.x0 + plan.w + range && s.y >= plan.y0 - range && s.y < plan.y0 + plan.h + range) return true;
  return false;
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
