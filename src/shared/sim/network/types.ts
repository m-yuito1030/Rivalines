import { DX8, DY8 } from '../../world/directions';
import type { Mode } from '../../data/models';
import type { StationInfo } from '../../world/stations';
export const DAY_TICKS = 30 * 60 * 10;
/** ゲーム開始は 06:00 */
export const START_TOD = DAY_TICKS / 4;
export const todOf = (tick: number) => (tick + START_TOD) % DAY_TICKS;

export interface Stop {
  id: number;
  name: string;
  kind: Mode;
  idx: number;
  x: number;
  y: number;
  /** 待っている人の合計 */
  waiting: number;
  /** 目的地の停留所ID → 人数 */
  wait: Map<number, number>;
  /** 発生の端数 */
  frac: number;
  pop: number; // 集客圏の人口
  townId: number;
  /** 鉄道: 複数タイルの駅(ホーム数・長さ・デザイン)。なければ1タイルの簡易駅 */
  station?: StationInfo;
  /** 鉄道: 経由点(乗降なし。経路の指定用) */
  waypoint?: boolean;
  /** 集客圏にある大型施設の需要(人口換算の合計)と施設ID */
  fpop?: number;
  facs?: number[];
  /** 乗降した人数の累計(ランキング用) */
  traffic?: number;
  /** 沿線開発の開発度(なければ0) */
  dev?: number;
  /** マルチプレイ: 設置した会社(アカウントID)。なければ共用 */
  owner?: number;
  /** この停留所を路線に使ってよい他社(アカウントID)。持ち主が駅ごとに許可する */
  allow?: number[];
}

/** dwell=一定時間停車 / full=満載まで待つ(最大maxWait) / timed=時刻表(周期 route.period) */
export type OrderKind = 'dwell' | 'full' | 'timed';
/**
 * 出発時の条件付きオーダー(JGRPP風): この停留所を出発するとき条件を満たしたら、次のオーダーの代わりに to 番(0始まり)へ進む。
 * kind: load=積載率(%) / wait=この停留所の待ち人数 / tod=時刻(1日内の分)。op: ge=以上 / lt=未満
 */
export interface OrderCond {
  kind: 'load' | 'wait' | 'tod';
  op: 'ge' | 'lt';
  value: number;
  to: number;
}
export interface Order {
  /** 条件付きジャンプ(なければ通常どおり次のオーダー) */
  cond?: OrderCond;
  stopId: number;
  kind: OrderKind;
  dwell: number; // 最低停車tick
  maxWait: number; // full: 最大待ちtick
  departTod: number; // timed: 出発時刻(1日内tick)
  /** 通過: この駅には停まらず通り抜ける(快速・特急の通過駅)。経由点と同じ扱いで、乗降も停車もしない */
  pass?: boolean;
}

export interface Route {
  id: number;
  name: string;
  color: number;
  mode: Mode;
  modelId: string; // 「＋車両」で追加する車種
  /** 今日の運賃収入と、直近の1日あたり収入・利益(円。ランキング用) */
  dayRevenue?: number;
  income?: number;
  profit?: number;
  /** 実測した区間の走行時間(tick, 添字=出発オーダー)。時刻表の自動作成に使う */
  legMeasured?: number[];
  /** 共有オーダーのグループID(同じ値の路線はオーダー・周期を共有する。編集は syncOrders で全員に反映) */
  shared?: number;
  /** 鉄道: 「＋車両」で追加する編成の両数(なければ車種の既定)。単行の車種は常に1両 */
  cars?: number;
  /** 時刻表の周期(tick)。例: 1日 / 6時間 */
  period: number;
  /** 運賃の倍率(なければ1)。収入にそのまま掛かり、停留所の乗客の発生を増減させる */
  fareMul?: number;
  /** 平均遅延(tick, 指数移動平均) */
  late: number;
  /** 累計輸送人数(目的地まで運んだ人数) */
  carried?: number;
  orders: Order[];
  /** マルチプレイ: 路線の持ち主(会社) */
  owner?: number;
  /** 種別(0普通 1準急 2快速 3急行 4特急)。通過駅の自動設定と表示に使う */
  rank?: number;
  /** 配信用(ダイヤ画面): 車両(id, 発車時刻のずれ)と、オーダーごとの次の停車駅までの走行時間。サーバーが付けて送る */
  vs?: [number, number][];
  legs?: number[];
}

export interface Flight {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dist: number;
  done: number;
}

export type VehicleState = 'move' | 'load' | 'noroute';
export interface Vehicle {
  id: number;
  routeId: number;
  modelId: string;
  mode: Mode;
  order: number; // 現在いる/向かっているオーダー
  path: Uint32Array;
  pi: number; // path 上の現在位置
  t: number; // pi→pi+1 の進捗 0..1
  state: VehicleState;
  arrived: number;
  until: number;
  retryAt: number;
  load: number;
  /** 乗客の目的地ごとの人数 */
  cargo: Map<number, number>;
  cap: number;
  speed: number;
  /** 鉄道: 頭から尾までのタイル列と、必要なタイル数 */
  trail: number[];
  len: number;
  /** 航空: 飛行中の区間 */
  flight: Flight | null;
  /** 停車中の向き(航空・道路の描画用) */
  hx: number;
  hy: number;
  /** 道路: 現在のタイルへ入ってきた向き(車線の占有に使う) */
  dir: number;
  /** 渋滞・待機で動けない連続tick数 */
  stuck: number;
  /** 走行中の経路が、変更されたタイルを通る(次のタイルに入ったところで探し直す)。保存しない一時的な印 */
  replan?: boolean;
  /** 鉄道: 現在の速度の割合(0〜1)。発車でゆっくり上がり、停車駅の手前で下がる(加減速) */
  sf?: number;
  /** 時刻表の発車時刻をずらす量(tick)。同じ時刻表で走る車両の時間差に使う */
  offset: number;
  /** 鉄道: 編成の両数(分割・併合で変わる) */
  cars: number;
  /** 鉄道: 待機中(分割で切り離された編成。出発操作まで動かない) */
  hold: boolean;
  /** 鉄道: 経路 path のうち、閉塞として予約済みの最後の添字 */
  resTo: number;
  /** 直前に停まった停留所(運賃の距離計算用) */
  lastStop?: number;
  /** 直近の出発: 出発したオーダーの添字と時刻(区間の実測用) */
  from?: number;
  departedAt?: number;
}

export interface Depot {
  id: number;
  kind: Mode;
  idx: number;
  x: number;
  y: number;
  name: string;
  owner?: number;
}

export interface Departure {
  routeId: number;
  vehicleId: number;
  /** 到着までの tick(停車中は 0) */
  eta: number;
  stopped: boolean;
  /** 停車中: 発車までの tick */
  leaveIn: number;
  /** 次の行き先(次のオーダーの停留所名) */
  toward: string;
}

export interface TransitSave {
  nextId: number;
  delivered: number;
  transfers: number;
  stops: (Omit<Stop, 'wait'> & { wait: [number, number][] })[];
  routes: Route[];
  /** 信号: [タイルindex, 方向ビット] */
  signals?: [number, number][];
  /** 会社単位の停留所の使用許可: [持ち主, 許可した会社の一覧] */
  grants?: [number, number[]][];
  depots?: Depot[];
  vehicles: (Omit<Vehicle, 'path' | 'cargo'> & { path: number[]; cargo: [number, number][] })[];
}

/** 時刻表の周期の選択肢 */
/** 停車駅で折り返す判断: 前進の経路がこの長さ(タイル)を超え、折り返しの経路が前進の 1/REVERSE_RATIO 以下のとき折り返す */
export const REVERSE_MIN_TILES = 16;
export const REVERSE_RATIO = 1.6;

/** 鉄道の減速を始める、停車駅までの距離(タイル) */
export const DECEL_TILES = 3;

/** 経路キャッシュの最大件数(超えたら古い1割を捨てる)、変更の履歴の最大件数、変更が経路に影響しうる範囲の余白(タイル) */
export const PATH_CACHE_MAX = 60000;

/** クライアントの補間用: ある時点のサーバー状態 */
export interface MirrorState {
  pi: number;
  t: number;
  trail: number[];
  done: number;
}
export interface MirrorSnap {
  path: Uint32Array;
  prev: MirrorState | null;
  cur: MirrorState;
  prevAt: number;
  curAt: number;
}
export const NET_LOG_MAX = 4000;
export const PATH_MARGIN = 24;

export interface PathEntry {
  p: Uint32Array | null;
  gen: number;
  /** 始点・終点・経路の外接矩形 */
  bx0: number;
  by0: number;
  bx1: number;
  by1: number;
}

/** 種別: 名前と、途中駅のうち停車を残す割合(残りは通過) */
export const RANKS = [
  { name: '普通', keep: 1 },
  { name: '準急', keep: 0.8 },
  { name: '快速', keep: 0.6 },
  { name: '急行', keep: 0.45 },
  { name: '特急', keep: 0.3 },
] as const;

/**
 * 信号を置ける直線の線路か。置けるなら、その2方向の向きビット [a, b] を返す。
 * 南北=(N,S) 東西=(E,W)、斜めの直線は 北東-南西 / 南東-北西(方向 4..7)
 */
export function signalPair(r: number): [number, number] | null {
  if ((r & 0xf0) === 0) return (r & 15) === 5 ? [1 << 0, 1 << 2] : (r & 15) === 10 ? [1 << 1, 1 << 3] : null;
  if ((r & 15) !== 0) return null;
  return (r & 0xf0) === 0x50 ? [1 << 4, 1 << 6] : (r & 0xf0) === 0xa0 ? [1 << 5, 1 << 7] : null;
}

export const PERIOD_OPTIONS: [string, number][] = [
  ['1日', DAY_TICKS],
  ['12時間', DAY_TICKS / 2],
  ['6時間', DAY_TICKS / 4],
  ['3時間', DAY_TICKS / 8],
  ['1時間', DAY_TICKS / 24],
  ['30分', DAY_TICKS / 48],
];

/** time を基準に、周期 P の「発車予定」のうち近いものとの差(-P/2..P/2)を返す */
export function nearestDiff(scheduledTod: number, nowTod: number, P: number): number {
  let d = (((scheduledTod - nowTod) % P) + P) % P;
  if (d > P / 2) d -= P;
  return d;
}

/** 連結後の最大両数 */
export const MAX_CARS = 20;
export const CAR_LEN = 0.5; // 鉄道1両のタイル長
/** 編成が占有するタイル数 */
export const trainLen = (cars: number) => Math.ceil(cars * CAR_LEN) + 1;
export const AIR_ALT = 70; // 巡航高度(px)
export const CATCH: Record<Mode, number> = { road: 4, rail: 6, air: 10 };
export const WAIT_CAP: Record<Mode, number> = { road: 300, rail: 1500, air: 3000 };
export const PAX_RATE = 2e-5; // 人口あたりの乗客発生/tick
export const GEN_EVERY = 20; // 乗客発生の間隔(tick)
export const DEFAULT_DWELL: Record<Mode, number> = { road: 50, rail: 100, air: 150 };
export const ROUTE_COLORS = [0xe0533d, 0x3d8fe0, 0x4bb36a, 0xe0b83d, 0xa65fd6, 0x3dc7c0, 0xe07a9a, 0x8a8f96];
export const KIND_INDEX: Record<Mode, number> = { road: 0, rail: 1, air: 2 };
export const KIND_NAME: Record<Mode, string> = { road: 'バス停', rail: '駅', air: '空港' };

export function dirBetween(a: number, b: number, size: number): number {
  const dx = (b % size) - (a % size);
  const dy = Math.floor(b / size) - Math.floor(a / size);
  for (let d = 0; d < 8; d++) if (DX8[d] === dx && DY8[d] === dy) return d;
  return -1;
}
