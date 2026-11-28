/** Multiplayer protocol types (shared by the server and the client) */
import type { DragTool } from './world/buildApply';
import type { StationOptions } from './world/stations';
import type { Mode } from './data/models';
import type { NewFacilityType } from './world/facilities';
import type { PactState } from './sim/economy/pacts';
import type { AuctionState } from './sim/economy/auctions';
import type { WeeklyState } from './sim/economy/weekly';
import type { GovInfo } from './sim/economy/government';
import type { AiKind, AiStyle } from './sim/economy/aiCompanies';
export type Pt = { x: number; y: number };

/** Kinds of elements to demolish */
export interface BulldozeKinds {
  road: boolean;
  rail: boolean;
  signal: boolean;
  /** Stops of stations, bus stops, and airports (a station disappears as a whole) */
  stop: boolean;
  depot: boolean;
  waypoint: boolean;
  /** Bridges and tunnels */
  span: boolean;
  /** Town buildings */
  building: boolean;
  airport: boolean;
}

/** Tools that place one tile at a time */
export type PlaceTool = 'stop' | 'station' | 'depot' | 'waypoint' | 'signal' | 'airport' | 'stadium' | 'amusement' | 'mall' | 'park' | 'department' | 'hotel' | NewFacilityType;

/** Route, order, and vehicle operations that need only the owner's confirmation (method names on Transit) */
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
  /** z: for the subway tool, the depth (1-4) at the start and at the end of the line */
  | { t: 'build'; tool: DragTool; a: Pt; b: Pt; z?: [number, number] }
  | {
      t: 'place';
      tool: PlaceTool;
      x: number;
      y: number;
      opts?: StationOptions;
      fac?: { design: number; size: 'S' | 'M' | 'L' };
      air?: { size: 'S' | 'M' | 'L' | 'H'; axis: 'x' | 'y' };
    }
  | { t: 'ensureStop'; x: number; y: number; kind: Mode }
  | { t: 'routeCreate'; stops: number[] }
  | { t: 'tx'; m: TxMethod; a: number[] }
  | { t: 'routeSet'; routeId: number; patch: { name?: string; modelId?: string; cars?: number; period?: number; fareMul?: number } }
  | { t: 'orderSet'; routeId: number; index: number; patch: Record<string, unknown> }
  | { t: 'rename'; kind: 'stop' | 'depot' | 'facility'; id: number; name: string }
  | { t: 'buyVehicle'; depotId?: number; routeId: number; modelId: string; cars: number }
  | { t: 'gift'; to: number; amount: number }
  /** Stop permissions: per station (stopAllow) / company-wide (companyAllow). Only the owner can set them */
  | { t: 'stopAllow'; stopId: number; who: number; allow: boolean }
  | { t: 'companyAllow'; who: number; allow: boolean }
  /** Advertising: run it for the company's own facility (once per period per facility) */
  | { t: 'ad'; facilityId: number; kind: 'news' | 'sns' | 'tv' }
  /** A facility's price level (0 = cheapest to 4 = luxury) */
  | { t: 'facPrice'; facilityId: number; level: number }
  /** Raise a facility's grade by one / renovate it */
  | { t: 'facUpgrade'; facilityId: number }
  | { t: 'facRenovate'; facilityId: number }
  /** Redesign: change a built facility to another design at the same size (costs money) */
  | { t: 'facRedesign'; facilityId: number; design: number }
  /** Demolish by element: within a rectangle (the dragged area), demolish only the chosen kinds of element */
  | { t: 'bulldoze'; a: Pt; b: Pt; kinds: BulldozeKinds }
  /** Line development: raise the development level of the company's own stop by one */
  | { t: 'develop'; stopId: number }
  /** Bid: bid `amount` yen on auction lotId */
  | { t: 'bid'; lotId: number; amount: number }
  /** Pacts (through-running agreements): propose, accept, refuse, dissolve (withdraw) */
  | { t: 'pact'; op: 'propose' | 'accept' | 'reject' | 'cancel'; to?: number; id?: number; discount?: number }
  /** Lay signals: on a straight track from start to end, place one-way signals in the drag direction every `interval` tiles */
  | { t: 'signalLine'; a: Pt; b: Pt; interval: number }
  /** Replace all of a route's vehicles with the route's default model and car count (old vehicles are traded in at 50% of valuation) */
  | { t: 'routeReplace'; routeId: number }
  /** The planned path ahead of a vehicle (for display; read-only) */
  | { t: 'vehPlan'; id: number }
  /** Timetable: offset a train's departure time (ticks) / duplicate a route / bulk-set the service frequency / apply a suggestion (delay departures from order index onwards) */
  | { t: 'vehOffset'; id: number; offset: number }
  | { t: 'routeClone'; routeId: number; reverse: boolean; shiftMin: number }
  | { t: 'routeBulk'; routeId: number; intervalMin: number; firstMin: number }
  /** Service class: auto-set the skipped stations (copy = do not change the original route, but create a duplicate as that class, shifted by startShiftMin minutes) */
  | { t: 'routeRank'; routeId: number; rank: number; copy: boolean; shiftMin?: number }
  | { t: 'orderShift'; routeId: number; from: number; delta: number }
  | { t: 'fin'; op: 'borrow' | 'repay' | 'payout' | 'train' | 'rival-buy' | 'rival-sell' | 'acquire' | 'sell'; amount?: number; id?: number };

export interface CmdResult {
  ok: boolean;
  msg?: string;
  /** The ID of the stop, route, etc. that was created */
  id?: number;
  /** Result data (e.g. a route plan) */
  data?: unknown;
}

/** Client -> server */
export type ClientMsg =
  | { type: 'cmd'; req: number; cmd: Cmd }
  | { type: 'profile'; req: number; company: string; bio: string; color: number }
  | { type: 'report'; req: number; target: number; reason: string }
  | { type: 'chat'; req: number; text: string }
  | { type: 'view'; x0: number; y0: number; x1: number; y1: number };

/** Lightweight vehicle data needed for drawing (the path is sent separately, only when it changes) */
export interface FlightMsg {
  id: number;
  done: number;
  dist?: number;
  pts?: number[];
  sp?: number[];
}

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
  /** An aircraft's path: the whole path (pts, sp, dist) is sent once when it changes, afterwards only { id, done } */
  flight: FlightMsg | null;
  hx: number;
  hy: number;
  dir: number;
  stuck: number;
  cars: number;
  hold: boolean;
  resTo: number;
  /** People who boarded / alighted at this stop */
  on: number;
  off: number;
  /** Attached only when the path changed (including the first time) */
  path?: number[];
}

/** One tile: [index, road, rail, span, air, building, owner, infraOwner, terraform height (-1 = none), under construction (1 = yes), subway, subwayOwner] */
export type TileRec = [number, number, number, number, number, number, number, number, number, number, number, number];

/** Summary of the company's own vehicles for the list (including out-of-view ones). [id, routeId, modelId, mode, x, y, state (0 moving, 1 stopped, 2 no route, 3 held), load %, car count] */
export type MyVeh = [number, number, string, Mode, number, number, number, number, number];

export interface PlayerInfo {
  id: number;
  name: string;
  /** Company name (the account name if unset) and profile */
  company: string;
  bio: string;
  color: number;
  online: boolean;
  /** A computer-run company (no account: cannot be sent money, reported, or granted access), with what it specializes in and how it plays */
  ai?: { kind: AiKind; style: AiStyle };
  marketCap: number;
  price: number;
  netWorth: number;
  profit: number;
  passengers: number;
  /** Cumulative sales - expenses (for the weekly ranking) */
  profitTotal: number;
}

/** One public chat message. from = the account ID of the sender */
export interface ChatMsg {
  id: number;
  from: number;
  name: string;
  text: string;
  at: number;
}

export type ServerMsg =
  | { type: 'chat'; msg: ChatMsg }
  /** On connect, the recent messages (newest last) */
  | { type: 'chatlog'; list: ChatMsg[] }
  | { type: 'init'; you: string; id: number; world: { size: number; seed: number }; tick: number; start: Pt | null; version?: string }
  /** earn: amounts earned by the company's own vehicles [vehicle id, yen]; facEarn: amounts earned by its own facilities [facility id, yen] (so the screen can show them above whatever earned) */
  | { type: 'frame'; tick: number; veh: VehMsg[]; gone: number[]; tiles: TileRec[]; earn?: [number, number][]; facEarn?: [number, number][] }
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
      /** The government: the current and next national policy, the stance, the treasury, and this company's standing */
      gov?: GovInfo;
    }
  | { type: 'towns'; towns: unknown[] }
  | { type: 'fac'; facilities: unknown[] }
  | { type: 'res'; req: number; res: CmdResult };
