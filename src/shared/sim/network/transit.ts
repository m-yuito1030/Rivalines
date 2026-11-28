import { SignalSystem } from './signalSystem';
import { TrainOps } from './trainOps';
import { OrderEditor } from './orderEditor';
import { Schedule } from './schedule';
import { type Mode, clampCars, defaultModel, legacyCarsOf, modelOf } from '../../data/models';
import { CONN, DX8, DY8 } from '../../world/directions';
import type { GameMap } from '../../world/gameMap';
import { findTerminal } from '../../world/airports';
import { disconnectRail } from '../../world/rails';
import { makeRng } from '../../world/towns';
import { type StationOptions, layStationTracks, planStation, stationTile, stationTiles } from '../../world/stations';
import { Router } from './routing';
import {
  DAY_TICKS,
  DEFAULT_DWELL,
  Departure,
  Depot,
  GEN_EVERY,
  KIND_INDEX,
  KIND_NAME,
  MirrorSnap,
  OrderCond,
  PATH_CACHE_MAX,
  PathEntry,
  ROUTE_COLORS,
  Route,
  Stop,
  TransitSave,
  Vehicle,
  todOf,
  trainLen,
} from './types';
import { MirrorSync } from './mirrorSync';
import { PathPlanner } from './pathPlanner';
import { Dispatcher } from './dispatcher';
import { Motion } from './motion';
import { PassengerFlow } from './passengerFlow';
import { TransitStore } from './transitStore';
export * from './types';

export class Transit {
  /** Client: apply the structure, waiting counts, and vehicles that arrived from the server, and animate them smoothly */
  readonly mirror = new MirrorSync(this);
  /** Path search, caching, and network-change notification (only paths touching the changed area are searched again) */
  readonly planner = new PathPlanner(this);
  /** Vehicle departure: pick the path to the next stop and set off (bus, rail, air) */
  readonly dispatch = new Dispatcher(this);
  /** One tick of movement for running vehicles (road, rail, air), plus arrival, alighting, and position computation */
  readonly motion = new Motion(this);
  /** Passenger generation, waiting counts, boarding/alighting, catchment areas, and facility demand */
  readonly flow = new PassengerFlow(this);
  /** Save/load (turn Transit's state into a form for saving) */
  readonly store = new TransitStore(this);

  /** Signals and blocks (rail reservations) */
  readonly signalsSys = new SignalSystem(this);
  /** Train formation operations (split, couple, depart while held) */
  readonly trainOps = new TrainOps(this);
  /** Editing a route's orders (insert, delete, reorder, share) */
  readonly orderEdit = new OrderEditor(this);
  /** Timetable, departure boards, auto-building timetables, service classes, and route duplication */
  readonly schedule = new Schedule(this);

  stops = new Map<number, Stop>();
  routes = new Map<number, Route>();
  vehicles: Vehicle[] = [];
  stopAt = new Map<number, number>();
  /** Reserved rail tiles (blocks): tile -> vehicle id */
  reserved = new Map<number, number>();
  /** Signals: track tile -> direction bits (1<<d: a signal controls trains heading in direction d). With only one direction, running the opposite way is forbidden */
  signals = new Map<number, number>();
  /** Road lane occupancy: tile*4+direction -> vehicle id (one vehicle per lane per tile) */
  lane = new Map<number, number>();
  nextId = 1;
  /** Multiplayer: the company currently acting (it owns newly created stops, routes, and depots) */
  actor = 0;
  /** Multiplayer: disconnected companies. Their routes stop running (frozen as they are) */
  frozen = new Set<number>();
  /** Entered a tile of another company's infrastructure (road/rail): used to compute tolls */
  onTile?: (v: Vehicle, route: Route, tile: number) => void;
  /** For UI refresh: increases whenever the structure changes */
  version = 0;
  delivered = 0;
  /** Number of people who transferred */
  transfers = 0;
  /** A fare was paid (for management). mode, amount */
  onFare?: (mode: Mode, amount: number, routeId: number, vehicleId?: number) => void;
  /** Service quality of a stop's owner (multiplier on passenger generation). 1 if not set */
  serviceMul?: (owner: number | undefined) => number;
  /** n people arrived and got off at `stop` (for counting facility visitors) */
  onVisit?: (stop: Stop, n: number, tick: number) => void;
  router = new Router(
    () => this.realRoutes(),
    (id) => (this.stops.get(id)?.pop ?? 0) + (this.stops.get(id)?.fpop ?? 0) + 1,
  );
  /** Array of stops (a cache, so the per-tick scan does not allocate) */
  stopList: Stop[] = [];
  stopListVer = -1;
  /**
   * Path cache. The key is `start:end` (on a huge map the index approaches 2^32, and a numeric product would exceed 2^53 and collide with another path, hence a string).
   * Every use re-checks each edge and signal direction. In addition, when the network changes (netLog) and the change touches this path's search area (start, end, bounding rectangle of the path + margin),
   * the path is searched again on its next use. Changes far away do not trigger a re-search, so load does not pile up even with many routes and players.
   */
  pathCache = new Map<string, PathEntry>();
  /** Generation of the network (tracks, roads, signals, stations). touchNetwork advances it whenever a user action changes the network */
  netGen = 0;
  /** History of changes (generation and rectangle). Each cache entry uses it to check whether a change since its own generation touches its area */
  netLog: { gen: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  netLogFloor = 0;
  /** Cap on the path cache (can be made small in tests) */
  pathCacheMax = PATH_CACHE_MAX;

  constructor(
    readonly map: GameMap,
    readonly rng: () => number = makeRng(1),
  ) {}

  /** The next ID to hand out (for multiplayer broadcast) */
  get idCounter(): number {
    return this.nextId;
  }

  mirrorVeh = new Map<number, Vehicle>();
  /** Client: each vehicle's last two server states (for interpolation, so motion is smooth) */
  snaps = new Map<number, MirrorSnap>();

  stopAtTile(x: number, y: number, kind?: Mode): Stop | undefined {
    const i = this.map.idx(x, y);
    for (const k of kind ? [kind] : (['road', 'rail', 'air'] as Mode[])) {
      const id = this.stopAt.get(i * 3 + KIND_INDEX[k]);
      if (id !== undefined) return this.stops.get(id);
    }
    return undefined;
  }

  /** Routes without waypoints (for the passenger route table) */
  *realRoutes(): Generator<Route> {
    for (const r of this.routes.values()) {
      yield r.orders.some((o) => o.pass || this.stops.get(o.stopId)?.waypoint) ? { ...r, orders: r.orders.filter((o) => !o.pass && !this.stops.get(o.stopId)?.waypoint) } : r;
    }
  }

  /** Tiles a stop occupies (every tile of a multi-tile station) */
  stopTiles(s: Stop): number[] {
    return s.station ? stationTiles(s.station).map(([x, y]) => this.map.idx(x, y)) : [s.idx];
  }

  stopValid(s: Stop): boolean {
    if (!s.station) return this.tileValid(s.kind, s.idx);
    // If even one tile of a multi-tile station is destroyed, the whole station is invalid (it is removed entirely)
    return this.stopTiles(s).every((i) => (this.map.railAt(i) & 0xf) !== 0 && (this.map.railAt(i) & 0xf0) === 0);
  }

  /** Candidate "stopping positions" of a station: both end tiles of each platform track. A one-tile station is its own */
  docks(s: Stop, trainTiles = 1): { a: number; b: number }[] {
    if (!s.station) return [{ a: s.idx, b: s.idx }];
    const st = s.station;
    // Stops with the middle of the train at the middle of the platform (to the end if the train is longer than the platform).
    // b: head position when stopping while moving in the direction of increasing index, a: head position when moving in the decreasing direction (symmetric)
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

  /** Index of the next order at which the vehicle stops after order i (skipping waypoints) */
  realAfter(route: Route, i: number): number {
    const n = route.orders.length;
    let j = (i + 1) % n;
    for (let g = 0; g < n && this.isWay(route, j); g++) j = (j + 1) % n;
    return j;
  }

  /** An order that does not stop (a waypoint, or a station set to pass) */
  isWay(route: Route, i: number): boolean {
    return !!route.orders[i].pass || !!this.stops.get(route.orders[i].stopId)?.waypoint;
  }

  /**
   * Build a new station: lay track over platforms x platform length with (x0,y0) at the top left, forming one stop.
   * If it cannot be placed, returns the reason.
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
    const stop: Stop = {
      id,
      name: '',
      kind: 'rail',
      idx: m.idx(fx, fy),
      x: cx,
      y: cy,
      waiting: 0,
      wait: new Map(),
      frac: 0,
      pop: 0,
      townId: 0,
      station: info,
      owner: this.actor || undefined,
    };
    this.flow.refreshCatchment(stop);
    const town = m.towns[stop.townId - 1];
    stop.name = `${town ? town.name : '郊外'}駅${id}`;
    this.stops.set(id, stop);
    for (const i of this.stopTiles(stop)) this.stopAt.set(i * 3 + KIND_INDEX.rail, id);
    this.planner.touchNetwork(info.x0, info.y0, info.x0 + (info.axis === 1 ? info.len : info.tracks) - 1, info.y0 + (info.axis === 1 ? info.tracks : info.len) - 1);
    this.version++;
    return { stop };
  }

  /** Place a waypoint (on a straight track; it must not overlap a station or another waypoint). null if it cannot be placed */
  addWaypoint(x: number, y: number): Stop | null {
    const m = this.map;
    if (!m.inBounds(x, y)) return null;
    const idx = m.idx(x, y);
    if (!this.tileValid('rail', idx) || this.stopAtTile(x, y, 'rail')) return null;
    const id = this.nextId++;
    const stop: Stop = {
      id,
      name: `経由点${id}`,
      kind: 'rail',
      idx,
      x,
      y,
      waiting: 0,
      wait: new Map(),
      frac: 0,
      pop: 0,
      townId: 0,
      waypoint: true,
      owner: this.actor || undefined,
    };
    this.stops.set(id, stop);
    this.stopAt.set(idx * 3 + KIND_INDEX.rail, id);
    this.version++;
    return stop;
  }

  tileValid(kind: Mode, idx: number): boolean {
    const m = this.map;
    if (m.span.get(idx)) return false;
    return kind === 'road' ? m.road.get(idx) !== 0 : kind === 'rail' ? (m.railAt(idx) & 0xf) !== 0 && (m.railAt(idx) & 0xf0) === 0 : m.air.get(idx) === 3;
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
    this.flow.refreshCatchment(stop);
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
      // A station is removed together with all its platform tracks
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

  /** Company-wide permissions: owner -> companies allowed to use the stops */
  grants = new Map<number, Set<number>>();

  /** Whether this company may use the stop in a route (shared, its own, per-station permission, or company-wide permission) */
  mayUse(s: Stop, who: number): boolean {
    return !s.owner || !who || s.owner === who || !!s.allow?.includes(who) || !!this.grants.get(s.owner)?.has(who);
  }

  addRoute(stopIds: number[]): Route | null {
    if (stopIds.length < 2) return null;
    if (
      this.actor &&
      stopIds.some((id) => {
        const s = this.stops.get(id);
        return !s || !this.mayUse(s, this.actor);
      })
    )
      return null;
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

  dropVehicles(pred: (v: Vehicle) => boolean): void {
    for (const v of this.vehicles) if (pred(v)) this.releaseAll(v.id);
    this.vehicles = this.vehicles.filter((v) => !pred(v));
  }

  releaseAll(vid: number): void {
    for (const [k, val] of this.reserved) if (val === vid) this.reserved.delete(k);
    for (const [k, val] of this.lane) if (val === vid) this.lane.delete(k);
  }

  laneKey(v: Vehicle): number {
    return v.path[Math.min(v.pi, v.path.length - 1)] * 4 + v.dir;
  }

  /** Add a vehicle at the route's first stop (it departs after the first stop). null if it cannot be placed */
  addVehicle(routeId: number, tick: number, offset = 0, opts: { modelId?: string; cars?: number; tile?: number } = {}): Vehicle | null {
    const route = this.routes.get(routeId);
    if (!route || route.orders.length < 2) return null;
    const first = this.isWay(route, 0) ? this.realAfter(route, 0) : 0;
    const stop = this.stops.get(route.orders[first].stopId);
    if (!stop) return null;
    const model = modelOf(opts.modelId ?? route.modelId);
    const cars = route.mode === 'rail' ? clampCars(model, opts.cars ?? route.cars ?? legacyCarsOf(route.modelId) ?? model.defaultCars) : 1;
    // Starting tile when leaving from a depot (the first stop if none)
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
      // If the first stop is timed, wait for the next scheduled departure (never go back to a past time)
      const P = route.period;
      const m = (((o0.departTod + offset - todOf(tick)) % P) + P) % P;
      v.until = Math.max(v.until, tick + m);
    }
    if (route.mode === 'road') {
      // Place it in a free lane of the stop tile
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
    if (opts.tile !== undefined) this.dispatch.depart(v, route, tick, false); // from the depot to the first stop
    this.version++;
    return v;
  }

  // ---------------------------------------------------------------- Depots
  /** Depot: placed on a road, rail, or airport tile; buy vehicles there and assign them to a route (= shared orders) */
  depots = new Map<number, Depot>();
  depotAt = new Map<number, number>();

  depotAtTile(x: number, y: number): Depot | undefined {
    if (!this.map.inBounds(x, y)) return undefined;
    const id = this.depotAt.get(this.map.idx(x, y));
    return id === undefined ? undefined : this.depots.get(id);
  }

  /** The depot's kind is decided by the tile: road -> bus / straight rail -> train / airport terminal -> aircraft */
  /** want: the kind to use when the tile could be more than one (a street above a subway) */
  addDepot(x: number, y: number, want?: Mode): { depot?: Depot; reason?: string } {
    const m = this.map;
    if (!m.inBounds(x, y)) return { reason: '範囲外です' };
    const idx = m.idx(x, y);
    if (this.depotAt.has(idx)) return { reason: 'すでに車両基地があります' };
    if (m.span.get(idx)) return { reason: '橋・トンネルには置けません' };
    let kind: Mode | null = null;
    if (m.road.get(idx) && want !== 'rail') kind = 'road';
    else if ((m.railAt(idx) & 0xf0) === 0 && ((m.railAt(idx) & 15) === 5 || (m.railAt(idx) & 15) === 10)) kind = 'rail';
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

  depotValid(d: Depot): boolean {
    const m = this.map;
    if (m.span.get(d.idx)) return false;
    if (d.kind === 'road') return m.road.get(d.idx) !== 0;
    if (d.kind === 'rail') return (m.railAt(d.idx) & 15) !== 0;
    return m.air.get(d.idx) === 3;
  }

  /**
   * Buy a vehicle from a depot. It runs on the route's orders (vehicles on the same route share orders).
   * The model may differ from the route's default. It cannot be bought if the first stop is unreachable.
   */
  buyVehicle(depotId: number, routeId: number, modelId: string, cars: number, tick: number): { vehicle?: Vehicle; reason?: string } {
    const d = this.depots.get(depotId);
    const r = this.routes.get(routeId);
    if (!d || !r) return { reason: '車両基地または路線がありません' };
    const model = modelOf(modelId);
    if (r.mode !== d.kind || model.mode !== d.kind) return { reason: '車両基地・路線・車種の種類が一致しません' };
    const first = this.stops.get(r.orders[this.isWay(r, 0) ? this.realAfter(r, 0) : 0]?.stopId);
    if (!first) return { reason: '路線に停留所がありません' };
    if (d.kind !== 'air' && !this.planner.route(d.idx, first.station ? this.docks(first)[0].a : first.idx, d.kind === 'rail'))
      return { reason: '車両基地から最初の停留所へ到達できません(線路・道路をつないでください)' };
    const v = this.addVehicle(routeId, tick, 0, { modelId, cars, tile: d.idx });
    return v ? { vehicle: v } : { reason: '基地の出口が塞がっているか、置けません(少し待って再度お試しください)' };
  }

  /** The depot of the same kind nearest to the route's first stop */
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

  /** Follow the track from the station to reserve the tiles a train occupies */
  spawnTrail(v: Vehicle, start: number): boolean {
    const m = this.map;
    const s = m.size;
    if (this.reserved.has(start)) return false;
    const trail = [start];
    while (trail.length < v.len) {
      const cur = trail[trail.length - 1];
      let next = -1;
      for (let d = 0; d < 8 && next < 0; d++) {
        if (!(m.railAt(cur) & CONN(d))) continue;
        const n = (Math.floor(cur / s) + DY8[d]) * s + (cur % s) + DX8[d];
        if (!trail.includes(n) && !this.reserved.has(n)) next = n;
      }
      if (next < 0) break;
      trail.push(next);
    }
    v.trail = trail;
    for (const t of trail) this.reserved.set(t, v.id);
    return true;
  }

  removeVehicle(id: number): void {
    this.releaseAll(id);
    this.vehicles = this.vehicles.filter((v) => v.id !== id);
    this.version++;
  }

  /** Facility demand by time of day (in population terms). Each facility has its own busy hours */
  dayMulDay = -1;
  dayMul = new Map<number, number>();

  /** Number of times a tick was aborted by an unexpected failure (for throttling logs) */
  stepFailures = 0;

  step(tick: number): void {
    try {
      this.stepInner(tick);
    } catch (e) {
      // Even if one tick fails on broken data (e.g. a hole in a route's orders), the whole world must not stay stopped. Repair the broken route and continue
      this.stepFailures++;
      const fixed = this.repair();
      if (this.stepFailures <= 10 || this.stepFailures % 1000 === 0)
        console.error(`[transit] tick の処理に失敗しました(${this.stepFailures}回目。壊れた路線 ${fixed} 本を直しました):`, (e as Error).message);
    }
  }

  /**
   * Repair broken routes: remove holes, nulls, and invalid entries from orders, and remove routes left with fewer than two stops together with their vehicles.
   * Called when loading saved data and when a tick fails. Returns the number of routes repaired (removed)
   */
  repair(): number {
    let n = 0;
    const valid = (o: unknown): boolean => !!o && typeof o === 'object' && Number.isInteger((o as { stopId?: unknown }).stopId) && this.stops.has((o as { stopId: number }).stopId);
    for (const r of [...this.routes.values()]) {
      if (!Array.isArray(r.orders)) {
        this.removeRoute(r.id);
        n++;
        continue;
      }
      const good = r.orders.filter(valid);
      if (good.length === r.orders.length && r.orders.length >= 2) continue;
      n++;
      if (good.length < 2) {
        this.removeRoute(r.id);
        continue;
      }
      r.orders = good;
      for (const v of this.vehicles) if (v.routeId === r.id && v.order >= good.length) v.order = 0;
    }
    if (n) this.version++;
    return n;
  }

  private stepInner(tick: number): void {
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
        if (!s.waypoint && tick % 100 === s.id % 100) this.flow.refreshCatchment(s);
      }
      if (s.waypoint) continue;
      if (tick % 100 === (s.id + 50) % 100) this.flow.purgeUnreachable(s);
      if ((tick + s.id) % GEN_EVERY === 0 && !(s.owner && this.frozen.has(s.owner))) this.flow.generate(s, tick);
    }
    if (tick % 100 === 7) for (const d of [...this.depots.values()]) if (!this.depotValid(d)) this.removeDepot(d.id);
    if (tick % DAY_TICKS === 0) for (const t of m.towns) t.pax *= 0.85;

    let removed = false;
    for (const v of this.vehicles) {
      const route = this.routes.get(v.routeId);
      if (!route) continue;
      if (route.owner && this.frozen.has(route.owner)) continue; // the owner is disconnected: leave it frozen
      try {
        if (this.stepVehicle(v, route, tick)) removed = true;
      } catch (e) {
        // Even if one vehicle fails on unexpected data (e.g. a broken route), the whole world must not stop. Remove just that vehicle
        v.cap = 0;
        removed = true;
        this.vehicleFailures++;
        if (this.vehicleFailures <= 10 || this.vehicleFailures % 1000 === 0)
          console.error(`[transit] 車両 #${v.id}(路線 ${v.routeId})の処理に失敗したので取り除きます(${this.vehicleFailures}件目):`, (e as Error).message);
      }
    }
    if (removed) {
      for (const v of this.vehicles) if (v.cap <= 0) this.releaseAll(v.id);
      this.vehicles = this.vehicles.filter((v) => v.cap > 0);
      this.version++;
    }
  }

  /** Number of vehicles removed after unexpected failures (for throttling logs) */
  vehicleFailures = 0;

  /** One tick for one vehicle. True if the vehicle disappears */
  private stepVehicle(v: Vehicle, route: Route, tick: number): boolean {
    if (v.state === 'load') {
      this.flow.stepLoad(v, route, tick);
      return false;
    }
    if (v.state === 'noroute') {
      if (tick >= v.retryAt) this.dispatch.depart(v, route, tick, false);
      return false;
    }
    return v.mode === 'air' ? !this.motion.stepAir(v, route, tick) : v.mode === 'rail' ? !this.motion.stepRail(v, route, tick) : !this.motion.stepRoad(v, route, tick);
  }

  /** Choose a destination and generate passengers (only for stops connected to a route) */
  fareDemandVer = -1;
  fareDemandBy = new Map<number, number>();

  // ---- Operations called from other files (the real work is in the services above) ----
  signalMask(idx: number): number {
    return this.signalsSys.signalMask(idx);
  }

  cycleSignal(x: number, y: number): number | null {
    return this.signalsSys.cycleSignal(x, y);
  }

  setSignal(x: number, y: number, mask: number): boolean {
    return this.signalsSys.setSignal(x, y, mask);
  }

  signalIsRed(idx: number): boolean {
    return this.signalsSys.signalIsRed(idx);
  }

  splitTrain(vid: number, k: number, tick: number): Vehicle | null {
    return this.trainOps.splitTrain(vid, k, tick);
  }

  departHeld(vid: number, tick: number): boolean {
    return this.trainOps.departHeld(vid, tick);
  }

  canCouple(aId: number, bId: number): boolean {
    return this.trainOps.canCouple(aId, bId);
  }

  coupleTrains(aId: number, bId: number): boolean {
    return this.trainOps.coupleTrains(aId, bId);
  }

  trainsNear(stopId: number, r = 9): Vehicle[] {
    return this.trainOps.trainsNear(stopId, r);
  }

  insertOrder(routeId: number, index: number, stopId: number): { ok: boolean; reason?: string } {
    return this.orderEdit.insertOrder(routeId, index, stopId);
  }

  removeOrder(routeId: number, index: number): { ok: boolean; reason?: string } {
    return this.orderEdit.removeOrder(routeId, index);
  }

  moveOrder(routeId: number, index: number, dir: -1 | 1): { ok: boolean; reason?: string } {
    return this.orderEdit.moveOrder(routeId, index, dir);
  }

  shareRoute(routeId: number): Route | null {
    return this.orderEdit.shareRoute(routeId);
  }

  unshareRoute(routeId: number): void {
    return this.orderEdit.unshareRoute(routeId);
  }

  syncOrders(routeId: number): void {
    return this.orderEdit.syncOrders(routeId);
  }

  legTicks(route: Route, i: number): number | null {
    return this.schedule.legTicks(route, i);
  }

  departures(stopId: number, tick: number): Departure[] {
    return this.schedule.departures(stopId, tick);
  }

  timetable(stopId: number, tick: number, count = 3): { routeId: number; etas: number[] }[] {
    return this.schedule.timetable(stopId, tick, count);
  }

  autoTimetable(routeId: number, startTod: number): boolean {
    return this.schedule.autoTimetable(routeId, startTod);
  }

  applyRank(routeId: number, rank: number): boolean {
    return this.schedule.applyRank(routeId, rank);
  }

  planAhead(vehicleId: number, maxLegs = 3): { legs: number[][]; stops: number[] } | null {
    return this.schedule.planAhead(vehicleId, maxLegs);
  }

  cloneRoute(routeId: number, reverse: boolean, shiftTicks: number): Route | null {
    return this.schedule.cloneRoute(routeId, reverse, shiftTicks);
  }

  legsOf(route: Route): number[] {
    return this.schedule.legsOf(route);
  }

  // ---- Operations called from other files (the real work is in the services above) ----
  mirrorStruct(d: { nextId: number; routes: Route[]; stops: Stop[]; depots: Depot[]; signals: [number, number][]; grants?: [number, number[]][] }): void {
    return this.mirror.mirrorStruct(d);
  }

  mirrorWaiting(list: [number, number][]): void {
    return this.mirror.mirrorWaiting(list);
  }

  mirrorVehicles(list: (Omit<Vehicle, 'path' | 'cargo'> & { path?: number[] })[], gone: number[]): void {
    return this.mirror.mirrorVehicles(list, gone);
  }

  smoothMirror(now: number = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
    return this.mirror.smoothMirror(now);
  }

  touchNetworkTiles(tiles: [number, number][]): void {
    return this.planner.touchNetworkTiles(tiles);
  }

  touchNetwork(x0 = -1, y0 = -1, x1 = x0, y1 = y0): void {
    return this.planner.touchNetwork(x0, y0, x1, y1);
  }

  route(from: number, to: number, rail: boolean): Uint32Array | null {
    return this.planner.route(from, to, rail);
  }

  position(v: Vehicle): { x: number; y: number; dx: number; dy: number } {
    return this.motion.position(v);
  }

  trainPoints(v: Vehicle): [number, number][] {
    return this.motion.trainPoints(v);
  }

  planePos(v: Vehicle): { x: number; y: number; alt: number; dx: number; dy: number } {
    return this.motion.planePos(v);
  }

  facilityDemand(s: Stop, tick: number): number {
    return this.flow.facilityDemand(s, tick);
  }

  condHolds(v: Vehicle, route: Route, c: OrderCond, tick: number): boolean {
    return this.flow.condHolds(v, route, c, tick);
  }

  save(): TransitSave {
    return this.store.save();
  }

  restore(d: TransitSave): void {
    return this.store.restore(d);
  }
}
