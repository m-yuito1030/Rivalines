/**
 * Vehicle models (data-driven). Model numbers, names, and color schemes are all fictional.
 * 320 in total: 210 rail / 70 bus / 40 aircraft. The 8 original models (Mirai 8000 series, etc.) are fixed; the rest are generated deterministically.
 */
export type Mode = 'road' | 'rail' | 'air';

export interface VehicleModel {
  id: string;
  mode: Mode;
  name: string;
  /** Category (commuter, limited express, small bus, ...). For filtering */
  kind: string;
  /** Capacity: per car for rail, per vehicle for buses and aircraft */
  cap: number;
  /** Tiles per tick (10 ticks/second at x1) */
  speed: number;
  /** Rail: range of train car counts. A single-car model has min = max = 1; a multi-car model can be any length from 2 up */
  minCars: number;
  maxCars: number;
  /** Rail: the default when a route does not specify a car count */
  defaultCars: number;
  /** Draw color */
  body: number;
  stripe?: number;
  /** Sprite design number: buses 0-249 (25 types x 10 colors), aircraft 0-99 (10 types x 10 colors), rail 0-449 (30 types x 15 colors; 190 are used) */
  sprite?: number;
}

type KindSpec = {
  mode: Mode;
  kind: string;
  count: number;
  cap: [number, number];
  speed: [number, number];
  cars?: [number, number]; // rail: [min, max]. [1,1] is a single unit
  dflt?: number;
};

/** Number of vehicles per category (including the original models) and the performance ranges */
const KINDS: KindSpec[] = [
  { mode: 'rail', kind: '単行', count: 20, cap: [90, 140], speed: [0.38, 0.5], cars: [1, 1] },
  { mode: 'rail', kind: '路面電車', count: 15, cap: [60, 95], speed: [0.28, 0.38], cars: [1, 1] },
  { mode: 'rail', kind: 'ローカル', count: 25, cap: [95, 130], speed: [0.4, 0.5], cars: [2, 6], dflt: 3 },
  { mode: 'rail', kind: '通勤', count: 34, cap: [130, 160], speed: [0.48, 0.55], cars: [4, 15], dflt: 8 },
  { mode: 'rail', kind: '近郊', count: 29, cap: [100, 125], speed: [0.5, 0.6], cars: [3, 15], dflt: 6 },
  { mode: 'rail', kind: '快速', count: 20, cap: [95, 120], speed: [0.58, 0.68], cars: [4, 12], dflt: 8 },
  { mode: 'rail', kind: '特急', count: 19, cap: [52, 72], speed: [0.72, 0.85], cars: [4, 16], dflt: 7 },
  { mode: 'rail', kind: '高速', count: 10, cap: [65, 95], speed: [0.95, 1.1], cars: [6, 16], dflt: 10 },
  { mode: 'rail', kind: '地下鉄', count: 10, cap: [140, 175], speed: [0.45, 0.52], cars: [4, 10], dflt: 6 },
  { mode: 'rail', kind: '観光', count: 8, cap: [40, 60], speed: [0.36, 0.45], cars: [2, 8], dflt: 4 },
  { mode: 'road', kind: 'ミニバス', count: 10, cap: [10, 16], speed: [0.28, 0.33] },
  { mode: 'road', kind: '小型バス', count: 15, cap: [18, 28], speed: [0.28, 0.32] },
  { mode: 'road', kind: '中型バス', count: 15, cap: [30, 42], speed: [0.26, 0.31] },
  { mode: 'road', kind: '大型バス', count: 15, cap: [44, 60], speed: [0.25, 0.3] },
  { mode: 'road', kind: '連節バス', count: 8, cap: [80, 110], speed: [0.23, 0.27] },
  { mode: 'road', kind: '二階建てバス', count: 7, cap: [62, 86], speed: [0.23, 0.27] },
  { mode: 'air', kind: '小型機', count: 12, cap: [36, 80], speed: [0.7, 0.85] },
  { mode: 'air', kind: '中型機', count: 14, cap: [150, 230], speed: [0.95, 1.1] },
  { mode: 'air', kind: '大型機', count: 14, cap: [300, 520], speed: [1.15, 1.3] },
];

import railDesigns from './trainDesigns.json';
import subwayDesigns from './subwayDesigns.json';

/** Subway trains have their own 30 designs (sprite numbers 1000-1029, a separate atlas). The first 10 are the earlier subway models, the other 20 are added at the end */
const SUBWAY_SPRITE_BASE = 1000;
const SUBWAY_DESIGNS = subwayDesigns.names.length;

/** The original models (ID and performance fixed). For rail, cap is per car */
const FIXED: (Omit<VehicleModel, 'minCars' | 'maxCars' | 'defaultCars'> & { cars?: [number, number]; dflt?: number })[] = [
  { id: 'bus-s', mode: 'road', kind: '小型バス', name: '小型バス「こまち」', cap: 22, speed: 0.3, body: 0xe0533d },
  { id: 'bus-l', mode: 'road', kind: '大型バス', name: '大型バス「あおぞら」', cap: 45, speed: 0.27, body: 0x3d8fe0 },
  { id: 'mirai8000', mode: 'rail', kind: '通勤', name: 'ミライ8000系', cap: 140, speed: 0.5, body: 0xcfd4dc, stripe: 0x2fa36b, cars: [4, 15], dflt: 8 },
  { id: 'asahi500', mode: 'rail', kind: '近郊', name: 'あさひ500系', cap: 110, speed: 0.55, body: 0xf1e6c8, stripe: 0xe8862f, cars: [3, 15], dflt: 6 },
  { id: 'ryusei7000', mode: 'rail', kind: '特急', name: '流星7000系', cap: 60, speed: 0.75, body: 0xf4f6fa, stripe: 0x1d3a8a, cars: [4, 16], dflt: 7 },
  { id: 'air-s', mode: 'air', kind: '小型機', name: '小型機「ことり100」', cap: 60, speed: 0.8, body: 0xffffff, stripe: 0x3d8fe0 },
  { id: 'air-m', mode: 'air', kind: '中型機', name: '中型機「ひばり300」', cap: 180, speed: 1.0, body: 0xffffff, stripe: 0xe0533d },
  { id: 'air-l', mode: 'air', kind: '大型機', name: '大型機「おおとり700」', cap: 400, speed: 1.2, body: 0xffffff, stripe: 0x1d3a8a },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Name ingredients (fictional; avoiding nicknames of real trains and aircraft)
const STEMS = [
  'あおば',
  'ひなた',
  'しらゆき',
  'せせらぎ',
  'なぎさ',
  'かぜのこ',
  'つきかげ',
  'はるかぜ',
  'もみじ',
  'ほたる',
  'かすみ',
  'あかね',
  'みなも',
  'ゆうなぎ',
  'こもれび',
  'あさぎり',
  'はまなす',
  'すずらん',
  'わかば',
  'ふゆぞら',
  'ひだまり',
  'おぼろ',
  'さざなみ',
  'たなばた',
  'いちょう',
  'あやめ',
  'しぐれ',
  'とよあし',
  'ましろ',
  'あさかぜ',
];
const BIRDS = ['うみねこ', 'ひよどり', 'かもめ', 'もず', 'あおさぎ', 'めじろ', 'ひたき', 'いかる', 'じょうびたき', 'ほおじろ', 'せきれい', 'みやまがらす'];
const BUS_NAMES = ['みどり', 'ひので', 'さつき', 'やまぶき', 'そよかぜ', 'あけぼの', 'こはる', 'なでしこ', 'ふたば', 'ゆりかもめ', 'しおかぜ', 'ひまわり'];
const BODY = [0xcfd4dc, 0xf1e6c8, 0xf4f6fa, 0xe8e2d0, 0xdfe6ee, 0xc9d3c4, 0xe9d8d0, 0xd8dce6, 0xf2efe6, 0xbfc7d4, 0xe6e0f0, 0xd6e4dc];
const STRIPE = [0x2fa36b, 0xe8862f, 0x1d3a8a, 0xc0392b, 0x2e86c1, 0x8e44ad, 0xd4ac0d, 0x138d75, 0xe84393, 0x16a085, 0xd35400, 0x34495e, 0x27ae60, 0xf39c12, 0x2980b9, 0xc2185b];
const BUS_BODY = [0xe0533d, 0x3d8fe0, 0x4bb36a, 0xe0b83d, 0xa65fd6, 0x3dc7c0, 0xe07a9a, 0xf2f2f0, 0xf08a24, 0x2f6fb0, 0x6cc24a, 0xd9514e];

function generate(): VehicleModel[] {
  const rng = mulberry32(20261117);
  const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  const between = (r: [number, number]) => r[0] + rng() * (r[1] - r[0]);
  const used = new Set<string>(FIXED.map((f) => f.name));
  const out: VehicleModel[] = FIXED.map((f) => ({
    id: f.id,
    mode: f.mode,
    kind: f.kind,
    name: f.name,
    cap: f.cap,
    speed: f.speed,
    minCars: f.cars ? f.cars[0] : 1,
    maxCars: f.cars ? f.cars[1] : 1,
    defaultCars: f.dflt ?? 1,
    body: f.body,
    stripe: f.stripe,
  }));
  const have = (kind: string) => out.filter((m) => m.kind === kind).length;
  let serial = 0;
  for (const k of KINDS) {
    while (have(k.kind) < k.count) {
      serial++;
      let name = '';
      for (let t = 0; t < 50; t++) {
        const num = (1 + Math.floor(rng() * 99)) * 100 + (rng() < 0.3 ? 50 : 0);
        name =
          k.mode === 'rail'
            ? `${pick(STEMS)}${num}系`
            : k.mode === 'air'
              ? `${k.kind}「${pick(BIRDS)}${num}」`
              : `${k.kind}「${pick(BUS_NAMES)}」${String.fromCharCode(65 + Math.floor(rng() * 26))}${Math.floor(rng() * 90 + 10)}`;
        if (!used.has(name)) break;
        name += `-${serial}`; // make it unique with a serial number if it collides
      }
      used.add(name);
      const cars = k.cars ?? [1, 1];
      const id = `${k.mode === 'rail' ? 'tr' : k.mode === 'air' ? 'ac' : 'bs'}${String(serial).padStart(3, '0')}`;
      out.push({
        id,
        mode: k.mode,
        kind: k.kind,
        name,
        cap: Math.round(between(k.cap)),
        speed: Math.round(between(k.speed) * 100) / 100,
        minCars: cars[0],
        maxCars: cars[1],
        defaultCars: k.dflt ?? 1,
        body: k.mode === 'road' ? pick(BUS_BODY) : pick(BODY),
        stripe: k.mode === 'road' ? undefined : pick(STRIPE),
      });
    }
  }
  // Assign sprite designs: per category, use the candidate types in order, and advance the color variant when they run out
  const BUS_POOLS: Record<string, number[]> = {
    ミニバス: [8, 17, 15],
    小型バス: [1, 9, 14, 16, 18],
    中型バス: [18, 1, 11, 12, 16, 21],
    大型バス: [0, 6, 7, 13, 19, 21, 10, 22],
    連節バス: [2, 3, 20],
    二階建てバス: [4, 5, 23],
  };
  const AIR_POOLS: Record<string, number[]> = { 小型機: [0, 1, 9, 7], 中型機: [2, 3, 6, 7], 大型機: [4, 5, 8, 3] };
  const count = new Map<string, number>();
  for (const m of out) {
    const j = count.get(m.kind) ?? 0;
    if (m.mode === 'rail' && m.kind === '地下鉄') {
      m.sprite = SUBWAY_SPRITE_BASE + (j % SUBWAY_DESIGNS);
      count.set(m.kind, j + 1);
      continue;
    }
    if (m.mode === 'rail') {
      // Rail: the j-th entry of the per-category design list (decided by tools/vehicle-sprites/build_train_atlas.py)
      const list = (railDesigns.kinds as Record<string, number[]>)[m.kind];
      count.set(m.kind, j + 1);
      if (list) m.sprite = list[j % list.length];
      continue;
    }
    const pools = m.mode === 'road' ? BUS_POOLS : AIR_POOLS;
    const pool = pools[m.kind];
    if (!pool) continue;
    count.set(m.kind, j + 1);
    const kindOff = Object.keys(pools).indexOf(m.kind) * 3;
    m.sprite = pool[j % pool.length] * 10 + ((Math.floor(j / pool.length) + kindOff) % 10);
  }
  // The other subway designs get models of their own. A separate random sequence, so the models above (and the saves that use them) do not change
  const srng = mulberry32(20261201);
  const spec = KINDS.find((k) => k.kind === '地下鉄')!;
  const between2 = (r: [number, number]) => r[0] + srng() * (r[1] - r[0]);
  for (let d = out.filter((m) => m.kind === '地下鉄').length; d < SUBWAY_DESIGNS; d++) {
    out.push({
      id: `sw${String(d + 1).padStart(2, '0')}`,
      mode: 'rail',
      kind: '地下鉄',
      name: `${subwayDesigns.names[d]}${1000 + d * 50}系`,
      cap: Math.round(between2(spec.cap)),
      speed: Math.round(between2(spec.speed) * 100) / 100,
      minCars: spec.cars![0],
      maxCars: spec.cars![1],
      defaultCars: spec.dflt ?? 1,
      body: 0xcfd4dc,
      sprite: SUBWAY_SPRITE_BASE + d,
    });
  }
  return out;
}

export const ALL_MODELS: VehicleModel[] = generate();
export const BUS_MODELS = ALL_MODELS.filter((m) => m.mode === 'road');
export const TRAIN_MODELS = ALL_MODELS.filter((m) => m.mode === 'rail');
export const AIRCRAFT_MODELS = ALL_MODELS.filter((m) => m.mode === 'air');

const byId = new Map(ALL_MODELS.map((m) => [m.id, m]));

/** Map old saved model IDs ('mirai8000-8', 'asahi500-15-10+5', etc.) to a series ID + car count */
function legacy(id: string): { model: VehicleModel; cars: number } | undefined {
  const mt = /^([a-z]+\d+)-(\d+)(?:-.*)?$/.exec(id);
  const model = mt && byId.get(mt[1]);
  return model && mt ? { model, cars: Number(mt[2]) } : undefined;
}

export const modelOf = (id: string): VehicleModel => byId.get(id) ?? legacy(id)?.model ?? ALL_MODELS[0];
/** The car count contained in an old ID (undefined if none) */
export const legacyCarsOf = (id: string): number | undefined => (byId.has(id) ? undefined : legacy(id)?.cars);
export const modelsFor = (mode: Mode): VehicleModel[] => ALL_MODELS.filter((m) => m.mode === mode);
export const kindsFor = (mode: Mode): string[] => [...new Set(modelsFor(mode).map((m) => m.kind))];
export const defaultModel = (mode: Mode): string => modelsFor(mode)[0].id;
/** Clamp the car count to the model's range */
export const clampCars = (m: VehicleModel, cars: number): number => Math.max(m.minCars, Math.min(m.maxCars, Math.round(cars) || m.defaultCars));

/** The class of an aircraft model: S small, M medium, L large (an airport takes aircraft up to a class that depends on its size) */
export const aircraftClass = (m: VehicleModel): 'S' | 'M' | 'L' => (m.kind === '小型機' ? 'S' : m.kind === '中型機' ? 'M' : 'L');
