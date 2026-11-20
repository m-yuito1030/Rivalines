import { type Mode, clampCars, defaultModel, legacyCarsOf, modelOf } from '../../data/models';
import { CONN, DX8, DY8, OUT, opposite8 } from '../../world/directions';
import type { GameMap } from '../../world/gameMap';
import { findTerminal } from '../../world/airports';
import { disconnectRail } from '../../world/rails';
import { POP_PER_LEVEL, popMul } from '../../world/town';
import { makeRng } from '../../world/towns';
import { findPath } from './pathfinding';
import { FACILITY_SPECS, facilitiesNear, facilityAttract, hourFactor } from '../../world/facilities';
import { FARE, fareDemand, fareMulOf } from './fares';
import { facilityDayMul } from '../world/events';
import { DEV } from '../economy/development';
import { type StationInfo, type StationOptions, layStationTracks, planStation, stationTile, stationTiles } from '../../world/stations';
import { Router } from './routing';

/** 1日のtick数(simulation.ts と同値。循環importを避けて定義) */
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
interface MirrorState {
  pi: number;
  t: number;
  trail: number[];
  done: number;
}
interface MirrorSnap {
  path: Uint32Array;
  prev: MirrorState | null;
  cur: MirrorState;
  prevAt: number;
  curAt: number;
}
export const NET_LOG_MAX = 4000;
export const PATH_MARGIN = 24;

interface PathEntry {
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
const CATCH: Record<Mode, number> = { road: 4, rail: 6, air: 10 };
export const WAIT_CAP: Record<Mode, number> = { road: 300, rail: 1500, air: 3000 };
const PAX_RATE = 2e-5; // 人口あたりの乗客発生/tick
const GEN_EVERY = 20; // 乗客発生の間隔(tick)
const DEFAULT_DWELL: Record<Mode, number> = { road: 50, rail: 100, air: 150 };
const ROUTE_COLORS = [0xe0533d, 0x3d8fe0, 0x4bb36a, 0xe0b83d, 0xa65fd6, 0x3dc7c0, 0xe07a9a, 0x8a8f96];
const KIND_INDEX: Record<Mode, number> = { road: 0, rail: 1, air: 2 };
const KIND_NAME: Record<Mode, string> = { road: 'バス停', rail: '駅', air: '空港' };

export class Transit {
  stops = new Map<number, Stop>();
  routes = new Map<number, Route>();
  vehicles: Vehicle[] = [];
  private stopAt = new Map<number, number>();
  /** 鉄道の予約済みタイル(閉塞): tile → vehicle id */
  private reserved = new Map<number, number>();
  /** 信号: 線路タイル → 方向ビット(1<<d: d 方向へ進む列車を制御する信号がある)。片方向だけなら逆走は禁止 */
  signals = new Map<number, number>();
  /** 道路の車線の占有: tile*4+向き → vehicle id(1タイル1車線に1台) */
  private lane = new Map<number, number>();
  private nextId = 1;
  /** マルチプレイ: いま操作している会社(新設する停留所・路線・基地の持ち主になる) */
  actor = 0;
  /** マルチプレイ: 切断中の会社。その会社の路線は運行を止める(そのまま止める) */
  frozen = new Set<number>();
  /** 他社のインフラ(道路・線路)のタイルへ入った: 通行料の計算用 */
  onTile?: (v: Vehicle, route: Route, tile: number) => void;
  /** UI更新用: 構造が変わるたびに増える */
  version = 0;
  delivered = 0;
  /** 乗り換えた人数 */
  transfers = 0;
  /** 運賃が支払われた(経営用)。mode, 金額 */
  onFare?: (mode: Mode, amount: number, routeId: number) => void;
  /** 停留所の持ち主の接客の質(乗客の発生にかかる倍率)。設定されていなければ 1 */
  serviceMul?: (owner: number | undefined) => number;
  /** n 人が停留所 stop に到着して降りた(施設の来場者の集計用) */
  onVisit?: (stop: Stop, n: number, tick: number) => void;
  private router = new Router(
    () => this.realRoutes(),
    (id) => (this.stops.get(id)?.pop ?? 0) + (this.stops.get(id)?.fpop ?? 0) + 1,
  );
  /** 停留所の配列(毎tickの走査でアロケーションしないためのキャッシュ) */
  private stopList: Stop[] = [];
  private stopListVer = -1;
  /**
   * 経路キャッシュ。キーは `始点:終点`(巨大マップでは index が 2^32 に迫り、数値の積では 2^53 を超えて別の経路と衝突するため文字列)。
   * 使うたびに各辺・信号の向きを検査する。さらに、ネットワークが変わったとき(netLog)に、変更が「この経路の探索範囲(始点・終点・経路の外接矩形+余白)」に
   * かかっていれば、次に使うときに探し直す。離れた場所の変更では探し直さないので、多数の路線・多数のプレイヤーでも負荷が集中しない。
   */
  private pathCache = new Map<string, PathEntry>();
  /** ネットワーク(線路・道路・信号・駅)の世代。利用者の操作で変わるたびに touchNetwork が進める */
  netGen = 0;
  /** 変更の履歴(世代と矩形)。キャッシュの各件が、自分の世代以降の変更が範囲にかかるかを調べるのに使う */
  private netLog: { gen: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  private netLogFloor = 0;
  /** 経路キャッシュの上限(テストで小さくできる) */
  pathCacheMax = PATH_CACHE_MAX;
  /** 変更した個々のタイルを知らせる(線路・道路・信号の操作のあと)。そのタイルを通る走行中の編成は、次のタイルに入ったところで経路を探し直す */
  touchNetworkTiles(tiles: [number, number][]): void {
    if (!tiles.length) return;
    const rects = tiles.length > 1500 ? [this.boundsOf(tiles)] : tiles.map(([x, y]) => ({ x0: x, y0: y, x1: x, y1: y }));
    this.applyChange(rects);
  }
  private boundsOf(tiles: [number, number][]) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of tiles) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  }

  /** 変更の記録(世代・履歴)と、その変更を通る走行中の編成への「経路の探し直し」の印 */
  private applyChange(rects: { x0: number; y0: number; x1: number; y1: number }[]): void {
    this.netGen++;
    for (const r of rects) this.netLog.push({ gen: this.netGen, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
    if (this.netLog.length > NET_LOG_MAX) {
      const drop = Math.floor(NET_LOG_MAX / 2);
      this.netLogFloor = this.netLog[drop - 1].gen;
      this.netLog.splice(0, drop);
    }
    if (rects.some((r) => r.x0 < 0)) return; // 全体(範囲不明)は編成には印を付けない(キャッシュだけ)
    const s = this.map.size;
    const points = new Set<number>();
    const wide: typeof rects = [];
    for (const r of rects) {
      if (r.x0 === r.x1 && r.y0 === r.y1) points.add(r.y0 * s + r.x0);
      else wide.push(r);
    }
    for (const v of this.vehicles) {
      if (v.mode === 'air' || v.state !== 'move') continue;
      for (let i = v.pi; i < v.path.length; i++) {
        const idx = v.path[i];
        let hit = points.has(idx);
        if (!hit && wide.length) {
          const x = idx % s;
          const y = (idx - x) / s;
          hit = wide.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
        }
        if (hit) {
          v.replan = true;
          break;
        }
      }
    }
  }

  /**
   * ネットワークが変わったことを知らせる(建設・撤去・信号・駅の操作のあとに呼ぶ)。変更した範囲の矩形を渡す
   * (省略すると全体に影響する扱い)。これで、近道を敷く・信号を変えるといった小さな変更でも、関係する経路は次の出発時に探し直される。
   */
  touchNetwork(x0 = -1, y0 = -1, x1 = x0, y1 = y0): void {
    this.applyChange([{ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) }]);
  }

  /** この記録(世代 ce.gen)以降の変更が、記録の探索範囲にかかっているか */
  private pathAffected(ce: PathEntry): boolean {
    if (ce.gen >= this.netGen) return false;
    if (ce.gen < this.netLogFloor) return true; // 古い履歴は捨てたので、念のため探し直す
    for (let i = this.netLog.length - 1; i >= 0; i--) {
      const c = this.netLog[i];
      if (c.gen <= ce.gen) break;
      if (c.x0 < 0) return true;
      if (c.x1 >= ce.bx0 - PATH_MARGIN && c.x0 <= ce.bx1 + PATH_MARGIN && c.y1 >= ce.by0 - PATH_MARGIN && c.y0 <= ce.by1 + PATH_MARGIN) return true;
    }
    return false;
  }
  constructor(
    private map: GameMap,
    private rng: () => number = makeRng(1),
  ) {}

  save(): TransitSave {
    return {
      nextId: this.nextId,
      delivered: this.delivered,
      transfers: this.transfers,
      stops: [...this.stops.values()].map((s) => ({ ...s, wait: [...s.wait] })),
      routes: [...this.routes.values()],
      signals: [...this.signals],
      grants: [...this.grants].map(([o, l]) => [o, [...l]] as [number, number[]]),
      depots: [...this.depots.values()],
      vehicles: this.vehicles.map((v) => ({ ...v, path: Array.from(v.path), cargo: [...v.cargo] })),
    };
  }

  /** 次に振る ID(マルチプレイの配信用) */
  get idCounter(): number {
    return this.nextId;
  }

  private mirrorVeh = new Map<number, Vehicle>();
  /** クライアント: 車両ごとの直近2回のサーバー状態(なめらかに動かすための補間用) */
  private snaps = new Map<number, MirrorSnap>();

  /** クライアント(閲覧側): サーバーから受け取った構造(停留所・路線・基地・信号)で置き換える。待ち人数の内訳は持たない */
  mirrorStruct(d: { nextId: number; routes: Route[]; stops: Stop[]; depots: Depot[]; signals: [number, number][]; grants?: [number, number[]][] }): void {
    this.nextId = d.nextId;
    this.grants = new Map((d.grants ?? []).map(([o, l]) => [o, new Set(l)]));
    const old = this.stops;
    this.stops = new Map(d.stops.map((s) => [s.id, { ...s, wait: new Map(), waiting: old.get(s.id)?.waiting ?? 0 }]));
    this.stopAt = new Map(d.stops.flatMap((s) => this.stopTiles(s).map((i) => [i * 3 + KIND_INDEX[s.kind], s.id] as [number, number])));
    this.routes = new Map(d.routes.map((r) => [r.id, r]));
    this.signals = new Map(d.signals);
    this.depots = new Map(d.depots.map((x) => [x.id, x]));
    this.depotAt = new Map(d.depots.map((x) => [x.idx, x.id]));
    this.version++;
  }

  /** クライアント: 待っている人の数だけ更新する */
  mirrorWaiting(list: [number, number][]): void {
    for (const s of this.stops.values()) s.waiting = 0;
    for (const [id, n] of list) {
      const s = this.stops.get(id);
      if (s) s.waiting = n;
    }
  }

  /** クライアント: 視界内の車両の最新状態を反映する(経路は変わったときだけ届くので前回のものを保つ) */
  mirrorVehicles(list: (Omit<Vehicle, 'path' | 'cargo'> & { path?: number[] })[], gone: number[]): void {
    for (const id of gone) {
      this.mirrorVeh.delete(id);
      this.snaps.delete(id);
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let changed = false;
    for (const m of list) {
      const prev = this.mirrorVeh.get(m.id);
      const path = m.path ? Uint32Array.from(m.path) : prev?.path;
      if (!path) continue; // 経路が未着(通常は起こらない)
      this.mirrorVeh.set(m.id, { ...(prev ?? ({ arrived: 0, until: 0, retryAt: 0, offset: 0 } as Vehicle)), ...m, path, cargo: prev?.cargo ?? new Map() } as Vehicle);
      if (!prev) changed = true;
      // 補間用に今回の状態を記録する(経路が同じときだけ、前回の状態との間を補間できる)
      const old = this.snaps.get(m.id);
      const same = old !== undefined && old.path === path;
      const flight = m.flight as Flight | null;
      this.snaps.set(m.id, { path, prev: same ? old.cur : null, prevAt: same ? old.curAt : now, curAt: now, cur: { pi: m.pi, t: m.t, trail: m.trail, done: flight ? flight.done : 0 } });
    }
    this.vehicles = [...this.mirrorVeh.values()];
    if (changed || gone.length) this.version++;
  }

  /**
   * クライアント: 描画のたびに呼ぶ。サーバーの状態は約10Hzでしか届かないので、直近2回の状態の間を、1区間ぶん遅らせて
   * 線形に補間し(経路上の進み pi+t、鉄道は編成の軌跡、飛行機は飛行距離)、60fpsでもなめらかに動かす。
   * 届くのが遅れたときは少しだけ先まで進め(外挿)、それ以上は止める。経路が変わったときは補間せず、そのまま出す。
   */
  smoothMirror(now: number = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
    for (const [id, v] of this.mirrorVeh) {
      const sn = this.snaps.get(id);
      if (!sn || !sn.prev) continue;
      const dt = sn.curAt - sn.prevAt;
      if (dt <= 0 || dt > 600) continue;
      const delay = Math.min(250, Math.max(60, dt));
      const a = Math.max(0, Math.min(1.25, (now - delay - sn.prevAt) / dt));
      const { prev, cur, path } = sn;
      if (v.flight) {
        const f = v.flight as Flight;
        f.done = Math.min(f.dist, prev.done + (cur.done - prev.done) * a);
        continue;
      }
      const last = path.length - 1;
      const p = Math.max(0, Math.min(last, prev.pi + prev.t + (cur.pi + cur.t - (prev.pi + prev.t)) * a));
      const pi = Math.min(last, Math.floor(p));
      v.pi = pi;
      v.t = pi >= last ? 0 : p - pi;
      if (v.mode === 'rail' && cur.trail.length) {
        // 先頭が pi にあるときの編成の軌跡(頭からの順): 現在のサーバーの軌跡と経路から組み立てる
        const diff = cur.pi - pi; // 表示の頭は、サーバーの頭より diff タイル後ろ
        const tr: number[] = [];
        for (let j = 0; j < cur.trail.length; j++) {
          const n = j + diff; // サーバーの頭から n タイル後ろ
          let tile: number;
          if (n < 0) tile = path[Math.min(last, cur.pi - n)];
          else if (n < cur.trail.length) tile = cur.trail[n];
          else tile = cur.pi - n >= 0 ? path[cur.pi - n] : cur.trail[cur.trail.length - 1];
          tr.push(tile);
        }
        v.trail = tr;
      }
    }
  }

  restore(d: TransitSave): void {
    this.nextId = d.nextId;
    this.delivered = d.delivered;
    this.transfers = d.transfers ?? 0;
    this.stops = new Map(d.stops.map((s) => [s.id, { ...s, wait: new Map(s.wait) }]));
    this.stopAt = new Map(d.stops.flatMap((s) => this.stopTiles(s as unknown as Stop).map((i) => [i * 3 + KIND_INDEX[s.kind], s.id] as [number, number])));
    this.routes = new Map(d.routes.map((r) => [r.id, r]));
    this.signals = new Map(d.signals ?? []);
    this.grants = new Map((d.grants ?? []).map(([o, l]) => [o, new Set(l)]));
    this.depots = new Map((d.depots ?? []).map((x) => [x.id, x]));
    this.depotAt = new Map((d.depots ?? []).map((x) => [x.idx, x.id]));
    this.vehicles = d.vehicles.map((v) => ({
      ...v,
      path: Uint32Array.from(v.path),
      cargo: new Map(v.cargo),
      cars: v.cars ?? legacyCarsOf(v.modelId) ?? modelOf(v.modelId).defaultCars,
      hold: v.hold ?? false,
      resTo: v.resTo ?? v.path.length - 1,
    }));
    this.reserved.clear();
    this.lane.clear();
    for (const v of this.vehicles) {
      if (v.mode === 'road') this.lane.set(this.laneKey(v), v.id);
      if (v.mode !== 'rail') continue;
      for (const t of v.trail) this.reserved.set(t, v.id);
      if (v.state === 'move') for (let i = v.pi + 1; i <= Math.min(v.resTo, v.path.length - 1); i++) this.reserved.set(v.path[i], v.id);
    }
    this.version++;
  }

  // ---------------------------------------------------------------- 編成の分割・併合
  private capPerCar(v: Vehicle): number {
    return modelOf(v.modelId).cap; // 鉄道は1両あたりの定員
  }

  /** 軌道上で tile から次に進める、予約されていない隣接タイル(trail に含まれないもの) */
  private freeNeighbor(tile: number, avoid: Set<number>): number {
    const s = this.map.size;
    for (let d = 0; d < 8; d++) {
      if (!(this.map.rail.get(tile) & CONN(d))) continue;
      const n = ((Math.floor(tile / s)) + DY8[d]) * s + (tile % s) + DX8[d];
      if (!avoid.has(n) && !this.reserved.has(n)) return n;
    }
    return -1;
  }

  /**
   * 停車中の編成の後ろ k 両を切り離す。切り離した編成は同じ路線の待機編成になる(departHeld で出発)。
   * 後ろの線路が足りなければ null。
   */
  splitTrain(vid: number, k: number, tick: number): Vehicle | null {
    const v = this.vehicles.find((x) => x.id === vid);
    if (!v || v.mode !== 'rail' || v.state !== 'load' || !Number.isInteger(k) || k < 1 || k >= v.cars) return null;
    const front = v.cars - k;
    const lenA = trainLen(front);
    const lenB = trainLen(k);
    const trailA = v.trail.slice(0, lenA);
    const trailB = v.trail.slice(trailA.length);
    const used = new Set<number>(v.trail);
    // 後ろの線路が足りなければ、さらに後方へ延ばす(予約されていない線路のみ)
    while (trailB.length < lenB) {
      const last = trailB.length ? trailB[trailB.length - 1] : trailA[trailA.length - 1];
      const n = this.freeNeighbor(last, used);
      if (n < 0) break;
      trailB.push(n);
      used.add(n);
    }
    if (!trailB.length) return null;
    const per = this.capPerCar(v);
    const cargoB = new Map<number, number>();
    let loadB = 0;
    for (const [d, n] of v.cargo) {
      const nb = Math.floor((n * k) / v.cars);
      if (nb <= 0) continue;
      cargoB.set(d, nb);
      v.cargo.set(d, n - nb);
      if (n - nb <= 0) v.cargo.delete(d);
      loadB += nb;
    }
    v.load -= loadB;
    const b: Vehicle = {
      ...v,
      id: this.nextId++,
      path: Uint32Array.of(trailB[0]),
      pi: 0,
      t: 0,
      state: 'load',
      arrived: tick,
      until: tick,
      retryAt: 0,
      load: loadB,
      cargo: cargoB,
      cap: per * k,
      trail: trailB,
      len: lenB,
      stuck: 0,
      cars: k,
      hold: true,
      resTo: 0,
    };
    v.cars = front;
    v.cap = per * front;
    v.len = lenA;
    v.trail = trailA;
    for (const t of trailB) this.reserved.set(t, b.id);
    this.vehicles.push(b);
    this.version++;
    return b;
  }

  /** 待機中の編成を出発させる */
  departHeld(vid: number, tick: number): boolean {
    const v = this.vehicles.find((x) => x.id === vid);
    if (!v || !v.hold) return false;
    v.hold = false;
    v.until = tick;
    this.version++;
    return true;
  }

  /** 停車中の2編成の端同士が線路でつながっていれば、連結用の並びを返す(なければ null) */
  private coupleOrder(a: Vehicle, b: Vehicle): number[] | null {
    if (a === b || a.mode !== 'rail' || b.mode !== 'rail' || a.state !== 'load' || b.state !== 'load') return null;
    if (a.cars + b.cars > MAX_CARS || !a.trail.length || !b.trail.length) return null;
    const m = this.map;
    const s = m.size;
    const adj = (p: number, q: number) => {
      const d = dirBetween(p, q, s);
      return d >= 0 && (m.rail.get(p) & CONN(d)) !== 0 && (m.rail.get(q) & CONN(opposite8(d))) !== 0;
    };
    const aEnds: [number, boolean][] = [[a.trail[a.trail.length - 1], false], [a.trail[0], true]]; // [タイル, 先頭側か]
    const bEnds: [number, boolean][] = [[b.trail[0], true], [b.trail[b.trail.length - 1], false]];
    for (const [ea, aHead] of aEnds) {
      for (const [eb, bHead] of bEnds) {
        if (!adj(ea, eb)) continue;
        const aSeq = aHead ? [...a.trail].reverse() : a.trail; // ea が末尾に来るように
        const bSeq = bHead ? b.trail : [...b.trail].reverse(); // eb が先頭に来るように
        return [...aSeq, ...bSeq];
      }
    }
    return null;
  }

  canCouple(aId: number, bId: number): boolean {
    const a = this.vehicles.find((x) => x.id === aId);
    const b = this.vehicles.find((x) => x.id === bId);
    return !!a && !!b && this.coupleOrder(a, b) !== null;
  }

  /** 2編成を連結して a に統合する(b は消える)。連結できなければ false */
  coupleTrains(aId: number, bId: number): boolean {
    const a = this.vehicles.find((x) => x.id === aId);
    const b = this.vehicles.find((x) => x.id === bId);
    if (!a || !b) return false;
    const order = this.coupleOrder(a, b);
    if (!order) return false;
    this.releaseAll(b.id);
    this.vehicles = this.vehicles.filter((x) => x.id !== b.id);
    a.trail = order;
    a.cars += b.cars;
    a.cap += b.cap;
    a.len = trainLen(a.cars);
    for (const [d, n] of b.cargo) a.cargo.set(d, (a.cargo.get(d) ?? 0) + n);
    a.load += b.load;
    a.hold = a.hold && b.hold;
    for (const t of order) this.reserved.set(t, a.id);
    this.version++;
    return true;
  }

  /** 駅の近く(Chebyshev 距離 r 以内。15両編成が収まる9タイル)に停まっている鉄道編成 */
  trainsNear(stopId: number, r = 9): Vehicle[] {
    const s = this.stops.get(stopId);
    if (!s) return [];
    const size = this.map.size;
    const st = s.station;
    const x0 = st ? st.x0 : s.x;
    const y0 = st ? st.y0 : s.y;
    const x1 = st ? st.x0 + (st.axis === 1 ? st.len : st.tracks) - 1 : s.x;
    const y1 = st ? st.y0 + (st.axis === 1 ? st.tracks : st.len) - 1 : s.y;
    return this.vehicles.filter(
      (v) =>
        v.mode === 'rail' &&
        v.state === 'load' &&
        v.trail.some((t) => {
          const tx = t % size;
          const ty = Math.floor(t / size);
          return tx >= x0 - r && tx <= x1 + r && ty >= y0 - r && ty <= y1 + r;
        }),
    );
  }

  /** 信号の方向ビット。直線の線路でなくなっていたら信号を取り除く */
  signalMask(idx: number): number {
    const mk = this.signals.get(idx);
    if (!mk) return 0;
    if (!signalPair(this.map.rail.get(idx))) {
      this.signals.delete(idx);
      return 0;
    }
    return mk;
  }

  /**
   * タイルの信号を切り替える: なし → 一方向 → 逆方向 → なし(両方向の信号はなし。単線では使わず、複線で上り下りを分ける)。
   * 直線(南北/東西)の線路で、駅・橋・トンネルでないタイルのみ。戻り値は新しい方向ビット(置けなければ null)
   */
  cycleSignal(x: number, y: number): number | null {
    const m = this.map;
    if (!m.inBounds(x, y)) return null;
    const i = m.idx(x, y);
    const pair = signalPair(m.rail.get(i));
    if (!pair || m.span.get(i) || this.stopAtTile(x, y, 'rail')) return null;
    const [a, b] = pair;
    const cur = this.signalMask(i);
    const next = cur === 0 ? a : cur === a ? b : 0;
    if (next) this.signals.set(i, next);
    else this.signals.delete(i);
    this.touchNetwork(x, y);
    this.version++;
    return next;
  }

  /** 信号を指定の向きビットで置く(既存は上書き)。直線の線路で駅・橋でなければ true。向きが線路の方向でなければ false */
  setSignal(x: number, y: number, mask: number): boolean {
    const m = this.map;
    if (!m.inBounds(x, y)) return false;
    const i = m.idx(x, y);
    const pair = signalPair(m.rail.get(i));
    if (!pair || m.span.get(i) || this.stopAtTile(x, y, 'rail')) return false;
    if (mask !== pair[0] && mask !== pair[1]) return false;
    this.signals.set(i, mask);
    this.touchNetwork(x, y);
    this.version++;
    return true;
  }

  /** path[i] への進入が信号で制御されているか(path[i-1]→path[i] の向きの信号がある) */
  private controlled(path: Uint32Array, i: number): boolean {
    if (!this.signals.size) return false;
    const d = dirBetween(path[i - 1], path[i], this.map.size);
    return d >= 0 && d < 8 && (this.signalMask(path[i]) & (1 << d)) !== 0;
  }

  /**
   * 次に予約する範囲の末尾(path の添字)。信号がなければ終点まで、
   * 信号の手前までなら信号の1つ手前まで、信号の直前なら次の信号の手前まで(= 信号の先の閉塞を確保)。
   */
  private nextReserveEnd(v: Vehicle): number {
    const p = v.path;
    let m1 = -1;
    for (let i = v.resTo + 1; i < p.length; i++) {
      if (this.controlled(p, i)) {
        m1 = i;
        break;
      }
    }
    if (m1 < 0) return p.length - 1;
    if (m1 > v.resTo + 1) return m1 - 1;
    for (let i = m1 + 1; i < p.length; i++) if (this.controlled(p, i)) return i - 1;
    return p.length - 1;
  }

  /** 前方の閉塞を予約する。他編成が使っていれば何もせず false(赤信号) */
  private extendReservation(v: Vehicle): boolean {
    if (v.resTo >= v.path.length - 1) return true;
    const end = this.nextReserveEnd(v);
    for (let i = v.resTo + 1; i <= end; i++) {
      const o = this.reserved.get(v.path[i]);
      if (o !== undefined && o !== v.id) return false;
    }
    for (let i = v.resTo + 1; i <= end; i++) this.reserved.set(v.path[i], v.id);
    v.resTo = end;
    return true;
  }

  /** 信号が赤か(進入先の閉塞がすでに予約されている) */
  signalIsRed(idx: number): boolean {
    return this.reserved.has(idx);
  }

  stopAtTile(x: number, y: number, kind?: Mode): Stop | undefined {
    const i = this.map.idx(x, y);
    for (const k of kind ? [kind] : (['road', 'rail', 'air'] as Mode[])) {
      const id = this.stopAt.get(i * 3 + KIND_INDEX[k]);
      if (id !== undefined) return this.stops.get(id);
    }
    return undefined;
  }

  /** 経由点を除いた路線(乗客の経路表用) */
  private *realRoutes(): Generator<Route> {
    for (const r of this.routes.values()) {
      yield r.orders.some((o) => o.pass || this.stops.get(o.stopId)?.waypoint) ? { ...r, orders: r.orders.filter((o) => !o.pass && !this.stops.get(o.stopId)?.waypoint) } : r;
    }
  }

  /** 停留所が占めるタイル(複数タイルの駅は全て) */
  private stopTiles(s: Stop): number[] {
    return s.station ? stationTiles(s.station).map(([x, y]) => this.map.idx(x, y)) : [s.idx];
  }

  private stopValid(s: Stop): boolean {
    if (!s.station) return this.tileValid(s.kind, s.idx);
    // 複数タイルの駅は、1タイルでも壊されたら駅全体が無効(全体を撤去する)
    return this.stopTiles(s).every((i) => (this.map.rail.get(i) & 0xf) !== 0 && (this.map.rail.get(i) & 0xf0) === 0);
  }

  /** 駅の「停車位置」候補: 番線ごとの両端タイル。1タイルの駅は自分自身 */
  private docks(s: Stop, trainTiles = 1): { a: number; b: number }[] {
    if (!s.station) return [{ a: s.idx, b: s.idx }];
    const st = s.station;
    // 編成の中央がホームの中央にくる位置で停まる(編成がホームより長ければ端まで)。
    // b: 添字が増える向きに進んで停まるときの先頭位置、a: 減る向きに進んで停まるときの先頭位置(対称)
    const hi = Math.min(st.len - 1, Math.max(0, Math.round((st.len - 1) / 2 + (trainTiles - 1) / 2)));
    const lo = st.len - 1 - hi;
    const out: { a: number; b: number }[] = [];
    for (let t = 0; t < st.tracks; t++) {
      const [ax, ay] = stationTile(st, t, lo);
      const [bx, by] = stationTile(st, t, hi);
      out.push({ a: this.map.idx(ax, ay), b: this.map.idx(bx, by) });
    }
    return out;
  }

  /** order i の次の「停車する」オーダーの添字(経由点を飛ばす) */
  private realAfter(route: Route, i: number): number {
    const n = route.orders.length;
    let j = (i + 1) % n;
    for (let g = 0; g < n && this.isWay(route, j); g++) j = (j + 1) % n;
    return j;
  }

  /** 停まらないオーダー(経由点、または通過に設定した駅) */
  private isWay(route: Route, i: number): boolean {
    return !!route.orders[i].pass || !!this.stops.get(route.orders[i].stopId)?.waypoint;
  }

  /**
   * 駅を新設する: (x0,y0) を左上に、番線数×ホーム長の範囲に線路を敷いて1つの停留所にする。
   * 置けなければ理由を返す。
   */
  addStation(x0: number, y0: number, opts: StationOptions): { stop?: Stop; reason?: string } {
    const m = this.map;
    const plan = planStation(m, x0, y0, opts, (i) => ['road', 'rail', 'air'].some((k) => this.stopAt.has(i * 3 + KIND_INDEX[k as Mode])));
    if (!plan.ok) return { reason: plan.reason };
    layStationTracks(m, plan.info);
    const info = plan.info;
    const [cx, cy] = stationTile(info, info.tracks >> 1, info.len >> 1);
    const [fx, fy] = stationTile(info, 0, 0);
    const id = this.nextId++;
    const stop: Stop = { id, name: '', kind: 'rail', idx: m.idx(fx, fy), x: cx, y: cy, waiting: 0, wait: new Map(), frac: 0, pop: 0, townId: 0, station: info, owner: this.actor || undefined };
    this.refreshCatchment(stop);
    const town = m.towns[stop.townId - 1];
    stop.name = `${town ? town.name : '郊外'}駅${id}`;
    this.stops.set(id, stop);
    for (const i of this.stopTiles(stop)) this.stopAt.set(i * 3 + KIND_INDEX.rail, id);
    this.touchNetwork(info.x0, info.y0, info.x0 + (info.axis === 1 ? info.len : info.tracks) - 1, info.y0 + (info.axis === 1 ? info.tracks : info.len) - 1);
    this.version++;
    return { stop };
  }

  /** 経由点を置く(直線の線路上。駅・他の経由点と重ならない)。置けなければ null */
  addWaypoint(x: number, y: number): Stop | null {
    const m = this.map;
    if (!m.inBounds(x, y)) return null;
    const idx = m.idx(x, y);
    if (!this.tileValid('rail', idx) || this.stopAtTile(x, y, 'rail')) return null;
    const id = this.nextId++;
    const stop: Stop = { id, name: `経由点${id}`, kind: 'rail', idx, x, y, waiting: 0, wait: new Map(), frac: 0, pop: 0, townId: 0, waypoint: true, owner: this.actor || undefined };
    this.stops.set(id, stop);
    this.stopAt.set(idx * 3 + KIND_INDEX.rail, id);
    this.version++;
    return stop;
  }

  private tileValid(kind: Mode, idx: number): boolean {
    const m = this.map;
    if (m.span.get(idx)) return false;
    return kind === 'road' ? m.road.get(idx) !== 0 : kind === 'rail' ? (m.rail.get(idx) & 0xf) !== 0 && (m.rail.get(idx) & 0xf0) === 0 : m.air.get(idx) === 3;
  }

  addStop(x: number, y: number, kind: Mode = 'road'): Stop | null {
    const m = this.map;
    if (!m.inBounds(x, y)) return null;
    if (kind === 'air') {
      const t = findTerminal(m, x, y);
      if (!t) return null;
      x = t.x;
      y = t.y;
    }
    const idx = m.idx(x, y);
    if (!this.tileValid(kind, idx)) return null;
    const ex = this.stopAtTile(x, y, kind);
    if (ex) return ex;
    const id = this.nextId++;
    const stop: Stop = { id, name: '', kind, idx, x, y, waiting: 0, wait: new Map(), frac: 0, pop: 0, townId: 0, owner: this.actor || undefined };
    this.refreshCatchment(stop);
    const town = m.towns[stop.townId - 1];
    stop.name = `${town ? town.name : '郊外'}${KIND_NAME[kind]}${id}`;
    this.stops.set(id, stop);
    this.stopAt.set(idx * 3 + KIND_INDEX[kind], id);
    this.version++;
    return stop;
  }

  removeStop(id: number): void {
    const s = this.stops.get(id);
    if (!s) return;
    if (s.station) {
      // 駅は全てのホーム線路ごと撤去する
      for (const [x, y] of stationTiles(s.station)) {
        for (let d = 0; d < 8; d++) disconnectRail(this.map, x, y, d);
        this.map.touch(x, y);
      }
    }
    this.stops.delete(id);
    for (const i of this.stopTiles(s)) this.stopAt.delete(i * 3 + KIND_INDEX[s.kind]);
    for (const r of this.routes.values()) {
      const before = r.orders.length;
      r.orders = r.orders.filter((o) => o.stopId !== id);
      if (r.orders.length !== before) this.dropVehicles((v) => v.routeId === r.id);
    }
    this.version++;
  }

  /** 会社単位の許可: 持ち主 → 停留所を使ってよい会社 */
  grants = new Map<number, Set<number>>();

  /** この会社が停留所を路線に使えるか(共用・自社・駅ごとの許可・会社単位の許可のどれか) */
  mayUse(s: Stop, who: number): boolean {
    return !s.owner || !who || s.owner === who || !!s.allow?.includes(who) || !!this.grants.get(s.owner)?.has(who);
  }

  addRoute(stopIds: number[]): Route | null {
    if (stopIds.length < 2) return null;
    if (this.actor && stopIds.some((id) => { const s = this.stops.get(id); return !s || !this.mayUse(s, this.actor); })) return null;
    const first = this.stops.get(stopIds[0]);
    if (!first || stopIds.some((id) => this.stops.get(id)?.kind !== first.kind)) return null;
    if (stopIds.filter((id) => !this.stops.get(id)?.waypoint).length < 2) return null;
    const id = this.nextId++;
    const mode = first.kind;
    const route: Route = {
      id,
      name: `${mode === 'road' ? 'バス' : mode === 'rail' ? '鉄道' : '航空'}${this.routes.size + 1}`,
      color: ROUTE_COLORS[this.routes.size % ROUTE_COLORS.length],
      mode,
      modelId: defaultModel(mode),
      period: DAY_TICKS,
      late: 0,
      carried: 0,
      orders: stopIds.map((stopId) => ({ stopId, kind: 'dwell', dwell: DEFAULT_DWELL[mode], maxWait: 300, departTod: 0 })),
      owner: this.actor || undefined,
    };
    this.routes.set(id, route);
    this.version++;
    return route;
  }

  removeRoute(id: number): void {
    this.routes.delete(id);
    this.dropVehicles((v) => v.routeId === id);
    this.version++;
  }

  private dropVehicles(pred: (v: Vehicle) => boolean): void {
    for (const v of this.vehicles) if (pred(v)) this.releaseAll(v.id);
    this.vehicles = this.vehicles.filter((v) => !pred(v));
  }

  private releaseAll(vid: number): void {
    for (const [k, val] of this.reserved) if (val === vid) this.reserved.delete(k);
    for (const [k, val] of this.lane) if (val === vid) this.lane.delete(k);
  }

  private laneKey(v: Vehicle): number {
    return v.path[Math.min(v.pi, v.path.length - 1)] * 4 + v.dir;
  }

  /** 路線の最初の停留所に車両を追加する(最初の停車後に出発)。置けなければ null */
  addVehicle(routeId: number, tick: number, offset = 0, opts: { modelId?: string; cars?: number; tile?: number } = {}): Vehicle | null {
    const route = this.routes.get(routeId);
    if (!route || route.orders.length < 2) return null;
    const first = this.isWay(route, 0) ? this.realAfter(route, 0) : 0;
    const stop = this.stops.get(route.orders[first].stopId);
    if (!stop) return null;
    const model = modelOf(opts.modelId ?? route.modelId);
    const cars = route.mode === 'rail' ? clampCars(model, opts.cars ?? route.cars ?? legacyCarsOf(route.modelId) ?? model.defaultCars) : 1;
    // 車両基地から出す場合の出発タイル(なければ最初の停留所)
    const tile = opts.tile ?? stop.idx;
    const id = this.nextId++;
    const v: Vehicle = {
      id,
      routeId,
      modelId: model.id,
      mode: route.mode,
      order: first,
      path: Uint32Array.of(tile),
      pi: 0,
      t: 0,
      state: 'load',
      arrived: tick,
      until: tick + route.orders[first].dwell,
      retryAt: 0,
      load: 0,
      cargo: new Map(),
      cap: model.cap * cars,
      speed: model.speed,
      trail: [],
      len: 1,
      flight: null,
      hx: 1,
      hy: 0,
      dir: 0,
      stuck: 0,
      offset,
      cars,
      hold: false,
      resTo: 0,
    };
    const o0 = route.orders[first];
    if (o0.kind === 'timed') {
      // 最初の停留所が時刻指定なら、次に来る発車予定まで待つ(過去の時刻には戻らない)
      const P = route.period;
      const m = ((((o0.departTod + offset - todOf(tick)) % P) + P) % P);
      v.until = Math.max(v.until, tick + m);
    }
    if (route.mode === 'road') {
      // 停留所タイルの空いている車線に置く
      const d = [0, 1, 2, 3].find((k) => !this.lane.has(tile * 4 + k));
      if (d === undefined) return null;
      v.dir = d;
      this.lane.set(tile * 4 + d, id);
    }
    if (route.mode === 'rail') {
      v.len = trainLen(v.cars);
      if (!this.spawnTrail(v, tile)) return null;
    }
    this.vehicles.push(v);
    if (opts.tile !== undefined) this.depart(v, route, tick, false); // 車両基地から最初の停留所へ
    this.version++;
    return v;
  }

  // ---------------------------------------------------------------- 車両基地(デポ)
  /** 車両基地: 道路・線路・空港のタイルに置き、そこから車両を購入して路線(=共有オーダー)に配属する */
  depots = new Map<number, Depot>();
  private depotAt = new Map<number, number>();

  depotAtTile(x: number, y: number): Depot | undefined {
    if (!this.map.inBounds(x, y)) return undefined;
    const id = this.depotAt.get(this.map.idx(x, y));
    return id === undefined ? undefined : this.depots.get(id);
  }

  /** 基地の種類はタイルで決まる: 道路 → バス / 直線の線路 → 鉄道 / 空港ターミナル → 航空 */
  addDepot(x: number, y: number): { depot?: Depot; reason?: string } {
    const m = this.map;
    if (!m.inBounds(x, y)) return { reason: '範囲外です' };
    const idx = m.idx(x, y);
    if (this.depotAt.has(idx)) return { reason: 'すでに車両基地があります' };
    if (m.span.get(idx)) return { reason: '橋・トンネルには置けません' };
    let kind: Mode | null = null;
    if (m.road.get(idx)) kind = 'road';
    else if ((m.rail.get(idx) & 0xf0) === 0 && ((m.rail.get(idx) & 15) === 5 || (m.rail.get(idx) & 15) === 10)) kind = 'rail';
    else if (m.air.get(idx) === 3) kind = 'air';
    if (!kind) return { reason: '道路・直線の線路・空港ターミナルの上に置いてください' };
    if (this.stopAtTile(x, y, kind)) return { reason: '停留所・駅と同じタイルには置けません' };
    const id = this.nextId++;
    const depot: Depot = { id, kind, idx, x, y, name: `${kind === 'road' ? 'バス' : kind === 'rail' ? '車両' : '格納'}基地${id}`, owner: this.actor || undefined };
    this.depots.set(id, depot);
    this.depotAt.set(idx, id);
    this.version++;
    return { depot };
  }

  removeDepot(id: number): void {
    const d = this.depots.get(id);
    if (!d) return;
    this.depots.delete(id);
    this.depotAt.delete(d.idx);
    this.version++;
  }

  private depotValid(d: Depot): boolean {
    const m = this.map;
    if (m.span.get(d.idx)) return false;
    if (d.kind === 'road') return m.road.get(d.idx) !== 0;
    if (d.kind === 'rail') return (m.rail.get(d.idx) & 15) !== 0;
    return m.air.get(d.idx) === 3;
  }

  /**
   * 車両基地から車両を購入する。路線のオーダーで運行する(同じ路線の車両はオーダーを共有する)。
   * 車種は路線の既定と違ってもよい。最初の停留所へ到達できなければ購入できない。
   */
  buyVehicle(depotId: number, routeId: number, modelId: string, cars: number, tick: number): { vehicle?: Vehicle; reason?: string } {
    const d = this.depots.get(depotId);
    const r = this.routes.get(routeId);
    if (!d || !r) return { reason: '車両基地または路線がありません' };
    const model = modelOf(modelId);
    if (r.mode !== d.kind || model.mode !== d.kind) return { reason: '車両基地・路線・車種の種類が一致しません' };
    const first = this.stops.get(r.orders[this.isWay(r, 0) ? this.realAfter(r, 0) : 0]?.stopId);
    if (!first) return { reason: '路線に停留所がありません' };
    if (d.kind !== 'air' && !this.route(d.idx, first.station ? this.docks(first)[0].a : first.idx, d.kind === 'rail')) return { reason: '車両基地から最初の停留所へ到達できません(線路・道路をつないでください)' };
    const v = this.addVehicle(routeId, tick, 0, { modelId, cars, tile: d.idx });
    return v ? { vehicle: v } : { reason: '基地の出口が塞がっているか、置けません(少し待って再度お試しください)' };
  }

  /** 路線の最初の停留所に最も近い、同種の車両基地 */
  nearestDepot(routeId: number): Depot | undefined {
    const r = this.routes.get(routeId);
    const s = r && this.stops.get(r.orders[0]?.stopId);
    if (!r || !s) return undefined;
    let best: Depot | undefined;
    let bd = Infinity;
    for (const d of this.depots.values()) {
      if (d.kind !== r.mode) continue;
      const dist = Math.hypot(d.x - s.x, d.y - s.y);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  /** 駅から線路を辿って編成の占有タイルを確保する */
  private spawnTrail(v: Vehicle, start: number): boolean {
    const m = this.map;
    const s = m.size;
    if (this.reserved.has(start)) return false;
    const trail = [start];
    while (trail.length < v.len) {
      const cur = trail[trail.length - 1];
      let next = -1;
      for (let d = 0; d < 8 && next < 0; d++) {
        if (!(m.rail.get(cur) & CONN(d))) continue;
        const n = ((Math.floor(cur / s)) + DY8[d]) * s + (cur % s) + DX8[d];
        if (!trail.includes(n) && !this.reserved.has(n)) next = n;
      }
      if (next < 0) break;
      trail.push(next);
    }
    v.trail = trail;
    for (const t of trail) this.reserved.set(t, v.id);
    return true;
  }

  /** 停留所 i → 次の停留所 の走行見込み時間(tick)。経路がなければ null */
  legTicks(route: Route, i: number): number | null {
    const a = this.stops.get(route.orders[i].stopId);
    const j = this.realAfter(route, i);
    const b = this.stops.get(route.orders[j].stopId);
    if (!a || !b) return null;
    const speed = modelOf(route.modelId).speed;
    if (route.mode === 'air') return Math.hypot(a.x - b.x, a.y - b.y) / speed + 40; // 離着陸ぶん
    // 経由点を通る経路: a → 経由点… → b
    const tiles = [a.idx];
    for (let k = (i + 1) % route.orders.length; k !== j; k = (k + 1) % route.orders.length) tiles.push(this.stops.get(route.orders[k].stopId)!.idx);
    tiles.push(b.idx);
    let len = 0;
    for (let q = 0; q + 1 < tiles.length; q++) {
      const p = this.route(tiles[q], tiles[q + 1], route.mode === 'rail');
      if (!p) return null;
      len += p.length - 1;
      if (route.mode === 'rail') for (let k = 0; k + 1 < p.length; k++) if (dirBetween(p[k], p[k + 1], this.map.size) >= 4) len += Math.SQRT2 - 1;
    }
    return len / speed;
  }

  /**
   * 停留所の発車案内: この停留所に停まる各路線について、次に来る(停車中の)車両ごとの到着/発車までの tick を返す。
   * 見込みは走行時間(legTicks)と停車時間の積算で、渋滞などは反映しない。
   */
  departures(stopId: number, tick: number): Departure[] {
    const out: Departure[] = [];
    for (const route of this.routes.values()) {
      const n = route.orders.length;
      if (!route.orders.some((o, i) => o.stopId === stopId && !this.isWay(route, i)) || this.stops.get(stopId)?.waypoint) continue;
      for (const v of this.vehicles) {
        if (v.routeId !== route.id || v.hold) continue;
        const cur = v.order;
        const target = route.orders[cur];
        if (!target) continue;
        const nextName = (i: number) => this.stops.get(route.orders[this.realAfter(route, i)].stopId)?.name ?? '?';
        if (v.state === 'load' && target.stopId === stopId) {
          out.push({ routeId: route.id, vehicleId: v.id, eta: 0, stopped: true, leaveIn: Math.max(0, v.until - tick), toward: nextName(cur) });
          continue;
        }
        // 現在の位置から次のオーダー到着までの残り
        let acc: number;
        let idx: number; // 次に到着するオーダー
        if (v.state === 'load') {
          acc = Math.max(0, v.until - tick);
          const leg = this.legTicks(route, cur);
          if (leg === null) continue;
          acc += leg;
          idx = this.realAfter(route, cur);
        } else if (v.state === 'move') {
          if (v.mode === 'air' && v.flight) acc = Math.max(0, (v.flight.dist - v.flight.done) / v.speed);
          else acc = Math.max(0, v.path.length - 1 - v.pi - v.t) / v.speed;
          idx = cur;
        } else continue;
        for (let k = 0; k < n; k++) {
          if (route.orders[idx].stopId === stopId) {
            out.push({ routeId: route.id, vehicleId: v.id, eta: acc, stopped: false, leaveIn: 0, toward: nextName(idx) });
            break;
          }
          const leg = this.legTicks(route, idx);
          if (leg === null) break;
          acc += route.orders[idx].dwell + leg;
          idx = this.realAfter(route, idx);
        }
      }
    }
    return out.sort((a, b) => a.eta - b.eta);
  }

  /** 時刻表(時刻指定オーダー)の次の発車: 路線ごとに最大 count 件、(現在から何tick後か) */
  timetable(stopId: number, tick: number, count = 3): { routeId: number; etas: number[] }[] {
    const res: { routeId: number; etas: number[] }[] = [];
    for (const route of this.routes.values()) {
      const o = route.orders.find((x) => x.stopId === stopId && x.kind === 'timed' && !x.pass);
      if (!o) continue;
      const P = route.period;
      const first = (((o.departTod - todOf(tick)) % P) + P) % P;
      res.push({ routeId: route.id, etas: Array.from({ length: count }, (_, i) => first + i * P) });
    }
    return res;
  }

  /** 走行時間から時刻表を自動作成する(全オーダーを時刻指定にし、周期を決める)。失敗したら false */
  autoTimetable(routeId: number, startTod: number): boolean {
    const route = this.routes.get(routeId);
    if (!route) return false;
    const n = route.orders.length;
    const legs: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.isWay(route, i)) {
        legs.push(0);
        continue;
      }
      const l = route.legMeasured?.[i] ?? this.legTicks(route, i); // 実測があればそれを使う
      if (l === null || l === undefined) return false;
      legs.push(l);
    }
    const unit = DAY_TICKS / 1440; // 1分
    let t = startTod;
    let cycle = 0;
    for (let i = 0; i < n; i++) {
      if (this.isWay(route, i)) continue;
      const o = route.orders[i];
      o.kind = 'timed';
      o.departTod = Math.round((t % DAY_TICKS) / unit) * unit;
      const leg = legs[i] * 1.15 + unit; // 余裕15%+1分
      const step = leg + o.dwell;
      t += step;
      cycle += step;
    }
    const fit = PERIOD_OPTIONS.filter(([, v]) => v >= cycle * 1.05).map(([, v]) => v);
    route.period = fit.length ? Math.min(...fit) : DAY_TICKS;
    this.version++;
    return true;
  }

  /**
   * 種別を設定し、停車駅を自動で選ぶ: 始発・折り返し(最も遠い駅)は必ず停車、途中駅は人口の多い駅・番線の多い駅を優先して残し、残りを通過にする。
   * 時刻表があれば走行時間から組み直す。普通(0)は全駅停車に戻す。
   */
  applyRank(routeId: number, rank: number): boolean {
    const r = this.routes.get(routeId);
    if (!r || rank < 0 || rank >= RANKS.length) return false;
    // 通過に設定済みの駅も対象にするため、経由点でない全オーダーを候補にする
    const cand = r.orders.map((o, i) => (this.stops.get(o.stopId)?.waypoint ? -1 : i)).filter((i) => i >= 0);
    const ids = [...new Set(cand.map((i) => r.orders[i].stopId))];
    if (ids.length < 2) return false;
    const first = this.stops.get(r.orders[cand[0]].stopId)!;
    let far = ids[ids.length - 1];
    let fd = -1;
    for (const id of ids) {
      const s = this.stops.get(id)!;
      const d = Math.hypot(s.x - first.x, s.y - first.y);
      if (d > fd) {
        fd = d;
        far = id;
      }
    }
    const must = new Set([first.id, far]);
    const mid = ids.filter((id) => !must.has(id));
    const score = (id: number) => {
      const s = this.stops.get(id)!;
      return s.pop + (s.fpop ?? 0) + (s.station && s.station.tracks >= 2 ? 100000 : 0);
    };
    const keepN = rank === 0 ? mid.length : Math.ceil(mid.length * RANKS[rank].keep);
    const keep = new Set([...mid].sort((a, b) => score(b) - score(a)).slice(0, keepN));
    const firstTimed = r.orders.find((o, i) => o.kind === 'timed' && !this.isWay(r, i));
    for (const o of r.orders) {
      if (this.stops.get(o.stopId)?.waypoint) continue;
      o.pass = must.has(o.stopId) || keep.has(o.stopId) ? undefined : true;
    }
    r.rank = rank;
    r.legMeasured = undefined;
    if (firstTimed && r.orders.some((o) => o.kind === 'timed')) this.autoTimetable(r.id, firstTimed.departTod);
    this.syncOrders(r.id);
    this.version++;
    return true;
  }

  /**
   * 車両がこの先に辿る経路の予定(表示用)。現在向かっている/停車中の停留所から、次の停車駅へ最大 maxLegs 区間。
   * 鉄道は途中の経由点・通過駅を順に通る。各区間はタイル index の列。航空は空
   */
  planAhead(vehicleId: number, maxLegs = 3): { legs: number[][]; stops: number[] } | null {
    const v = this.vehicles.find((x) => x.id === vehicleId);
    const route = v && this.routes.get(v.routeId);
    if (!v || !route) return null;
    if (v.mode === 'air') return { legs: [], stops: [] };
    const n = route.orders.length;
    const legs: number[][] = [];
    const stops: number[] = [];
    let cur = v.order;
    let total = 0;
    for (let k = 0; k < maxLegs && total < 4000; k++) {
      const from = this.stops.get(route.orders[cur]?.stopId);
      if (!from) break;
      const tiles = [from.idx];
      let next = (cur + 1) % n;
      for (let g = 0; g < n; g++) {
        const w = this.stops.get(route.orders[next].stopId);
        if (!w || !this.isWay(route, next)) break;
        if (v.mode === 'rail') tiles.push(w.idx);
        next = (next + 1) % n;
      }
      const dest = this.stops.get(route.orders[next].stopId);
      if (!dest || next === cur) break;
      tiles.push(dest.idx);
      const leg: number[] = [];
      let ok = true;
      for (let q = 0; q + 1 < tiles.length; q++) {
        const p = this.route(tiles[q], tiles[q + 1], v.mode === 'rail');
        if (!p) {
          ok = false;
          break;
        }
        for (let i = leg.length ? 1 : 0; i < p.length; i++) leg.push(p[i]);
      }
      if (!ok) break;
      legs.push(leg);
      stops.push(next);
      total += leg.length;
      cur = next;
    }
    return { legs, stops };
  }

  /** 路線を複製する。reverse=逆向き(オーダーを逆順に)、shiftTicks=時刻表をずらす量。車両は複製しない */
  cloneRoute(routeId: number, reverse: boolean, shiftTicks: number): Route | null {
    const src = this.routes.get(routeId);
    if (!src) return null;
    const id = this.nextId++;
    const list = reverse ? [...src.orders].reverse() : src.orders;
    const copy: Route = {
      ...src,
      id,
      name: `${src.name}${reverse ? '(逆)' : shiftTicks ? `(+${Math.round(shiftTicks / (DAY_TICKS / 1440))}分)` : '(複製)'}`,
      color: ROUTE_COLORS[this.routes.size % ROUTE_COLORS.length],
      orders: list.map((o) => ({ ...o, cond: undefined, departTod: o.kind === 'timed' ? (((o.departTod + shiftTicks) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS : o.departTod })),
      shared: undefined,
      late: 0,
      carried: 0,
      legMeasured: undefined,
      dayRevenue: 0,
      income: 0,
      profit: 0,
      vs: undefined,
      legs: undefined,
      owner: this.actor || undefined,
    };
    this.routes.set(id, copy);
    if (reverse && copy.orders.some((o) => o.kind === 'timed')) {
      // 逆向きの時刻表は、元の最後の発車の少しあとから、走行時間で組み直す
      const last = [...src.orders].reverse().find((o) => o.kind === 'timed');
      if (last) this.autoTimetable(id, last.departTod + last.dwell + 5 * (DAY_TICKS / 1440) + shiftTicks);
    }
    this.version++;
    return copy;
  }

  /** ダイヤ画面用: 路線のオーダーごとの次の停車駅までの走行時間(実測があれば実測)。時刻指定がなければ空 */
  legsOf(route: Route): number[] {
    return route.orders.map((_, i) => (this.isWay(route, i) ? 0 : (route.legMeasured?.[i] ?? this.legTicks(route, i) ?? 0)));
  }

  removeVehicle(id: number): void {
    this.releaseAll(id);
    this.vehicles = this.vehicles.filter((v) => v.id !== id);
    this.version++;
  }

  /** 集客圏の人口と所属する街を数え直す */
  private refreshCatchment(s: Stop): void {
    const m = this.map;
    const R = CATCH[s.kind];
    let pop = 0;
    let best = 0;
    let bestPop = 0;
    const byTown = new Map<number, number>();
    for (let y = s.y - R; y <= s.y + R; y++) {
      for (let x = s.x - R; x <= s.x + R; x++) {
        if (!m.inBounds(x, y)) continue;
        const i = m.idx(x, y);
        const b = m.building.get(i);
        if (!b) continue;
        const tid = m.owner.get(i);
        const p = POP_PER_LEVEL[b & 3] * popMul(m.towns[tid - 1]);
        pop += p;
        const sum = (byTown.get(tid) ?? 0) + p;
        byTown.set(tid, sum);
        if (sum > bestPop) {
          bestPop = sum;
          best = tid;
        }
      }
    }
    s.pop = pop;
    if (best) s.townId = best;
    // 大型施設(スタジアム・遊園地など)の需要
    const near = facilitiesNear(m, s.x, s.y, R);
    s.facs = near.map((f) => f.id);
    s.fpop = near.reduce((a, f) => a + facilityAttract(f), 0);
  }

  /** 時刻に応じた施設の需要(人口換算)。施設ごとに人の集まる時間帯がある */
  private dayMulDay = -1;
  private dayMul = new Map<number, number>();
  private facilityDemand(s: Stop, tick: number): number {
    if (!s.facs || !s.facs.length) return 0;
    const hour = (todOf(tick) / DAY_TICKS) * 24;
    const day = Math.floor((tick + START_TOD) / DAY_TICKS);
    if (this.dayMulDay !== day) {
      this.dayMulDay = day;
      this.dayMul.clear();
    }
    let d = 0;
    for (const id of s.facs) {
      const f = this.map.facilities.find((x) => x.id === id);
      if (f) {
        let mul = this.dayMul.get(id);
        if (mul === undefined) this.dayMul.set(id, (mul = facilityDayMul(this.map.seed, f, day)));
        d += facilityAttract(f) * hourFactor(FACILITY_SPECS[f.type], hour) * mul;
      }
    }
    return d;
  }

  private credit(stop: Stop, n: number): void {
    const t = this.map.towns[stop.townId - 1];
    if (t) t.pax += n;
  }

  step(tick: number): void {
    const m = this.map;

    if (this.stopListVer !== this.version) {
      this.stopList = [...this.stops.values()];
      this.stopListVer = this.version;
    }
    for (const s of this.stopList) {
      if (!this.stops.has(s.id)) continue;
      if (tick % 100 === s.id % 100 || (s.station && tick % 10 === 0)) {
        if (!this.stopValid(s)) {
          this.removeStop(s.id);
          continue;
        }
        if (!s.waypoint && tick % 100 === s.id % 100) this.refreshCatchment(s);
      }
      if (s.waypoint) continue;
      if (tick % 100 === (s.id + 50) % 100) this.purgeUnreachable(s);
      if ((tick + s.id) % GEN_EVERY === 0 && !(s.owner && this.frozen.has(s.owner))) this.generate(s, tick);
    }
    if (tick % 100 === 7) for (const d of [...this.depots.values()]) if (!this.depotValid(d)) this.removeDepot(d.id);
    if (tick % DAY_TICKS === 0) for (const t of m.towns) t.pax *= 0.85;

    let removed = false;
    for (const v of this.vehicles) {
      const route = this.routes.get(v.routeId);
      if (!route) continue;
      if (route.owner && this.frozen.has(route.owner)) continue; // 持ち主が切断中: そのまま止める
      if (v.state === 'load') this.stepLoad(v, route, tick);
      else if (v.state === 'noroute') {
        if (tick >= v.retryAt) this.depart(v, route, tick, false);
      } else if (v.mode === 'air' ? !this.stepAir(v, route, tick) : v.mode === 'rail' ? !this.stepRail(v, route, tick) : !this.stepRoad(v, route, tick)) {
        removed = true;
      }
    }
    if (removed) {
      for (const v of this.vehicles) if (v.cap <= 0) this.releaseAll(v.id);
      this.vehicles = this.vehicles.filter((v) => v.cap > 0);
      this.version++;
    }
  }

  /** 目的地を選んで乗客を発生させる(路線に接続された停留所のみ) */
  private fareDemandVer = -1;
  private fareDemandBy = new Map<number, number>();
  /** 停留所に停まる路線の運賃から決まる需要の倍率(路線の平均。構造が変わったときだけ作り直す) */
  private stopFareDemand(stopId: number): number {
    if (this.fareDemandVer !== this.version) {
      const sum = new Map<number, { s: number; n: number }>();
      for (const r of this.routes.values()) {
        const d = fareDemand(fareMulOf(r));
        for (const id of new Set(r.orders.map((o) => o.stopId))) {
          const e = sum.get(id) ?? { s: 0, n: 0 };
          e.s += d;
          e.n++;
          sum.set(id, e);
        }
      }
      this.fareDemandBy.clear();
      for (const [id, e] of sum) this.fareDemandBy.set(id, e.s / e.n);
      this.fareDemandVer = this.version;
    }
    return this.fareDemandBy.get(stopId) ?? 1;
  }

  private generate(s: Stop, tick: number): void {
    const tbl = this.router.table(s.id, this.version);
    if (tbl.next.size === 0) return;
    const n = (s.pop + this.facilityDemand(s, tick)) * PAX_RATE * GEN_EVERY * this.stopFareDemand(s.id) * (this.serviceMul?.(s.owner) ?? 1) * (1 + DEV.demandUp * (s.dev ?? 0)) + s.frac;
    const whole = Math.floor(n);
    s.frac = n - whole;
    const room = WAIT_CAP[s.kind] - s.waiting;
    if (whole < 1 || room < 1) return;
    const total = Math.min(whole, Math.floor(room));
    const { dests, cum } = tbl;
    const sum = cum[cum.length - 1];
    const picks = Math.min(3, dests.length);
    for (let k = 0; k < picks; k++) {
      const r = this.rng() * sum;
      // 累積重みを二分探索
      let lo = 0;
      let hi = dests.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] > r) hi = mid;
        else lo = mid + 1;
      }
      const cnt = Math.floor(total / picks) + (k === 0 ? total % picks : 0);
      if (cnt > 0) this.addWaiting(s, dests[lo], cnt);
    }
  }

  private addWaiting(s: Stop, dest: number, n: number): void {
    s.wait.set(dest, (s.wait.get(dest) ?? 0) + n);
    s.waiting += n;
  }

  /** 路線変更で行けなくなった目的地の乗客を取り除く */
  private purgeUnreachable(s: Stop): void {
    const tbl = this.router.table(s.id, this.version);
    for (const [d, n] of s.wait) {
      if (!tbl.next.has(d)) {
        s.wait.delete(d);
        s.waiting -= n;
      }
    }
  }

  private stepLoad(v: Vehicle, route: Route, tick: number): void {
    if (v.hold) return; // 分割で切り離された待機編成
    const order = route.orders[v.order];
    const stop = order && this.stops.get(order.stopId);
    if (!stop) return;
    // この路線に乗るべき乗客を乗せる
    if (v.load < v.cap && stop.waiting >= 1) {
      const tbl = this.router.table(stop.id, this.version);
      let boarded = 0;
      for (const [d, n] of stop.wait) {
        if (tbl.next.get(d) !== route.id) continue;
        const take = Math.min(n, v.cap - v.load - boarded);
        if (take <= 0) break;
        v.cargo.set(d, (v.cargo.get(d) ?? 0) + take);
        if (take === n) stop.wait.delete(d);
        else stop.wait.set(d, n - take);
        boarded += take;
      }
      if (boarded > 0) {
        this.onFare?.(v.mode, boarded * FARE[v.mode].base * fareMulOf(route), v.routeId); // 乗車時の基本運賃
        stop.traffic = (stop.traffic ?? 0) + boarded;
        v.load += boarded;
        stop.waiting -= boarded;
        this.credit(stop, boarded);
      }
    }
    const minDone = tick >= v.arrived + order.dwell;
    let ready = tick >= v.until;
    if (order.kind === 'full') ready = minDone && (v.load >= v.cap || tick >= v.arrived + order.maxWait);
    if (ready) this.depart(v, route, tick, true);
  }

  /** 条件付きオーダーの条件が成り立つか */
  private condHolds(v: Vehicle, route: Route, c: OrderCond, tick: number): boolean {
    let x: number;
    if (c.kind === 'load') x = v.cap > 0 ? (v.load / v.cap) * 100 : 0;
    else if (c.kind === 'wait') x = this.stops.get(route.orders[v.order].stopId)?.waiting ?? 0;
    else x = (todOf(tick) / DAY_TICKS) * 1440;
    return c.op === 'ge' ? x >= c.value : x < c.value;
  }

  // ---------------------------------------------------------------- オーダーの編集(挿入・削除・並べ替え)
  /** 同じ共有グループの路線(共有していなければ自分だけ) */
  private groupOf(r: Route): Route[] {
    return r.shared === undefined ? [r] : [...this.routes.values()].filter((x) => x.shared === r.shared);
  }

  /** オーダー番号の付け替え(old → new。undefined なら条件の飛び先を無効にする)を、路線の車両と条件に適用 */
  private remapOrders(r: Route, f: (i: number) => number | undefined): void {
    for (const o of r.orders) {
      if (!o.cond) continue;
      const to = f(o.cond.to);
      if (to === undefined) o.cond = undefined;
      else o.cond.to = to;
    }
    for (const v of this.vehicles) if (v.routeId === r.id) v.order = f(v.order) ?? v.order;
  }

  /** index の位置に停留所のオーダーを挿入する(0..n。共有している路線にも同じ操作) */
  insertOrder(routeId: number, index: number, stopId: number): { ok: boolean; reason?: string } {
    const r = this.routes.get(routeId);
    const s = this.stops.get(stopId);
    if (!r || !s) return { ok: false, reason: '路線または停留所がありません' };
    if (s.kind !== r.mode) return { ok: false, reason: '種別の違う停留所は追加できません' };
    if (this.actor && !this.mayUse(s, this.actor)) return { ok: false, reason: '他社の停留所は、持ち主の許可がないと使えません' };
    index = Math.max(0, Math.min(r.orders.length, index));
    for (const g of this.groupOf(r)) {
      g.orders.splice(index, 0, { stopId, kind: 'dwell', dwell: DEFAULT_DWELL[g.mode], maxWait: 300, departTod: 0 });
      // 挿入位置以降の番号をずらす(挿入した新オーダー自身は除く)
      this.remapOrders(g, (i) => (i >= index ? i + 1 : i));
      g.legMeasured = undefined;
    }
    this.version++;
    return { ok: true };
  }

  /** index のオーダーを削除する。そのオーダーに向かう/停車中の車両がいる、または停車駅が2つ未満になるなら不可 */
  removeOrder(routeId: number, index: number): { ok: boolean; reason?: string } {
    const r = this.routes.get(routeId);
    if (!r || index < 0 || index >= r.orders.length) return { ok: false, reason: 'オーダーがありません' };
    const real = r.orders.filter((_o, i) => i !== index && !this.isWay(r, i)).length;
    if (real < 2) return { ok: false, reason: '停車する停留所が2つ未満になります' };
    const group = this.groupOf(r);
    if (this.vehicles.some((v) => group.some((g) => g.id === v.routeId) && v.order === index)) return { ok: false, reason: 'このオーダーへ向かう/停車中の車両がいるため、今は削除できません' };
    for (const g of group) {
      g.orders.splice(index, 1);
      this.remapOrders(g, (i) => (i === index ? undefined : i > index ? i - 1 : i));
      for (const v of this.vehicles) if (v.routeId === g.id && v.order >= g.orders.length) v.order = 0;
      g.legMeasured = undefined;
    }
    this.version++;
    return { ok: true };
  }

  /** index のオーダーを dir(-1=前 / +1=後)へ動かす */
  moveOrder(routeId: number, index: number, dir: -1 | 1): { ok: boolean; reason?: string } {
    const r = this.routes.get(routeId);
    const j = index + dir;
    if (!r || index < 0 || index >= r.orders.length || j < 0 || j >= r.orders.length) return { ok: false, reason: 'これ以上動かせません' };
    for (const g of this.groupOf(r)) {
      [g.orders[index], g.orders[j]] = [g.orders[j], g.orders[index]];
      this.remapOrders(g, (i) => (i === index ? j : i === j ? index : i));
      g.legMeasured = undefined;
    }
    this.version++;
    return { ok: true };
  }

  /** 路線のオーダーを共有する: 同じオーダー・周期の新しい路線を作り、共有グループに入れる */
  shareRoute(routeId: number): Route | null {
    const src = this.routes.get(routeId);
    if (!src) return null;
    const group = src.shared ?? src.id;
    src.shared = group;
    const id = this.nextId++;
    const copy: Route = {
      ...src,
      id,
      name: `${src.name}(共有)`,
      color: ROUTE_COLORS[this.routes.size % ROUTE_COLORS.length],
      orders: src.orders.map((o) => ({ ...o, cond: o.cond ? { ...o.cond } : undefined })),
      shared: group,
      late: 0,
      carried: 0,
      owner: this.actor || undefined,
    };
    this.routes.set(id, copy);
    this.version++;
    return copy;
  }

  /** 共有を解除する(オーダーは今の内容のまま独立) */
  unshareRoute(routeId: number): void {
    const r = this.routes.get(routeId);
    if (!r || r.shared === undefined) return;
    const group = r.shared;
    r.shared = undefined;
    const rest = [...this.routes.values()].filter((x) => x.shared === group);
    if (rest.length === 1) rest[0].shared = undefined;
    this.version++;
  }

  /** この路線のオーダー・周期を、共有している他の路線へ反映する(編集のたびに呼ぶ) */
  syncOrders(routeId: number): void {
    const src = this.routes.get(routeId);
    if (!src || src.shared === undefined) return;
    for (const r of this.routes.values()) {
      if (r.id === src.id || r.shared !== src.shared) continue;
      r.orders = src.orders.map((o) => ({ ...o, cond: o.cond ? { ...o.cond } : undefined }));
      r.period = src.period;
    }
    this.version++;
  }

  /** 次のオーダーへ向けて出発(経路がなければ noroute) */
  private depart(v: Vehicle, route: Route, tick: number, advance: boolean): void {
    this.departInner(v, route, tick, advance, route.orders.length);
  }

  private departInner(v: Vehicle, route: Route, tick: number, advance: boolean, n: number): void {
    if (advance) {
      v.from = v.order;
      v.departedAt = tick;
    }
    let next = advance ? (v.order + 1) % n : v.order;
    // 条件付きオーダー: 出発時に条件を満たしたら、指定のオーダーへ進む
    if (advance) {
      const c = route.orders[v.order]?.cond;
      if (c && c.to >= 0 && c.to < n && c.to !== v.order && this.condHolds(v, route, c, tick)) next = c.to;
    }
    // 鉄道: 途中の経由点は停まらず通過する目印。経由点のタイルを順に通る経路にする
    const vias: number[] = [];
    for (let g = 0; g < n; g++) {
      const w = this.stops.get(route.orders[next].stopId);
      if (!w || !this.isWay(route, next)) break;
      if (v.mode === 'rail') vias.push(w.idx); // 鉄道は通過する駅・経由点のタイルを順に通る(道路・航空の通過は飛ばすだけ)
      next = (next + 1) % n;
    }
    const dest = this.stops.get(route.orders[next].stopId);
    if (!dest || this.isWay(route, next)) return;
    v.order = next;
    if (v.mode === 'air') this.departAir(v, dest, route, tick);
    else if (v.mode === 'rail') this.departRail(v, dest, route, tick, vias);
    else this.departRoad(v, dest, route, tick);
  }

  /** 経路探索(結果をキャッシュ。使用時は各辺がまだ通れるか検査し、駄目なら探索し直す) */
  private route(from: number, to: number, rail: boolean): Uint32Array | null {
    const m = this.map;
    const s = m.size;
    const key = `${from}:${to}`;
    const ce = this.pathCache.get(key);
    if (ce && !this.pathAffected(ce)) {
      if (ce.p === null) {
        ce.gen = this.netGen; // 到達できない結果も、関係する変更がなければ使い回す(同じ探索を繰り返さない)
        return null;
      }
      const c = ce.p;
      let ok = true;
      const layer = rail ? m.rail : m.road;
      for (let i = 0; i + 1 < c.length && ok; i++) {
        const d = dirBetween(c[i], c[i + 1], s);
        ok = d >= 0 && (layer.get(c[i]) & (rail ? CONN(d) : OUT(d))) !== 0 && (layer.get(c[i + 1]) & CONN(opposite8(d))) !== 0;
        if (ok && rail && this.signals.size && d < 8) {
          const mk = this.signalMask(c[i + 1]);
          if (mk && !(mk & (1 << d))) ok = false; // 一方向の信号を逆走する経路は不可
        }
      }
      if (ok) {
        ce.gen = this.netGen;
        this.pathCache.delete(key);
        this.pathCache.set(key, ce); // 最近使った印(LRU)
        return c;
      }
    }
    const p = findPath(m, from, to, rail, 300000, rail && this.signals.size ? (i) => this.signalMask(i) : undefined);
    const fx = from % s;
    const fy = Math.floor(from / s);
    const tx = to % s;
    const ty = Math.floor(to / s);
    let bx0 = Math.min(fx, tx);
    let by0 = Math.min(fy, ty);
    let bx1 = Math.max(fx, tx);
    let by1 = Math.max(fy, ty);
    if (p) {
      for (let i = 0; i < p.length; i++) {
        const x = p[i] % s;
        const y = Math.floor(p[i] / s);
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    } else {
      // 到達できなかった記録は、始点・終点の周囲(探索が広がった範囲)の変更で探し直す
      bx0 -= 60;
      by0 -= 60;
      bx1 += 60;
      by1 += 60;
    }
    this.pathCache.delete(key);
    this.pathCache.set(key, { p, gen: this.netGen, bx0, by0, bx1, by1 });
    if (this.pathCache.size > this.pathCacheMax) {
      let n = Math.max(1, Math.floor(this.pathCacheMax / 10));
      for (const k of this.pathCache.keys()) {
        if (n-- <= 0) break;
        this.pathCache.delete(k);
      }
    }
    return p;
  }

  private blocked(v: Vehicle, tick: number, wait: number): void {
    v.state = 'noroute';
    v.retryAt = tick + wait;
    v.stuck += wait;
  }

  private departRoad(v: Vehicle, dest: Stop, route: Route, tick: number): void {
    const from = v.path[Math.min(v.pi, v.path.length - 1)];
    const path = this.route(from, dest.idx, false);
    if (!path) return this.blocked(v, tick, 30);
    v.path = path;
    v.pi = 0;
    v.t = 0;
    v.stuck = 0;
    v.state = 'move';
    if (path.length === 1) this.arrive(v, route, tick);
  }

  /**
   * 鉄道の出発経路の候補(短い順)。経由点を順に通り、最後は駅の番線(両端のうち進行方向の奥側)まで。
   * 折り返し(来た線路へ戻る)になる経路は除く。見つからなければ空。
   */
  private railCandidates(v: Vehicle, vias: number[], dest: Stop): number[][] {
    let cur = v.trail[0];
    let prev = v.trail.length > 1 ? v.trail[1] : -1;
    const base: number[] = [cur];
    for (const w of vias) {
      if (w === cur) continue;
      const seg = this.route(cur, w, true);
      if (!seg || (seg.length > 1 && seg[1] === prev)) return [];
      for (let i = 1; i < seg.length; i++) base.push(seg[i]);
      prev = base.length > 1 ? base[base.length - 2] : -1;
      cur = w;
    }
    const out: number[][] = [];
    for (const { a, b } of this.docks(dest, v.len)) {
      const toward = (to: number): Uint32Array | null => {
        const p = to === cur ? Uint32Array.of(cur) : this.route(cur, to, true);
        return p && !(p.length > 1 && p[1] === prev) ? p : null;
      };
      const pa = toward(a);
      const pb = a === b ? pa : toward(b);
      let pick: Uint32Array | null;
      if (pa && pb && a !== b) pick = pb.includes(a) ? pb : pa.includes(b) ? pa : pa.length <= pb.length ? pa : pb;
      else pick = pa ?? pb;
      if (pick) out.push([...base.slice(0, -1), ...pick]);
    }
    return out.sort((x, y) => x.length - y.length);
  }

  private departRail(v: Vehicle, dest: Stop, route: Route, tick: number, vias: number[] = []): void {
    const build = (): number[][] => {
      let c = this.railCandidates(v, vias, dest);
      if (!c.length && vias.length) c = this.railCandidates(v, [], dest); // 経由できなければ直行
      return c;
    };
    let cands = build();
    if (v.trail.length > 1) {
      // 進行方向が逆: 編成を折り返す(尾が頭になる)。前進する経路がない場合に加え、前進が大回り(ループ線など)で
      // 折り返したほうがずっと近いときも、停車駅で折り返す(運転士が反対の先頭へ移る)
      const fwd = cands.length ? cands[0].length : Infinity;
      if (fwd > REVERSE_MIN_TILES) {
        v.trail.reverse();
        const rev = build();
        if (rev.length && rev[0].length * REVERSE_RATIO < fwd) cands = rev;
        else v.trail.reverse();
      }
    }
    if (!cands.length) return this.blocked(v, tick, 30);
    // 前方の閉塞を予約する(信号がなければ経路全体。他の編成と衝突・正面衝突しない)。番線は空いている候補を順に試す
    for (const c of cands) {
      v.path = Uint32Array.from(c);
      v.resTo = 0;
      if (!this.extendReservation(v)) continue;
      v.pi = 0;
      v.t = 0;
      v.stuck = 0;
      v.sf = 0.3; // 発車は低速から加速
      v.state = 'move';
      if (v.path.length === 1) this.arrive(v, route, tick);
      return;
    }
    v.path = Uint32Array.of(v.trail[0]);
    this.blocked(v, tick, 10);
  }

  private departAir(v: Vehicle, dest: Stop, route: Route, tick: number): void {
    const s = this.map.size;
    const from = v.path[0];
    const x0 = (from % s) + 0.5;
    const y0 = (Math.floor(from / s)) + 0.5;
    const x1 = dest.x + 0.5;
    const y1 = dest.y + 0.5;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (dist < 1) return this.arrive(v, route, tick);
    v.flight = { x0, y0, x1, y1, dist, done: 0 };
    v.hx = (x1 - x0) / dist;
    v.hy = (y1 - y0) / dist;
    v.state = 'move';
  }

  private stepAir(v: Vehicle, route: Route, tick: number): boolean {
    const f = v.flight;
    if (!f) {
      v.state = 'load';
      return true;
    }
    f.done += v.speed;
    if (f.done >= f.dist) {
      const dest = this.stops.get(route.orders[v.order].stopId);
      v.path = Uint32Array.of(dest ? dest.idx : v.path[0]);
      v.flight = null;
      this.arrive(v, route, tick);
    }
    return true;
  }

  /** @returns 車両が生存していれば true */
  /**
   * 通る線路が変更されたので、いまのタイルから目的地までの経路を探し直すか。印を消して true を返す。
   * 目的地の手前に経由点がある区間は、経由点を保つため探し直さない(次の出発で反映)。
   */
  private takeReplan(v: Vehicle, route: Route): boolean {
    if (!v.replan) return false;
    v.replan = false;
    const n = route.orders.length;
    if (this.isWay(route, (v.order - 1 + n) % n)) return false;
    return true;
  }

  private stepRoad(v: Vehicle, route: Route, tick: number): boolean {
    const m = this.map;
    const s = m.size;
    v.t += v.speed;
    while (v.t >= 1 && v.pi < v.path.length - 1) {
      const cur0 = v.path[v.pi];
      const nxt0 = v.path[v.pi + 1];
      const d0 = dirBetween(cur0, nxt0, s);
      const nk = nxt0 * 4 + d0;
      const owner = this.lane.get(nk);
      if (owner !== undefined && owner !== v.id && v.stuck < 300) {
        // 前の車が同じ車線にいる: 追い越さず待つ(渋滞)
        v.t = Math.min(v.t, 0.999);
        v.stuck++;
        return true;
      }
      v.t -= 1;
      if (this.lane.get(cur0 * 4 + v.dir) === v.id) this.lane.delete(cur0 * 4 + v.dir);
      v.pi++;
      if (this.onTile) this.onTile(v, route, v.path[v.pi]);
      v.dir = d0;
      v.stuck = 0;
      this.lane.set(nk, v.id);
      const cur = v.path[v.pi];
      if (m.road.get(cur) === 0) {
        v.cap = 0; // 道路が撤去された: 車両を削除
        return false;
      }
      if (v.pi < v.path.length - 1) {
        const nxt = v.path[v.pi + 1];
        const d = dirBetween(cur, nxt, s);
        if (d < 0 || !(m.road.get(cur) & OUT(d)) || !(m.road.get(nxt) & CONN((d + 2) & 3)) || this.takeReplan(v, route)) {
          v.path = Uint32Array.of(cur);
          v.pi = 0;
          v.t = 0;
          this.depart(v, route, tick, false);
          return true;
        }
        if (v.pi + 1 > v.resTo && !this.extendReservation(v)) {
          v.t = 0; // 次の閉塞が空くまで、この位置で待つ
          break;
        }
      }
    }
    if (v.pi >= v.path.length - 1) {
      v.t = 0;
      this.arrive(v, route, tick);
    }
    return true;
  }

  /**
   * 鉄道の加減速: 発車直後は低速から徐々に上がり(約 ACCEL_TICKS)、停車駅の手前 DECEL_TILES タイルから減速する。
   * 経路の末尾(駅)の手前では最低 25% の速度まで落とす。
   */
  private railSpeedFactor(v: Vehicle): number {
    const sf = Math.min(1, (v.sf ?? 0.3) + 0.03);
    v.sf = sf;
    const remain = v.path.length - 1 - v.pi - v.t;
    const dec = remain >= DECEL_TILES ? 1 : 0.25 + 0.75 * Math.max(0, remain / DECEL_TILES);
    return Math.max(0.2, Math.min(sf, dec));
  }

  private stepRail(v: Vehicle, route: Route, tick: number): boolean {
    const m = this.map;
    const s = m.size;
    // 斜めの区間は距離が √2 倍なので、タイル間の進捗を距離で割る
    if (v.pi < v.path.length - 1 && v.pi + 1 > v.resTo && !this.extendReservation(v)) {
      v.t = 0;
      v.stuck++; // 赤信号で停止中
      return true;
    }
    const hop = v.pi < v.path.length - 1 && dirBetween(v.path[v.pi], v.path[v.pi + 1], s) >= 4 ? Math.SQRT2 : 1;
    v.t += (v.speed * this.railSpeedFactor(v)) / hop;
    while (v.t >= 1 && v.pi < v.path.length - 1) {
      v.t -= 1;
      v.pi++;
      const cur = v.path[v.pi];
      if (this.onTile) this.onTile(v, route, cur);
      if (m.rail.get(cur) === 0) {
        v.cap = 0; // 線路が撤去された: 編成を撤去
        return false;
      }
      v.trail.unshift(cur);
      while (v.trail.length > v.len) {
        const r = v.trail.pop()!;
        if (this.reserved.get(r) === v.id) this.reserved.delete(r);
      }
      if (v.pi < v.path.length - 1) {
        const nxt = v.path[v.pi + 1];
        const d = dirBetween(cur, nxt, s);
        if (d < 0 || !(m.rail.get(cur) & CONN(d)) || !(m.rail.get(nxt) & CONN(opposite8(d))) || this.takeReplan(v, route)) {
          // 前方の線路が壊れた/通る線路が変更された: 予約を解放して再探索
          for (let i = v.pi + 1; i < v.path.length; i++) if (this.reserved.get(v.path[i]) === v.id && !v.trail.includes(v.path[i])) this.reserved.delete(v.path[i]);
          v.path = Uint32Array.of(cur);
          v.pi = 0;
          v.t = 0;
          this.depart(v, route, tick, false);
          return true;
        }
      }
    }
    if (v.pi >= v.path.length - 1) {
      v.t = 0;
      this.arrive(v, route, tick);
    }
    return true;
  }

  /** 到着: 目的地の乗客は降車(輸送実績)、他路線へ乗り換える乗客は停留所に降ろす */
  private alight(v: Vehicle, stop: Stop, route: Route, tick: number): void {
    // 乗っていた全員の、前の停留所からここまでの距離運賃
    const prev = v.lastStop !== undefined ? this.stops.get(v.lastStop) : undefined;
    if (prev && v.load > 0) this.onFare?.(v.mode, v.load * FARE[v.mode].perTile * fareMulOf(route) * (Math.abs(prev.x - stop.x) + Math.abs(prev.y - stop.y)), v.routeId);
    const tbl = this.router.table(stop.id, this.version);
    for (const [d, n] of v.cargo) {
      if (d === stop.id) {
        this.delivered += n;
        stop.traffic = (stop.traffic ?? 0) + n;
        this.onVisit?.(stop, n, tick);
        route.carried = (route.carried ?? 0) + n;
        this.credit(stop, n);
        v.cargo.delete(d);
        v.load -= n;
      } else if (tbl.next.get(d) !== route.id) {
        v.cargo.delete(d);
        v.load -= n;
        if (tbl.next.has(d)) {
          this.addWaiting(stop, d, n);
          this.transfers += n;
          stop.traffic = (stop.traffic ?? 0) + n;
        }
      }
    }
  }

  private arrive(v: Vehicle, route: Route, tick: number): void {
    v.stuck = 0;
    const order = route.orders[v.order];
    const stop = this.stops.get(order.stopId);
    // 区間の実測(条件ジャンプなしで次の停車駅に着いたときだけ)
    if (v.from !== undefined && v.departedAt !== undefined && v.from < route.orders.length && this.realAfter(route, v.from) === v.order) {
      const leg = tick - v.departedAt;
      const arr = (route.legMeasured ??= []);
      arr[v.from] = arr[v.from] === undefined ? leg : arr[v.from] * 0.7 + leg * 0.3;
    }
    v.from = undefined;
    v.state = 'load';
    v.arrived = tick;
    if (stop) {
      this.alight(v, stop, route, tick);
      v.lastStop = stop.id;
    } else {
      v.cargo.clear();
      v.load = 0;
    }
    let until = tick + order.dwell;
    if (order.kind === 'timed') {
      // 周期 P の時刻表: 発車予定は departTod + k*P のうち、到着時刻に最も近いもの
      const P = route.period;
      const diff = nearestDiff(order.departTod + v.offset, todOf(tick), P);
      const late = Math.max(0, tick + order.dwell - (tick + diff));
      route.late = route.late * 0.8 + late * 0.2;
      until = Math.max(until, tick + diff);
    }
    v.until = until;
  }

  /** 道路車両の描画位置(タイル座標)と進行方向 */
  position(v: Vehicle): { x: number; y: number; dx: number; dy: number } {
    const s = this.map.size;
    const i = v.path[Math.min(v.pi, v.path.length - 1)];
    const x0 = i % s;
    const y0 = Math.floor(i / s);
    if (v.state !== 'move' || v.pi >= v.path.length - 1) {
      const prev = v.pi > 0 ? v.path[v.pi - 1] : i;
      const dx = Math.sign(x0 - (prev % s));
      const dy = Math.sign(y0 - (Math.floor(prev / s)));
      return { x: x0, y: y0, dx: dx || (dy ? 0 : 1), dy };
    }
    const n = v.path[v.pi + 1];
    const dx = (n % s) - x0;
    const dy = (Math.floor(n / s)) - y0;
    return { x: x0 + dx * v.t, y: y0 + dy * v.t, dx, dy };
  }

  /** 鉄道: 頭→尾の折れ線(タイル座標)。移動中は先頭に前方の補間点を含む */
  trainPoints(v: Vehicle): [number, number][] {
    const s = this.map.size;
    const pts: [number, number][] = [];
    if (v.state === 'move' && v.pi < v.path.length - 1 && v.trail.length) {
      const h = v.trail[0];
      const n = v.path[v.pi + 1];
      const hx = h % s;
      const hy = Math.floor(h / s);
      pts.push([hx + ((n % s) - hx) * v.t, hy + ((Math.floor(n / s)) - hy) * v.t]);
    }
    for (const t of v.trail) pts.push([t % s, Math.floor(t / s)]);
    return pts;
  }

  /** 航空機の位置(タイル座標、中心補正済み)・高度(0..1)・向き */
  planePos(v: Vehicle): { x: number; y: number; alt: number; dx: number; dy: number } {
    const f = v.flight;
    if (!f) {
      const s = this.map.size;
      const i = v.path[0];
      return { x: (i % s) + 0.5, y: (Math.floor(i / s)) + 0.5, alt: 0, dx: v.hx, dy: v.hy };
    }
    const k = f.done / f.dist;
    const alt = Math.max(0, Math.min(1, f.done / 12, (f.dist - f.done) / 12));
    return { x: f.x0 + (f.x1 - f.x0) * k, y: f.y0 + (f.y1 - f.y0) * k, alt, dx: v.hx, dy: v.hy };
  }
}

function dirBetween(a: number, b: number, size: number): number {
  const dx = (b % size) - (a % size);
  const dy = (Math.floor(b / size)) - (Math.floor(a / size));
  for (let d = 0; d < 8; d++) if (DX8[d] === dx && DY8[d] === dy) return d;
  return -1;
}
