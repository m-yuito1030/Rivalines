/** マルチプレイの通信の型(サーバーとクライアントで共有) */
import type { DragTool } from '../world/buildApply';
import type { StationOptions } from '../world/stations';
import type { Mode } from '../data/models';

export type Pt = { x: number; y: number };

/** 1タイルずつ置くツール */
export type PlaceTool = 'stop' | 'station' | 'depot' | 'waypoint' | 'signal' | 'airport' | 'stadium' | 'amusement' | 'mall' | 'park' | 'department' | 'hotel';

/** 路線・オーダー・車両の操作のうち、持ち主の確認だけで実行できるもの(Transit のメソッド名) */
export const TX_METHODS = ['removeRoute', 'moveOrder', 'insertOrder', 'removeOrder', 'shareRoute', 'unshareRoute', 'autoTimetable', 'removeVehicle', 'removeDepot', 'splitTrain', 'departHeld', 'coupleTrains'] as const;
export type TxMethod = (typeof TX_METHODS)[number];

export type Cmd =
  | { t: 'build'; tool: DragTool; a: Pt; b: Pt }
  | { t: 'place'; tool: PlaceTool; x: number; y: number; opts?: StationOptions }
  | { t: 'ensureStop'; x: number; y: number; kind: Mode }
  | { t: 'routeCreate'; stops: number[] }
  | { t: 'tx'; m: TxMethod; a: number[] }
  | { t: 'routeSet'; routeId: number; patch: { name?: string; modelId?: string; cars?: number; period?: number; fareMul?: number } }
  | { t: 'orderSet'; routeId: number; index: number; patch: Record<string, unknown> }
  | { t: 'rename'; kind: 'stop' | 'depot'; id: number; name: string }
  | { t: 'buyVehicle'; depotId?: number; routeId: number; modelId: string; cars: number }
  | { t: 'gift'; to: number; amount: number }
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
export type ClientMsg = { type: 'cmd'; req: number; cmd: Cmd } | { type: 'view'; x0: number; y0: number; x1: number; y1: number };

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
  color: number;
  online: boolean;
  marketCap: number;
  price: number;
  netWorth: number;
  profit: number;
  passengers: number;
}

export type ServerMsg =
  | { type: 'init'; you: string; id: number; world: { size: number; seed: number }; tick: number; start: Pt | null }
  | { type: 'frame'; tick: number; veh: VehMsg[]; gone: number[]; tiles: TileRec[] }
  | { type: 'chunk'; cx: number; cy: number; tiles: number[][]; edits: [number, number][] }
  | { type: 'struct'; nextId: number; routes: unknown[]; stops: unknown[]; depots: unknown[]; signals: [number, number][] }
  | { type: 'misc'; myVehicles: MyVeh[]; tick: number; company: unknown; rivals: unknown[]; rating: unknown; delivered: number; transfers: number; waiting: [number, number][]; players: PlayerInfo[]; online: string[] }
  | { type: 'towns'; towns: unknown[] }
  | { type: 'fac'; facilities: unknown[] }
  | { type: 'res'; req: number; res: CmdResult };
