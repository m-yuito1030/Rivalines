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
  /** クライアント: サーバーから届いた構造・待ち人数・車両を反映し、なめらかに動かす */
  readonly mirror = new MirrorSync(this);
  /** 経路の探索とキャッシュ・ネットワーク変更の通知(変更範囲にかかる経路だけ探し直す) */
  readonly planner = new PathPlanner(this);
  /** 車両の出発: 次の停留所までの経路を決めて走り出す(バス・鉄道・航空) */
  readonly dispatch = new Dispatcher(this);
  /** 走行中の車両の1tickの動き(道路・鉄道・航空)と、到着・降車・位置の計算 */
  readonly motion = new Motion(this);
  /** 乗客の発生・待ち人数・積み降ろし・集客圏と施設の需要 */
  readonly flow = new PassengerFlow(this);
  /** セーブ・ロード(Transit の状態を保存用の形に変換する) */
  readonly store = new TransitStore(this);

  /** 信号・閉塞(鉄道の予約) */
  readonly signalsSys = new SignalSystem(this);
  /** 列車の編成操作(分割・連結・待機中の出発) */
  readonly trainOps = new TrainOps(this);
  /** 路線のオーダー編集(挿入・削除・並べ替え・共有) */
  readonly orderEdit = new OrderEditor(this);
  /** ダイヤ・発車案内・時刻表の自動作成・種別・路線の複製 */
  readonly schedule = new Schedule(this);

  stops = new Map<number, Stop>();
  routes = new Map<number, Route>();
  vehicles: Vehicle[] = [];
  stopAt = new Map<number, number>();
  /** 鉄道の予約済みタイル(閉塞): tile → vehicle id */
  reserved = new Map<number, number>();
  /** 信号: 線路タイル → 方向ビット(1<<d: d 方向へ進む列車を制御する信号がある)。片方向だけなら逆走は禁止 */
  signals = new Map<number, number>();
  /** 道路の車線の占有: tile*4+向き → vehicle id(1タイル1車線に1台) */
  lane = new Map<number, number>();
  nextId = 1;
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
  router = new Router(
    () => this.realRoutes(),
    (id) => (this.stops.get(id)?.pop ?? 0) + (this.stops.get(id)?.fpop ?? 0) + 1,
  );
  /** 停留所の配列(毎tickの走査でアロケーションしないためのキャッシュ) */
  stopList: Stop[] = [];
  stopListVer = -1;
  /**
   * 経路キャッシュ。キーは `始点:終点`(巨大マップでは index が 2^32 に迫り、数値の積では 2^53 を超えて別の経路と衝突するため文字列)。
   * 使うたびに各辺・信号の向きを検査する。さらに、ネットワークが変わったとき(netLog)に、変更が「この経路の探索範囲(始点・終点・経路の外接矩形+余白)」に
   * かかっていれば、次に使うときに探し直す。離れた場所の変更では探し直さないので、多数の路線・多数のプレイヤーでも負荷が集中しない。
   */
  pathCache = new Map<string, PathEntry>();
  /** ネットワーク(線路・道路・信号・駅)の世代。利用者の操作で変わるたびに touchNetwork が進める */
  netGen = 0;
  /** 変更の履歴(世代と矩形)。キャッシュの各件が、自分の世代以降の変更が範囲にかかるかを調べるのに使う */
  netLog: { gen: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  netLogFloor = 0;
  /** 経路キャッシュの上限(テストで小さくできる) */
  pathCacheMax = PATH_CACHE_MAX;

  constructor(
    readonly map: GameMap,
    readonly rng: () => number = makeRng(1),
  ) {}

  /** 次に振る ID(マルチプレイの配信用) */
  get idCounter(): number {
    return this.nextId;
  }

  mirrorVeh = new Map<number, Vehicle>();
  /** クライアント: 車両ごとの直近2回のサーバー状態(なめらかに動かすための補間用) */
  snaps = new Map<number, MirrorSnap>();

  stopAtTile(x: number, y: number, kind?: Mode): Stop | undefined {
    const i = this.map.idx(x, y);
    for (const k of kind ? [kind] : (['road', 'rail', 'air'] as Mode[])) {
      const id = this.stopAt.get(i * 3 + KIND_INDEX[k]);
      if (id !== undefined) return this.stops.get(id);
    }
    return undefined;
  }

  /** 経由点を除いた路線(乗客の経路表用) */
  *realRoutes(): Generator<Route> {
    for (const r of this.routes.values()) {
      yield r.orders.some((o) => o.pass || this.stops.get(o.stopId)?.waypoint) ? { ...r, orders: r.orders.filter((o) => !o.pass && !this.stops.get(o.stopId)?.waypoint) } : r;
    }
  }

  /** 停留所が占めるタイル(複数タイルの駅は全て) */
  stopTiles(s: Stop): number[] {
    return s.station ? stationTiles(s.station).map(([x, y]) => this.map.idx(x, y)) : [s.idx];
  }

  stopValid(s: Stop): boolean {
    if (!s.station) return this.tileValid(s.kind, s.idx);
    // 複数タイルの駅は、1タイルでも壊されたら駅全体が無効(全体を撤去する)
    return this.stopTiles(s).every((i) => (this.map.rail.get(i) & 0xf) !== 0 && (this.map.rail.get(i) & 0xf0) === 0);
  }

  /** 駅の「停車位置」候補: 番線ごとの両端タイル。1タイルの駅は自分自身 */
  docks(s: Stop, trainTiles = 1): { a: number; b: number }[] {
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
  realAfter(route: Route, i: number): number {
    const n = route.orders.length;
    let j = (i + 1) % n;
    for (let g = 0; g < n && this.isWay(route, j); g++) j = (j + 1) % n;
    return j;
  }

  /** 停まらないオーダー(経由点、または通過に設定した駅) */
  isWay(route: Route, i: number): boolean {
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

  /** 経由点を置く(直線の線路上。駅・他の経由点と重ならない)。置けなければ null */
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
      const m = (((o0.departTod + offset - todOf(tick)) % P) + P) % P;
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
    if (opts.tile !== undefined) this.dispatch.depart(v, route, tick, false); // 車両基地から最初の停留所へ
    this.version++;
    return v;
  }

  // ---------------------------------------------------------------- 車両基地(デポ)
  /** 車両基地: 道路・線路・空港のタイルに置き、そこから車両を購入して路線(=共有オーダー)に配属する */
  depots = new Map<number, Depot>();
  depotAt = new Map<number, number>();

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

  depotValid(d: Depot): boolean {
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
    if (d.kind !== 'air' && !this.planner.route(d.idx, first.station ? this.docks(first)[0].a : first.idx, d.kind === 'rail'))
      return { reason: '車両基地から最初の停留所へ到達できません(線路・道路をつないでください)' };
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
  spawnTrail(v: Vehicle, start: number): boolean {
    const m = this.map;
    const s = m.size;
    if (this.reserved.has(start)) return false;
    const trail = [start];
    while (trail.length < v.len) {
      const cur = trail[trail.length - 1];
      let next = -1;
      for (let d = 0; d < 8 && next < 0; d++) {
        if (!(m.rail.get(cur) & CONN(d))) continue;
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

  /** 時刻に応じた施設の需要(人口換算)。施設ごとに人の集まる時間帯がある */
  dayMulDay = -1;
  dayMul = new Map<number, number>();

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
      if (route.owner && this.frozen.has(route.owner)) continue; // 持ち主が切断中: そのまま止める
      if (v.state === 'load') this.flow.stepLoad(v, route, tick);
      else if (v.state === 'noroute') {
        if (tick >= v.retryAt) this.dispatch.depart(v, route, tick, false);
      } else if (v.mode === 'air' ? !this.motion.stepAir(v, route, tick) : v.mode === 'rail' ? !this.motion.stepRail(v, route, tick) : !this.motion.stepRoad(v, route, tick)) {
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
  fareDemandVer = -1;
  fareDemandBy = new Map<number, number>();

  // ---- 他のファイルから呼ばれる操作(実体は上の各サービス) ----
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

  // ---- 他のファイルから呼ばれる操作(実体は上の各サービス) ----
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
