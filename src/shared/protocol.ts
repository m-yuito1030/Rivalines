/** マルチプレイの通信の型(サーバーとクライアントで共有) */
import type { DragTool } from './world/buildApply';
import type { StationOptions } from './world/stations';
import type { Mode } from './data/models';
import type { NewFacilityType } from './world/facilities';
import type { PactState } from './sim/economy/pacts';
import type { AuctionState } from './sim/economy/auctions';
import type { WeeklyState } from './sim/economy/weekly';

export type Pt = { x: number; y: number };

/** 撤去する要素の種類 */
export interface BulldozeKinds {
  road: boolean;
  rail: boolean;
  signal: boolean;
  /** 駅・バス停・空港の停留所(駅は全体が消える) */
  stop: boolean;
  depot: boolean;
  waypoint: boolean;
  /** 橋・トンネル */
  span: boolean;
  /** 街の建物 */
  building: boolean;
  airport: boolean;
}

/** 1タイルずつ置くツール */
export type PlaceTool = 'stop' | 'station' | 'depot' | 'waypoint' | 'signal' | 'airport' | 'stadium' | 'amusement' | 'mall' | 'park' | 'department' | 'hotel' | NewFacilityType;

/** 路線・オーダー・車両の操作のうち、持ち主の確認だけで実行できるもの(Transit のメソッド名) */
export const TX_METHODS = [
  'removeRoute',
  'moveOrder',
  'insertOrder',
  'removeOrder',
  'shareRoute',
  'unshareRoute',
  'autoTimetable',
  'removeVehicle',
  'removeDepot',
  'splitTrain',
  'departHeld',
  'coupleTrains',
] as const;
export type TxMethod = (typeof TX_METHODS)[number];

export type Cmd =
  | { t: 'build'; tool: DragTool; a: Pt; b: Pt }
  | { t: 'place'; tool: PlaceTool; x: number; y: number; opts?: StationOptions; fac?: { design: number; size: 'S' | 'M' | 'L' } }
  | { t: 'ensureStop'; x: number; y: number; kind: Mode }
  | { t: 'routeCreate'; stops: number[] }
  | { t: 'tx'; m: TxMethod; a: number[] }
  | { t: 'routeSet'; routeId: number; patch: { name?: string; modelId?: string; cars?: number; period?: number; fareMul?: number } }
  | { t: 'orderSet'; routeId: number; index: number; patch: Record<string, unknown> }
  | { t: 'rename'; kind: 'stop' | 'depot'; id: number; name: string }
  | { t: 'buyVehicle'; depotId?: number; routeId: number; modelId: string; cars: number }
  | { t: 'gift'; to: number; amount: number }
  /** 停留所の使用許可: 駅ごと(stopAllow)/会社単位(companyAllow)。持ち主だけが設定できる */
  | { t: 'stopAllow'; stopId: number; who: number; allow: boolean }
  | { t: 'companyAllow'; who: number; allow: boolean }
  /** 広告: 自社の施設に打つ(施設ごとに一定期間に1度) */
  | { t: 'ad'; facilityId: number; kind: 'news' | 'sns' | 'tv' }
  /** 施設の料金の段階(0=格安〜4=高級) */
  | { t: 'facPrice'; facilityId: number; level: number }
  /** 施設のグレードを1つ上げる / 改装する */
  | { t: 'facUpgrade'; facilityId: number }
  | { t: 'facRenovate'; facilityId: number }
  /** デザイン変更: 建てた施設を、同じ大きさのまま別のデザインにする(費用がかかる) */
  | { t: 'facRedesign'; facilityId: number; design: number }
  /** 要素ごとの撤去: 矩形(ドラッグした範囲)の中の、選んだ種類の要素だけを撤去する */
  | { t: 'bulldoze'; a: Pt; b: Pt; kinds: BulldozeKinds }
  /** 沿線開発: 自社の停留所の開発度を1上げる */
  | { t: 'develop'; stopId: number }
  /** 入札: 競り lotId に amount 円で入札する */
  | { t: 'bid'; lotId: number; amount: number }
  /** 提携(乗り入れ契約): 申し込み・承諾・拒否・解消(取り下げ) */
  | { t: 'pact'; op: 'propose' | 'accept' | 'reject' | 'cancel'; to?: number; id?: number; discount?: number }
  /** 信号を並べる: 始点→終点の直線の線路に、ドラッグの向きの一方向信号を interval タイルおきに置く */
  | { t: 'signalLine'; a: Pt; b: Pt; interval: number }
  /** 路線の全車両を、路線の既定の車種・両数に置き換える(旧車両は評価額の50%で下取り) */
  | { t: 'routeReplace'; routeId: number }
  /** 車両のこの先の経路の予定(表示用。読み取りだけ) */
  | { t: 'vehPlan'; id: number }
  /** ダイヤ: 編成の発車時刻のずれ(tick)/ 路線の複製 / 運行本数の一括設定 / 提案の適用(オーダー index 以降の発車時刻を遅らせる) */
  | { t: 'vehOffset'; id: number; offset: number }
  | { t: 'routeClone'; routeId: number; reverse: boolean; shiftMin: number }
  | { t: 'routeBulk'; routeId: number; intervalMin: number; firstMin: number }
  /** 種別: 通過駅を自動設定(copy=元の路線は変えず、種別の路線として複製して作る。startShiftMin 分ずらす) */
  | { t: 'routeRank'; routeId: number; rank: number; copy: boolean; shiftMin?: number }
  | { t: 'orderShift'; routeId: number; from: number; delta: number }
  | { t: 'fin'; op: 'borrow' | 'repay' | 'payout' | 'train' | 'rival-buy' | 'rival-sell' | 'acquire' | 'sell'; amount?: number; id?: number };

export interface CmdResult {
  ok: boolean;
  msg?: string;
  /** 作った停留所・路線などのID */
  id?: number;
  /** 結果のデータ(経路の予定など) */
  data?: unknown;
}

/** クライアント → サーバー */
export type ClientMsg =
  | { type: 'cmd'; req: number; cmd: Cmd }
  | { type: 'profile'; req: number; company: string; bio: string; color: number }
  | { type: 'report'; req: number; target: number; reason: string }
  | { type: 'view'; x0: number; y0: number; x1: number; y1: number };

/** 描画に必要な車両の軽量データ(経路 path は変わったときだけ別送) */
export interface VehMsg {
  id: number;
  routeId: number;
  modelId: string;
  mode: Mode;
  order: number;
  pi: number;
  t: number;
  state: 'move' | 'load' | 'noroute';
  load: number;
  cap: number;
  speed: number;
  trail: number[];
  len: number;
  flight: unknown;
  hx: number;
  hy: number;
  dir: number;
  stuck: number;
  cars: number;
  hold: boolean;
  resTo: number;
  /** 経路が変わった(初回含む)ときだけ付く */
  path?: number[];
}

/** タイル1つ: [index, road, rail, span, air, building, owner, infraOwner, 整地の高度(-1=なし)] */
export type TileRec = [number, number, number, number, number, number, number, number, number];

/** 自社の車両の一覧用の概要(視界の外の車両も含む)。[id, routeId, modelId, mode, x, y, state(0走行 1停車 2経路なし 3待機), 積載%, 両数] */
export type MyVeh = [number, number, string, Mode, number, number, number, number, number];

export interface PlayerInfo {
  id: number;
  name: string;
  /** 会社名(未設定ならアカウント名)とプロフィール */
  company: string;
  bio: string;
  color: number;
  online: boolean;
  marketCap: number;
  price: number;
  netWorth: number;
  profit: number;
  passengers: number;
  /** 売上 − 費用の累計(週間ランキング用) */
  profitTotal: number;
}

export type ServerMsg =
  | { type: 'init'; you: string; id: number; world: { size: number; seed: number }; tick: number; start: Pt | null }
  | { type: 'frame'; tick: number; veh: VehMsg[]; gone: number[]; tiles: TileRec[] }
  | { type: 'chunk'; cx: number; cy: number; tiles: number[][]; edits: [number, number][] }
  | { type: 'struct'; nextId: number; routes: unknown[]; stops: unknown[]; depots: unknown[]; signals: [number, number][]; grants?: [number, number[]][] }
  | {
      type: 'misc';
      routeStats: [number, number, number, number][];
      myVehicles: MyVeh[];
      tick: number;
      company: unknown;
      rivals: unknown[];
      rating: unknown;
      delivered: number;
      transfers: number;
      waiting: [number, number][];
      players: PlayerInfo[];
      online: string[];
      pacts: PactState;
      auctions: AuctionState;
      weekly: WeeklyState;
    }
  | { type: 'towns'; towns: unknown[] }
  | { type: 'fac'; facilities: unknown[] }
  | { type: 'res'; req: number; res: CmdResult };
