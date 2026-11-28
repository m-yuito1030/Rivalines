import type { WebSocket } from 'ws';
import { aiProfile } from '../src/shared/sim/economy/aiCompanies';
import type { Simulation } from '../src/shared/sim/simulation';
import type { MyVeh, PlayerInfo, ServerMsg, TileRec, VehMsg } from '../src/shared/protocol';
import type { Vehicle } from '../src/shared/sim/network/transit';
import { CHUNK, CHUNK_SHIFT } from '../src/shared/world/tileLayer';
import { assetValue } from '../src/shared/sim/economy/economy';
import type { Accounts } from './accounts';
import { profitTotalOf } from '../src/shared/sim/economy/weekly';

/** Max side length (tiles) of the area one client may watch. Anything beyond is clipped */
const MAX_VIEW = 512;
const MARGIN = 24;
/** Max chunks newly sent to one client per frame, and the max number remembered as already sent */
const CHUNKS_PER_FRAME = 24;
/** How many offline companies appear in the company list (top by market cap), and how many are recomputed per broadcast */
const OFFLINE_LISTED = 60;
const OFFLINE_REFRESH = 8;
const MAX_SENT_CHUNKS = 6000;

export interface Client {
  ws: WebSocket;
  id: number;
  name: string;
  view: { x0: number; y0: number; x1: number; y1: number };
  /** Chunks already sent */
  sent: Set<number>;
  /** Vehicles whose path was sent: id -> path identity */
  paths: Map<number, number>;
  structVer: number;
  facVer: number;
  townCount: number;
  lastDiscover: number;
}

/** Streams the server's world to each client for just its own view (differences only, in-view only) */
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
    return [
      i,
      m.road.get(i),
      m.rail.get(i),
      m.span.get(i),
      m.air.get(i),
      m.building.get(i),
      m.owner.get(i),
      m.infraOwner.get(i),
      m.edits.get(i) ?? -1,
      m.construction.get(i),
      m.subway.get(i),
      m.subwayOwner.get(i),
    ];
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
          g = m.infraOwner.get(i),
          k = m.construction.get(i),
          sw = m.subway.get(i),
          so = m.subwayOwner.get(i);
        if (a | b | c | d | e | f | g | sw) tiles.push([ly * CHUNK + lx, a, b, c, d, e, f, g, k, sw, so]);
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
      on: v.on ?? 0,
      off: v.off ?? 0,
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

  /** About 10 Hz: in-view vehicles, changed tiles, and newly visible chunks */
  frame(clients: Iterable<Client>): void {
    const sim = this.sim;
    const dirtyTiles = [...this.dirty];
    this.dirty.clear();
    for (const c of clients) {
      const { x0, y0, x1, y1 } = c.view;
      if (x1 <= x0 && y1 <= y0) continue; // this client has not reported a view yet
      // Chunks that newly came into view (capped per frame; the rest go next frame, so an attack that keeps changing the view cannot keep the server busy generating map data)
      if (c.sent.size > MAX_SENT_CHUNKS) c.sent.clear(); // keep the sent-set from growing forever (forgetting only means resending when the chunk is seen again)
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
      // Amounts earned by the company's own vehicles and facilities (the client draws them above whatever earned them)
      const earn: [number, number][] = [];
      for (const [vid, amt] of sim.vehicleEarn) {
        const v = sim.transit.vehicles.find((x) => x.id === vid);
        if (v && sim.transit.routes.get(v.routeId)?.owner === c.id && amt >= 1) earn.push([vid, Math.round(amt)]);
      }
      const facEarn: [number, number][] = [];
      for (const [fid, amt] of sim.facilityEarn) {
        const f = sim.map.facilities.find((x) => x.id === fid);
        if (f && f.playerId === c.id && amt >= 1) facEarn.push([fid, Math.round(amt)]);
      }
      this.send(c, { type: 'frame', tick: sim.tick, veh, gone, tiles, ...(earn.length ? { earn } : {}), ...(facEarn.length ? { facEarn } : {}) });
      // Spawn towns around the view
      const now = Date.now();
      if (now - c.lastDiscover > 1000) {
        c.lastDiscover = now;
        sim.discoverNear((x0 + x1) / 2, (y0 + y1) / 2, 1);
      }
    }
    sim.vehicleEarn.clear();
    sim.facilityEarn.clear();
  }

  /** Structure (stops, routes, depots, signals, towns, facilities). Sent only to clients where something changed */
  structure(clients: Iterable<Client>): void {
    const sim = this.sim;
    const now = Date.now();
    for (const c of clients) {
      if (c.structVer !== sim.transit.version && now - this.lastStructAt > 400) {
        c.structVer = sim.transit.version;
        // The structure is the same for everyone, so build it once per version (computing the diagram's travel times is expensive)
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

  /** Every second: the company's finances, rivals, rating, rankings, and so on */
  misc(clients: Iterable<Client>): void {
    const sim = this.sim;
    const players = this.playerInfos();
    const online = players.filter((p) => p.online).map((p) => p.name);
    const waiting: [number, number][] = [];
    for (const s of sim.transit.stops.values()) if (s.waiting > 0) waiting.push([s.id, Math.floor(s.waiting)]);
    // Summary of the company's own vehicles (including out-of-view ones). Collected once per owner
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
    // Route income, profit, and passengers carried change every day, but the structure (struct) is only sent on change, so send them here every time
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
        gov: sim.govInfoFor(c.id),
      });
    }
  }

  /** List info for one company (computing asset value and so on is costly, so it is not done for everyone every time) */
  private computeInfo(id: number): PlayerInfo | null {
    const sim = this.sim;
    const co = sim.players.get(id);
    const a = this.accounts.byId(id);
    const profile = aiProfile(id);
    if (!co || (!a && !profile)) return null;
    const assets = assetValue(sim.map, sim.transit, sim.rivals, id);
    let passengers = 0;
    for (const r of sim.transit.routes.values()) if (r.owner === id) passengers += r.carried ?? 0;
    return {
      id,
      name: a?.name ?? profile!.name,
      company: a ? a.company || a.name : profile!.name,
      bio: a?.bio ?? '',
      color: a?.color ?? profile!.color,
      ...(profile ? { ai: { kind: profile.kind, style: profile.style } } : {}),
      online: sim.online.has(id),
      marketCap: co.marketCap,
      price: co.stock,
      netWorth: co.netWorth(assets),
      profit: co.profitStats().avg,
      passengers: Math.floor(passengers),
      profitTotal: profitTotalOf(co),
    };
  }

  /** The list info last computed for an offline company */
  private infoCache = new Map<number, PlayerInfo>();
  private refreshCursor = 0;

  /**
   * The company list to broadcast. There is no cap on the number of accounts, so it is not sent for everyone:
   * online companies are computed every time, and offline ones only for the top OFFLINE_LISTED by market cap
   * (offline companies are frozen, so recomputing OFFLINE_REFRESH of them at a time in rotation is enough)
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
