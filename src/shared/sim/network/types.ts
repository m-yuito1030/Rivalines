import { DX8, DY8 } from '../../world/directions';
import type { Mode } from '../../data/models';
import type { StationInfo } from '../../world/stations';
export const DAY_TICKS = 30 * 60 * 10;
/** The game starts at 06:00 */
export const START_TOD = DAY_TICKS / 4;
export const todOf = (tick: number) => (tick + START_TOD) % DAY_TICKS;

export interface Stop {
  id: number;
  name: string;
  kind: Mode;
  idx: number;
  x: number;
  y: number;
  /** Total number of people waiting */
  waiting: number;
  /** Destination stop ID -> number of people */
  wait: Map<number, number>;
  /** Fractional remainder of passenger generation */
  frac: number;
  pop: number; // population of the catchment area
  townId: number;
  /** Rail: a multi-tile station (platform count, length, design). Absent for a simple one-tile station */
  station?: StationInfo;
  /** Rail: a waypoint (no boarding; only for specifying the path) */
  waypoint?: boolean;
  /** Demand of large facilities in the catchment (total in population terms) and their facility IDs */
  fpop?: number;
  facs?: number[];
  /** Cumulative number of people who boarded or alighted (for rankings) */
  traffic?: number;
  /** Development level of the line's surroundings (0 if none) */
  dev?: number;
  /** Multiplayer: the company that built it (account ID). Shared if absent */
  owner?: number;
  /** Other companies (account IDs) allowed to use this stop in a route. The owner grants this per station */
  allow?: number[];
}

/** dwell = stop for a fixed time / full = wait until full (up to maxWait) / timed = timetable (period route.period) */
export type OrderKind = 'dwell' | 'full' | 'timed';
/**
 * Conditional order on departure (time, load factor, or waiting count): when leaving this stop, if the condition holds, jump to order `to` (0-based) instead of the next order.
 * kind: load = load factor (%) / wait = people waiting at this stop / tod = time of day (minutes within the day). op: ge = at least / lt = less than
 */
export interface OrderCond {
  kind: 'load' | 'wait' | 'tod';
  op: 'ge' | 'lt';
  value: number;
  to: number;
}
export interface Order {
  /** Conditional jump (otherwise the next order, as usual) */
  cond?: OrderCond;
  stopId: number;
  kind: OrderKind;
  dwell: number; // minimum stop time (ticks)
  maxWait: number; // full: maximum wait (ticks)
  departTod: number; // timed: departure time (ticks within the day)
  /** Pass: run through without stopping (a skipped station of an express). Treated like a waypoint: no boarding and no stop */
  pass?: boolean;
}

export interface Route {
  id: number;
  name: string;
  color: number;
  mode: Mode;
  modelId: string; // model added by the "+ vehicle" button
  /** Fare income today, and income / profit per recent day (yen; for rankings) */
  dayRevenue?: number;
  income?: number;
  profit?: number;
  /** Measured travel time per leg (ticks, indexed by departure order). Used to auto-build a timetable */
  legMeasured?: number[];
  /** Shared-orders group ID (routes with the same value share orders and period; edits propagate to all via syncOrders) */
  shared?: number;
  /** Rail: number of cars of a train added with "+ vehicle" (the model's default if absent). Single-unit models are always 1 car */
  cars?: number;
  /** Timetable period (ticks). E.g. 1 day / 6 hours */
  period: number;
  /** Fare multiplier (1 if absent). Multiplies income directly, and raises or lowers passenger generation at stops */
  fareMul?: number;
  /** Average delay (ticks, exponential moving average) */
  late: number;
  /** Cumulative passengers carried (people who reached their destination) */
  carried?: number;
  orders: Order[];
  /** Multiplayer: the route's owner (company) */
  owner?: number;
  /** Service class (0 local, 1 semi-express, 2 rapid, 3 express, 4 limited express). Used for auto-setting skipped stations and for display */
  rank?: number;
  /** For broadcast (timetable screen): vehicles (id, departure offset) and the travel time to the next stop for each order. Attached by the server */
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
  order: number; // the order it is at / heading to
  path: Uint32Array;
  pi: number; // current position along path
  t: number; // progress from pi to pi+1, 0..1
  state: VehicleState;
  arrived: number;
  until: number;
  retryAt: number;
  load: number;
  /** Passengers aboard, per destination */
  cargo: Map<number, number>;
  cap: number;
  speed: number;
  /** Rail: the tiles from head to tail, and the number of tiles needed */
  trail: number[];
  len: number;
  /** Air: the leg being flown */
  flight: Flight | null;
  /** Facing while stopped (for drawing planes and road vehicles) */
  hx: number;
  hy: number;
  /** Road: the direction it entered the current tile from (used for lane occupancy) */
  dir: number;
  /** Consecutive ticks stuck by congestion or waiting */
  stuck: number;
  /** The path being followed crosses a changed tile (re-search on entering the next tile). A transient mark, not saved */
  replan?: boolean;
  /** Rail: current speed fraction (0-1). Rises gently after departure and falls before a stop (acceleration/deceleration) */
  sf?: number;
  /** Offset of the timetable departure time (ticks). Used to space out vehicles on the same timetable */
  offset: number;
  /** People who boarded / alighted at this stop (reset to 0 on arrival; for display only, not saved) */
  on?: number;
  off?: number;
  /** Rail: number of cars (changes on split / merge) */
  cars: number;
  /** Rail: held (a train split off; does not move until told to depart) */
  hold: boolean;
  /** Rail: index of the last path tile already reserved as a block section */
  resTo: number;
  /** The stop it last stopped at (for fare distance) */
  lastStop?: number;
  /** Latest departure: the order index and time it left (for measuring leg times) */
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
  /** Ticks until arrival (0 while stopped) */
  eta: number;
  stopped: boolean;
  /** While stopped: ticks until departure */
  leaveIn: number;
  /** Next destination (the stop name of the next order) */
  toward: string;
}

export interface TransitSave {
  nextId: number;
  delivered: number;
  transfers: number;
  stops: (Omit<Stop, 'wait'> & { wait: [number, number][] })[];
  routes: Route[];
  /** Signals: [tile index, direction bits] */
  signals?: [number, number][];
  /** Company-wide stop permissions: [owner, list of companies allowed] */
  grants?: [number, number[]][];
  depots?: Depot[];
  vehicles: (Omit<Vehicle, 'path' | 'cargo'> & { path: number[]; cargo: [number, number][] })[];
}

/** Timetable period choices */
/** Turning back at a stop: turn back when the forward path is longer than this (tiles) and the turn-back path is at most 1/REVERSE_RATIO of the forward one */
export const REVERSE_MIN_TILES = 16;
export const REVERSE_RATIO = 1.6;

/** Distance to a stop (tiles) at which a train starts to brake */
export const DECEL_TILES = 3;

/** Max entries in the path cache (when exceeded, the oldest tenth is dropped), max entries in the change history, and the margin (tiles) around a change within which paths may be affected */
export const PATH_CACHE_MAX = 60000;

/** For client interpolation: the server state at one point in time */
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
  /** Bounding rectangle of start, end, and path */
  bx0: number;
  by0: number;
  bx1: number;
  by1: number;
}

/** Service classes: the name, and the fraction of intermediate stops that still stop (the rest are skipped) */
export const RANKS = [
  { name: '普通', keep: 1 },
  { name: '準急', keep: 0.8 },
  { name: '快速', keep: 0.6 },
  { name: '急行', keep: 0.45 },
  { name: '特急', keep: 0.3 },
] as const;

/**
 * Whether this is a straight track a signal can go on. If so, returns its two direction bits [a, b].
 * North-south = (N,S), east-west = (E,W); straight diagonals are NE-SW / SE-NW (directions 4..7)
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

/** Relative to `time`, returns the difference (-P/2..P/2) to the nearest scheduled departure of period P */
export function nearestDiff(scheduledTod: number, nowTod: number, P: number): number {
  let d = (((scheduledTod - nowTod) % P) + P) % P;
  if (d > P / 2) d -= P;
  return d;
}

/** Max cars after coupling */
export const MAX_CARS = 20;
export const CAR_LEN = 0.5; // tile length of one rail car
/** Number of tiles a train occupies */
export const trainLen = (cars: number) => Math.ceil(cars * CAR_LEN) + 1;
export const AIR_ALT = 70; // cruising altitude (px)
export const CATCH: Record<Mode, number> = { road: 4, rail: 6, air: 10 };
export const WAIT_CAP: Record<Mode, number> = { road: 300, rail: 1500, air: 3000 };
export const PAX_RATE = 2e-5; // passengers generated per population per tick
export const GEN_EVERY = 20; // interval of passenger generation (ticks)
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
