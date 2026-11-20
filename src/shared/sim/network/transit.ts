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
import { type StationOptions, layStationTracks, planStation, stationTile, stationTiles } from '../../world/stations';
import { Router } from './routing';
import { CATCH, DAY_TICKS, DECEL_TILES, DEFAULT_DWELL, Departure, Depot, Flight, GEN_EVERY, KIND_INDEX, KIND_NAME, MirrorSnap, NET_LOG_MAX, OrderCond, PATH_CACHE_MAX, PATH_MARGIN, PAX_RATE, PathEntry, REVERSE_MIN_TILES, REVERSE_RATIO, ROUTE_COLORS, Route, START_TOD, Stop, TransitSave, Vehicle, WAIT_CAP, dirBetween, nearestDiff, todOf, trainLen } from './types';
import { SignalSystem } from './signalSystem';
import { TrainOps } from './trainOps';
import { OrderEditor } from './orderEditor';
import { Schedule } from './schedule';
export * from './types';


export class Transit {
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
  /** 変更した個々のタイルを知らせる(線路・道路・信号の操作のあと)。そのタイルを通る走行中の編成は、次のタイルに入ったところで経路を探し直す */
  touchNetworkTiles(tiles: [number, number][]): void {
    if (!tiles.length) return;
    const rects = tiles.length > 1500 ? [this.boundsOf(tiles)] : tiles.map(([x, y]) => ({ x0: x, y0: y, x1: x, y1: y }));
    this.applyChange(rects);
  }
  boundsOf(tiles: [number, number][]) {
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
  applyChange(rects: { x0: number; y0: number; x1: number; y1: number }[]): void {
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
  pathAffected(ce: PathEntry): boolean {
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
    readonly map: GameMap,
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

  mirrorVeh = new Map<number, Vehicle>();
  /** クライアント: 車両ごとの直近2回のサーバー状態(なめらかに動かすための補間用) */
  snaps = new Map<number, MirrorSnap>();

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









  removeVehicle(id: number): void {
    this.releaseAll(id);
    this.vehicles = this.vehicles.filter((v) => v.id !== id);
    this.version++;
  }

  /** 集客圏の人口と所属する街を数え直す */
  refreshCatchment(s: Stop): void {
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
  dayMulDay = -1;
  dayMul = new Map<number, number>();
  facilityDemand(s: Stop, tick: number): number {
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

  credit(stop: Stop, n: number): void {
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
  fareDemandVer = -1;
  fareDemandBy = new Map<number, number>();
  /** 停留所に停まる路線の運賃から決まる需要の倍率(路線の平均。構造が変わったときだけ作り直す) */
  stopFareDemand(stopId: number): number {
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

  generate(s: Stop, tick: number): void {
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

  addWaiting(s: Stop, dest: number, n: number): void {
    s.wait.set(dest, (s.wait.get(dest) ?? 0) + n);
    s.waiting += n;
  }

  /** 路線変更で行けなくなった目的地の乗客を取り除く */
  purgeUnreachable(s: Stop): void {
    const tbl = this.router.table(s.id, this.version);
    for (const [d, n] of s.wait) {
      if (!tbl.next.has(d)) {
        s.wait.delete(d);
        s.waiting -= n;
      }
    }
  }

  stepLoad(v: Vehicle, route: Route, tick: number): void {
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
  condHolds(v: Vehicle, route: Route, c: OrderCond, tick: number): boolean {
    let x: number;
    if (c.kind === 'load') x = v.cap > 0 ? (v.load / v.cap) * 100 : 0;
    else if (c.kind === 'wait') x = this.stops.get(route.orders[v.order].stopId)?.waiting ?? 0;
    else x = (todOf(tick) / DAY_TICKS) * 1440;
    return c.op === 'ge' ? x >= c.value : x < c.value;
  }









  /** 次のオーダーへ向けて出発(経路がなければ noroute) */
  depart(v: Vehicle, route: Route, tick: number, advance: boolean): void {
    this.departInner(v, route, tick, advance, route.orders.length);
  }

  departInner(v: Vehicle, route: Route, tick: number, advance: boolean, n: number): void {
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
  route(from: number, to: number, rail: boolean): Uint32Array | null {
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
          const mk = this.signalsSys.signalMask(c[i + 1]);
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
    const p = findPath(m, from, to, rail, 300000, rail && this.signals.size ? (i) => this.signalsSys.signalMask(i) : undefined);
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

  blocked(v: Vehicle, tick: number, wait: number): void {
    v.state = 'noroute';
    v.retryAt = tick + wait;
    v.stuck += wait;
  }

  departRoad(v: Vehicle, dest: Stop, route: Route, tick: number): void {
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
  railCandidates(v: Vehicle, vias: number[], dest: Stop): number[][] {
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

  departRail(v: Vehicle, dest: Stop, route: Route, tick: number, vias: number[] = []): void {
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
      if (!this.signalsSys.extendReservation(v)) continue;
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

  departAir(v: Vehicle, dest: Stop, route: Route, tick: number): void {
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

  stepAir(v: Vehicle, route: Route, tick: number): boolean {
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
  takeReplan(v: Vehicle, route: Route): boolean {
    if (!v.replan) return false;
    v.replan = false;
    const n = route.orders.length;
    if (this.isWay(route, (v.order - 1 + n) % n)) return false;
    return true;
  }

  stepRoad(v: Vehicle, route: Route, tick: number): boolean {
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
        if (v.pi + 1 > v.resTo && !this.signalsSys.extendReservation(v)) {
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
  railSpeedFactor(v: Vehicle): number {
    const sf = Math.min(1, (v.sf ?? 0.3) + 0.03);
    v.sf = sf;
    const remain = v.path.length - 1 - v.pi - v.t;
    const dec = remain >= DECEL_TILES ? 1 : 0.25 + 0.75 * Math.max(0, remain / DECEL_TILES);
    return Math.max(0.2, Math.min(sf, dec));
  }

  stepRail(v: Vehicle, route: Route, tick: number): boolean {
    const m = this.map;
    const s = m.size;
    // 斜めの区間は距離が √2 倍なので、タイル間の進捗を距離で割る
    if (v.pi < v.path.length - 1 && v.pi + 1 > v.resTo && !this.signalsSys.extendReservation(v)) {
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
  alight(v: Vehicle, stop: Stop, route: Route, tick: number): void {
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

  arrive(v: Vehicle, route: Route, tick: number): void {
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

}
