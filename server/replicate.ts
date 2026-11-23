import type { WebSocket } from 'ws';
import type { Simulation } from '../src/shared/sim/simulation';
import type { MyVeh, PlayerInfo, ServerMsg, TileRec, VehMsg } from '../src/shared/protocol';
import type { Vehicle } from '../src/shared/sim/network/transit';
import { CHUNK, CHUNK_SHIFT } from '../src/shared/world/tileLayer';
import { assetValue } from '../src/shared/sim/economy/economy';
import type { Accounts } from './accounts';
import { profitTotalOf } from '../src/shared/sim/economy/weekly';

/** 1クライアントが見ている範囲(タイル)の最大一辺。これを超える分は切り詰める */
const MAX_VIEW = 512;
const MARGIN = 24;
/** 1クライアントに、1フレームで新しく送るチャンクの最大数と、送信済みとして覚えておく最大数 */
const CHUNKS_PER_FRAME = 24;
/** 会社の一覧に載せる、オフラインの会社の数(時価総額の上位)と、1回の配信で計算し直す数 */
const OFFLINE_LISTED = 60;
const OFFLINE_REFRESH = 8;
const MAX_SENT_CHUNKS = 6000;

export interface Client {
  ws: WebSocket;
  id: number;
  name: string;
  view: { x0: number; y0: number; x1: number; y1: number };
  /** 送信済みのチャンク */
  sent: Set<number>;
  /** 経路を送った車両: id → 経路の識別 */
  paths: Map<number, number>;
  structVer: number;
  facVer: number;
  townCount: number;
  lastDiscover: number;
}

/** サーバーの世界をクライアントの視界に合わせて配信する(差分・視界内のみ) */
export class Replicator {
  private dirty = new Set<number>();
  private pathIds = new WeakMap<Uint32Array, number>();
  private nextPathId = 1;
  private lastStructAt = 0;
  private structCache: { ver: number; msg: string } | null = null;

  constructor(
    private sim: Simulation,
    private accounts: Accounts,
  ) {
    sim.map.onTouch = (x, y) => {
      if (x >= 0 && y >= 0 && x < sim.map.size && y < sim.map.size) this.dirty.add(sim.map.idx(x, y));
    };
  }

  newClient(ws: WebSocket, id: number, name: string): Client {
    return { ws, id, name, view: { x0: 0, y0: 0, x1: 0, y1: 0 }, sent: new Set(), paths: new Map(), structVer: -1, facVer: -1, townCount: -1, lastDiscover: 0 };
  }

  setView(c: Client, x0: number, y0: number, x1: number, y1: number): void {
    const cx = (x0 + x1) / 2;
    const cy = (y1 + y0) / 2;
    const hw = Math.min(MAX_VIEW, Math.max(8, x1 - x0)) / 2;
    const hh = Math.min(MAX_VIEW, Math.max(8, y1 - y0)) / 2;
    const S = this.sim.map.size;
    c.view = {
      x0: Math.max(0, Math.floor(cx - hw - MARGIN)),
      y0: Math.max(0, Math.floor(cy - hh - MARGIN)),
      x1: Math.min(S - 1, Math.ceil(cx + hw + MARGIN)),
      y1: Math.min(S - 1, Math.ceil(cy + hh + MARGIN)),
    };
  }

  private send(c: Client, m: ServerMsg): void {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m));
  }

  private chunkKey(cx: number, cy: number): number {
    return cy * Math.ceil(this.sim.map.size / CHUNK) + cx;
  }

  private tileRec(i: number): TileRec {
    const m = this.sim.map;
    return [i, m.road.get(i), m.rail.get(i), m.span.get(i), m.air.get(i), m.building.get(i), m.owner.get(i), m.infraOwner.get(i), m.edits.get(i) ?? -1];
  }

  private chunkMsg(cx: number, cy: number): ServerMsg {
    const m = this.sim.map;
    const tiles: number[][] = [];
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = (cx << CHUNK_SHIFT) + lx;
        const y = (cy << CHUNK_SHIFT) + ly;
        if (x >= m.size || y >= m.size) continue;
        const i = m.idx(x, y);
        const a = m.road.get(i),
          b = m.rail.get(i),
          c = m.span.get(i),
          d = m.air.get(i),
          e = m.building.get(i),
          f = m.owner.get(i),
          g = m.infraOwner.get(i);
        if (a | b | c | d | e | f | g) tiles.push([ly * CHUNK + lx, a, b, c, d, e, f, g]);
      }
    }
    const edits: [number, number][] = [];
    for (const [i, h] of m.edits) {
      const x = i % m.size;
      const y = (i - x) / m.size;
      if (x >> CHUNK_SHIFT === cx && y >> CHUNK_SHIFT === cy) edits.push([i, h]);
    }
    return { type: 'chunk', cx, cy, tiles, edits };
  }

  private vehMsg(c: Client, v: Vehicle): VehMsg {
    const pid = this.pathIds.get(v.path) ?? (this.pathIds.set(v.path, this.nextPathId), this.nextPathId++);
    const out: VehMsg = {
      id: v.id,
      routeId: v.routeId,
      modelId: v.modelId,
      mode: v.mode,
      order: v.order,
      pi: v.pi,
      t: v.t,
      state: v.state,
      load: v.load,
      cap: v.cap,
      speed: v.speed,
      trail: v.trail,
      len: v.len,
      flight: v.flight,
      hx: v.hx,
      hy: v.hy,
      dir: v.dir,
      stuck: v.stuck,
      cars: v.cars,
      hold: v.hold,
      resTo: v.resTo,
    };
    if (c.paths.get(v.id) !== pid) {
      out.path = Array.from(v.path);
      c.paths.set(v.id, pid);
    }
    return out;
  }

  private inView(c: Client, v: Vehicle): boolean {
    const m = this.sim.map;
    const { x0, y0, x1, y1 } = c.view;
    if (v.flight) {
      const f = v.flight as { x0: number; y0: number; x1: number; y1: number };
      return Math.max(f.x0, f.x1) >= x0 && Math.min(f.x0, f.x1) <= x1 && Math.max(f.y0, f.y1) >= y0 && Math.min(f.y0, f.y1) <= y1;
    }
    const t = v.path[Math.min(v.pi, v.path.length - 1)];
    const x = t % m.size;
    const y = (t - x) / m.size;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }

  /** 約10Hz: 視界内の車両・変化したタイル・新しく見えたチャンク */
  frame(clients: Iterable<Client>): void {
    const sim = this.sim;
    const dirtyTiles = [...this.dirty];
    this.dirty.clear();
    for (const c of clients) {
      const { x0, y0, x1, y1 } = c.view;
      if (x1 <= x0 && y1 <= y0) continue; // まだ視界を知らせていない
      // 新しく視界に入ったチャンク(1フレームに送る数に上限。残りは次のフレーム。視界を次々変える攻撃で、サーバーが地図データ作りに追われないように)
      if (c.sent.size > MAX_SENT_CHUNKS) c.sent.clear(); // 送信済みの記憶が増え続けないように(忘れても、見えたときに送り直すだけ)
      let budget = CHUNKS_PER_FRAME;
      const cw = Math.ceil(sim.map.size / CHUNK);
      for (let cy = y0 >> CHUNK_SHIFT; cy <= y1 >> CHUNK_SHIFT; cy++) {
        for (let cx = x0 >> CHUNK_SHIFT; cx <= x1 >> CHUNK_SHIFT; cx++) {
          if (cx >= cw || cy >= cw) continue;
          const key = this.chunkKey(cx, cy);
          if (c.sent.has(key)) continue;
          if (budget-- <= 0) continue;
          c.sent.add(key);
          this.send(c, this.chunkMsg(cx, cy));
        }
      }
      const tiles: TileRec[] = [];
      for (const i of dirtyTiles) {
        const x = i % sim.map.size;
        const y = (i - x) / sim.map.size;
        if (c.sent.has(this.chunkKey(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT))) tiles.push(this.tileRec(i));
      }
      const veh: VehMsg[] = [];
      const present = new Set<number>();
      for (const v of sim.transit.vehicles) {
        if (!this.inView(c, v)) continue;
        present.add(v.id);
        veh.push(this.vehMsg(c, v));
      }
      const gone: number[] = [];
      for (const id of c.paths.keys()) if (!present.has(id)) gone.push(id);
      for (const id of gone) c.paths.delete(id);
      this.send(c, { type: 'frame', tick: sim.tick, veh, gone, tiles });
      // 視界の周辺に街を生み出す
      const now = Date.now();
      if (now - c.lastDiscover > 1000) {
        c.lastDiscover = now;
        sim.discoverNear((x0 + x1) / 2, (y0 + y1) / 2, 1);
      }
    }
  }

  /** 構造(停留所・路線・基地・信号・街・施設)。変化があったクライアントにだけ送る */
  structure(clients: Iterable<Client>): void {
    const sim = this.sim;
    const now = Date.now();
    for (const c of clients) {
      if (c.structVer !== sim.transit.version && now - this.lastStructAt > 400) {
        c.structVer = sim.transit.version;
        // 構造は全員同じ内容なので、版ごとに1回だけ作る(ダイヤの走行時間の計算が重いため)
        if (!this.structCache || this.structCache.ver !== sim.transit.version) {
          const t = sim.transit;
          this.structCache = {
            ver: t.version,
            msg: JSON.stringify({
              type: 'struct',
              nextId: t.idCounter,
              routes: [...t.routes.values()].map((r) => ({
                ...r,
                vs: t.vehicles.filter((v) => v.routeId === r.id).map((v) => [v.id, v.offset]),
                legs: r.orders.some((o) => o.kind === 'timed') ? t.legsOf(r) : undefined,
              })),
              stops: [...t.stops.values()].map((s) => ({ ...s, wait: [] })),
              depots: [...t.depots.values()],
              signals: [...t.signals],
              grants: [...t.grants].map(([o, l]) => [o, [...l]]),
            }),
          };
        }
        if (c.ws.readyState === 1) c.ws.send(this.structCache.msg);
      }
      if (c.facVer !== sim.map.facilityVer) {
        c.facVer = sim.map.facilityVer;
        this.send(c, { type: 'fac', facilities: sim.map.facilities });
      }
      if (c.townCount !== sim.map.towns.length) {
        c.townCount = sim.map.towns.length;
        this.send(c, { type: 'towns', towns: sim.map.towns.map((t) => ({ ...t, roads: [] })) });
      }
    }
    if (now - this.lastStructAt > 400) this.lastStructAt = now;
  }

  /** 1秒ごと: 自社の経営・競合・評価・ランキングなど */
  misc(clients: Iterable<Client>): void {
    const sim = this.sim;
    const players = this.playerInfos();
    const online = players.filter((p) => p.online).map((p) => p.name);
    const waiting: [number, number][] = [];
    for (const s of sim.transit.stops.values()) if (s.waiting > 0) waiting.push([s.id, Math.floor(s.waiting)]);
    // 自社の車両の概要(視界外も含む)。持ち主ごとに1回だけ集める
    const mine = new Map<number, MyVeh[]>();
    for (const v of sim.transit.vehicles) {
      const owner = sim.transit.routes.get(v.routeId)?.owner;
      if (!owner) continue;
      let pos: { x: number; y: number };
      if (v.mode === 'air') pos = sim.transit.planePos(v);
      else {
        const i = v.path[Math.min(v.pi, v.path.length - 1)];
        const x = i % sim.map.size;
        pos = { x, y: (i - x) / sim.map.size };
      }
      let l = mine.get(owner);
      if (!l) mine.set(owner, (l = []));
      l.push([
        v.id,
        v.routeId,
        v.modelId,
        v.mode,
        Math.round(pos.x),
        Math.round(pos.y),
        v.hold ? 3 : v.state === 'noroute' ? 2 : v.state === 'load' ? 1 : 0,
        v.cap ? Math.round((v.load / v.cap) * 100) : 0,
        v.cars,
      ]);
    }
    // 路線の収入・利益・輸送人数は日々変わるが、構造(struct)は変更があったときしか送られないので、ここで毎回送る
    const routeStats: [number, number, number, number][] = [...sim.transit.routes.values()].map((r) => [r.id, r.income ?? 0, r.profit ?? 0, r.carried ?? 0]);
    for (const c of clients) {
      this.send(c, {
        type: 'misc',
        routeStats,
        myVehicles: mine.get(c.id) ?? [],
        tick: sim.tick,
        company: sim.playerCompany(c.id).toJSON(),
        rivals: sim.rivals,
        rating: sim.rating,
        delivered: sim.transit.delivered,
        transfers: sim.transit.transfers,
        waiting,
        players,
        online,
        pacts: sim.pacts.toJSON(),
        auctions: sim.auctions.toJSON(),
        weekly: sim.weekly.toJSON(),
      });
    }
  }

  /** 会社1社ぶんの一覧用の情報(資産の評価などを計算するので、全員ぶんを毎回は求めない) */
  private computeInfo(id: number): PlayerInfo | null {
    const sim = this.sim;
    const co = sim.players.get(id);
    const a = this.accounts.byId(id);
    if (!co || !a) return null;
    const assets = assetValue(sim.map, sim.transit, sim.rivals, id);
    let passengers = 0;
    for (const r of sim.transit.routes.values()) if (r.owner === id) passengers += r.carried ?? 0;
    return {
      id,
      name: a.name,
      company: a.company || a.name,
      bio: a.bio ?? '',
      color: a.color,
      online: sim.online.has(id),
      marketCap: co.marketCap,
      price: co.stock,
      netWorth: co.netWorth(assets),
      profit: co.profitStats().avg,
      passengers: Math.floor(passengers),
      profitTotal: profitTotalOf(co),
    };
  }

  /** オフラインの会社の、最後に計算した一覧用の情報 */
  private infoCache = new Map<number, PlayerInfo>();
  private refreshCursor = 0;

  /**
   * 配信する会社の一覧。アカウントの数に上限がないので、全員ぶんは送らない:
   * オンラインの会社は毎回計算し、オフラインの会社は、時価総額の上位 OFFLINE_LISTED 社だけを出す
   * (オフラインの会社は止まっているので、1回に OFFLINE_REFRESH 社ずつ順番に計算し直せば足りる)
   */
  private playerInfos(): PlayerInfo[] {
    const sim = this.sim;
    const out: PlayerInfo[] = [];
    const offline: number[] = [];
    for (const id of sim.players.keys()) {
      if (!sim.online.has(id)) {
        offline.push(id);
        continue;
      }
      const info = this.computeInfo(id);
      if (info) {
        this.infoCache.set(id, info);
        out.push(info);
      }
    }
    for (let k = 0; k < Math.min(OFFLINE_REFRESH, offline.length); k++) {
      const id = offline[this.refreshCursor++ % offline.length];
      const info = this.computeInfo(id);
      if (info) this.infoCache.set(id, info);
    }
    const listed: PlayerInfo[] = [];
    for (const id of offline) {
      const info = this.infoCache.get(id);
      if (info) listed.push({ ...info, online: false });
    }
    listed.sort((x, y) => y.marketCap - x.marketCap);
    out.push(...listed.slice(0, OFFLINE_LISTED));
    return out;
  }
}
