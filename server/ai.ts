import type { Simulation } from '../src/shared/sim/simulation';
import { TICKS_PER_DAY } from '../src/shared/sim/simulation';
import type { Town } from '../src/shared/world/town';
import { CONN, DX, DY } from '../src/shared/world/directions';
import { DX8, DY8 } from '../src/shared/world/directions';
import { autoRailPath } from '../src/shared/world/rails';
import { DESIGN_COUNT, facilityCost, type FacilityType } from '../src/shared/world/facilities';
import type { PlaceTool } from '../src/shared/protocol';
import { listedFacilities } from '../src/shared/sim/facility/listings';
import { AI_ID_BASE, AI_MAX, AI_PROFILES, type AiKind, type AiStyle } from '../src/shared/sim/economy/aiCompanies';
import { hash01 } from '../src/shared/sim/world/events';
import { planRoad, type Tile } from '../src/shared/sim/ai/roadPlanner';
import { TRAIN_MODELS, clampCars, modelOf } from '../src/shared/data/models';
import { facilityValue, vehiclePrice } from '../src/shared/sim/economy/economy';
import { execute } from './commands/index';
import { PRICES } from './economyApi';
import { hasSub } from '../src/shared/world/subway';
import { subwayCost, subwayLine } from '../src/shared/world/subway';
import { lineTiles } from '../src/shared/world/roads';

/** Game ticks between one AI action and the next, before the company's style speeds it up or slows it down */
export const AI_STEP_TICKS = 100;
/** Road / rail edges laid per action (kept small, so a line visibly grows instead of appearing at once) */
export const EDGES_PER_STEP = 12;
/** Towns closer than this (tiles) are not linked */
const MIN_DIST = 20;
/** Wait this long after something fails */
const RETRY = 900;
/** A railway links two towns by subway instead when they are closer than this (tiles), about half of the time */
const SUBWAY_MAX_DIST = 90;
/** The platform length of the stations a railway builds */
const STATION_LEN = 5;

/** How each style plays. Aggressive: fast, thin cash, borrows, long and many lines. Cautious: slow, a cash reserve, short and few lines */
export const STYLES: Record<
  AiStyle,
  { pace: number; reserve: number; borrow: boolean; maxRoutes: number; maxDist: number; wantBonus: number; cooldown: number; estateMax: number; railCars: number }
> = {
  aggressive: { pace: 0.6, reserve: 3_000_000, borrow: true, maxRoutes: 12, maxDist: 320, wantBonus: 1, cooldown: 600, estateMax: 14, railCars: 6 },
  cautious: { pace: 1.6, reserve: 12_000_000, borrow: false, maxRoutes: 5, maxDist: 220, wantBonus: 0, cooldown: 3600, estateMax: 6, railCars: 4 },
};
/** The most an aggressive company borrows in total */
const BORROW_CAP = 25_000_000;
const BORROW_STEP = 5_000_000;

type BusStage = 'road' | 'stops' | 'depot' | 'route' | 'fleet';
type RailStage = 'stations' | 'lay' | 'depot' | 'route' | 'fleet';

interface Edge {
  a: Tile;
  b: Tile;
}

interface BusProject {
  type: 'bus';
  a: Town;
  b: Town;
  path: Tile[];
  cursor: number;
  stage: BusStage;
  stops: number[];
  routeId?: number;
  want: number;
  model: string;
}

interface RailProject {
  type: 'rail';
  a: Town;
  b: Town;
  stage: RailStage;
  stations: number[];
  /** The platform end tile facing the other town, and the tile just outside it, for each station */
  ends: { end: Tile; out: Tile }[];
  edges: Edge[];
  /** Tiles of the line itself (for finding a straight place for the depot) */
  line: Tile[];
  cursor: number;
  routeId?: number;
  /** A subway project: the tiles of the line with their depths (the line has two stops, one tile in from each end) */
  sub?: { x: number; y: number; depth: number }[];
}

type Project = BusProject | RailProject;

interface AiState {
  id: number;
  kind: AiKind;
  style: AiStyle;
  nextAt: number;
  home?: Town;
  /** Towns this company already links, and the town pairs it has linked (as "a-b") */
  connected: Set<number>;
  failed: Set<string>;
  project?: Project;
  routes: number;
  /** Counts what a general company has done, to rotate through bus, real estate, and rail */
  turn: number;
  /** How many home towns it has given up on (a home with no town it can reach is replaced by the next biggest town) */
  homeTries: number;
}

const pairKey = (a: Town, b: Town) => (a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`);
const dist = (a: Tile, b: Tile) => Math.hypot(a.x - b.x, a.y - b.y);
const ESTATE_TYPES: (FacilityType & PlaceTool)[] = ['hotel', 'park', 'department', 'mall'];

/**
 * The computer-run companies. Each has a specialty (bus, rail, real estate, or general) and a style (aggressive or cautious), see aiCompanies.ts.
 * They use the same commands a player would (so cost, ownership, and rules are the same), do a little at a time, and wait when they cannot afford the next step.
 * Everything here is plain rules. Nothing is saved: after a restart a company starts afresh, and reuses the roads, stops, and facilities already built.
 */
export class AiPlanner {
  private readonly states: AiState[] = [];

  constructor(
    private readonly sim: Simulation,
    count: number,
  ) {
    const n = Math.max(0, Math.min(AI_MAX, Math.floor(count)));
    for (let i = 0; i < n; i++) {
      const p = AI_PROFILES[i];
      this.states.push({ id: AI_ID_BASE + i, kind: p.kind, style: p.style, nextAt: 0, connected: new Set(), failed: new Set(), routes: 0, turn: 0, homeTries: 0 });
    }
  }

  /** The IDs of the AI companies (they are always "online": they run whenever the world runs) */
  get ids(): number[] {
    return this.states.map((s) => s.id);
  }

  /** Create the companies (a restored world already has them) and stagger their first actions */
  init(): void {
    this.states.forEach((s, i) => {
      this.sim.playerCompany(s.id);
      s.nextAt = this.sim.tick + 60 + i * 40;
    });
  }

  /** Call every game tick (cheap when nothing is due) */
  step(): void {
    const tick = this.sim.tick;
    for (const s of this.states) {
      if (tick < s.nextAt) continue;
      s.nextAt = tick + Math.max(20, Math.round(this.act(s) * STYLES[s.style].pace));
    }
  }

  // ---- money ----

  /** Whether the company can spend `amount` and still keep its cash reserve. An aggressive company borrows when short (and says no this time) */
  private canSpend(s: AiState, amount: number): boolean {
    const co = this.sim.playerCompany(s.id);
    const st = STYLES[s.style];
    if (co.cash - amount >= st.reserve) return true;
    if (st.borrow && co.loan < BORROW_CAP) execute(this.sim, s.id, { t: 'fin', op: 'borrow', amount: BORROW_STEP });
    return false;
  }

  // ---- what to do next ----

  /** One action for one company. Returns how many ticks to wait before the next */
  private act(s: AiState): number {
    if (s.project) return s.project.type === 'bus' ? this.busStep(s, s.project) : this.railStep(s, s.project);
    const st = STYLES[s.style];
    const kind: AiKind = s.kind === 'general' ? (['bus', 'estate', 'rail', 'estate'] as const)[s.turn++ % 4] : s.kind;
    if (kind === 'estate') return this.estateStep(s);
    if (s.routes >= st.maxRoutes) return s.kind === 'general' ? this.estateStep(s) : TICKS_PER_DAY;
    const p = kind === 'rail' ? this.startRail(s) : this.startBus(s);
    if (!p) return s.kind === 'general' ? this.estateStep(s) : RETRY * 2;
    s.project = p;
    return AI_STEP_TICKS;
  }

  private giveUp(s: AiState, p: Project): number {
    s.failed.add(pairKey(p.a, p.b));
    s.project = undefined;
    return RETRY;
  }

  /** The pair of towns to link next: from a town already linked (or home), to the best unlinked town within reach */
  private choosePair(s: AiState): { a: Town; b: Town } | null {
    const map = this.sim.map;
    const towns = map.towns.filter((t) => t.roads.length > 3);
    if (towns.length < 2) return null;
    if (!s.home) {
      const pool = [...towns].sort((x, y) => y.pop - x.pop).slice(0, Math.min(10, towns.length));
      s.home = pool[(Math.floor(hash01(map.seed, s.id, 5) * pool.length) + s.homeTries) % pool.length];
    }
    const from = s.connected.size ? towns.filter((t) => s.connected.has(t.id)) : [s.home];
    const maxDist = STYLES[s.style].maxDist;
    let best: { a: Town; b: Town; d: number } | null = null;
    for (const a of from) {
      for (const b of towns) {
        if (b.id === a.id || s.connected.has(b.id) || s.failed.has(pairKey(a, b))) continue;
        const d = dist(a, b);
        if (d < MIN_DIST || d > maxDist) continue;
        const score = d - Math.min(30, b.pop / 40); // near towns first, a little the bigger ones
        if (!best || score < best.d) best = { a, b, d: score };
      }
    }
    if (!best && !s.connected.size && s.homeTries < 10) {
      // Nothing within reach of the home town (or every try failed): move the home to another big town and try again next time
      s.homeTries++;
      s.home = undefined;
    }
    return best ? { a: best.a, b: best.b } : null;
  }

  /** The road tiles of two towns that are closest to each other */
  private townEnds(a: Town, b: Town): { a: Tile; b: Tile } | null {
    const map = this.sim.map;
    const closest = (t: Town, to: Town): Tile | null => {
      let best: Tile | null = null;
      let bd = Infinity;
      const step = Math.max(1, Math.floor(t.roads.length / 800));
      for (let k = 0; k < t.roads.length; k += step) {
        const i = t.roads[k];
        if (map.road.get(i) === 0) continue;
        const x = i % map.size;
        const y = Math.floor(i / map.size);
        const d = Math.hypot(x - to.x, y - to.y);
        if (d < bd) {
          bd = d;
          best = { x, y };
        }
      }
      return best;
    };
    const ta = closest(a, b);
    const tb = closest(b, a);
    return ta && tb ? { a: ta, b: tb } : null;
  }

  // ---- bus ----

  private startBus(s: AiState): BusProject | null {
    const pair = this.choosePair(s);
    if (!pair) return null;
    const ends = this.townEnds(pair.a, pair.b);
    const path = ends ? planRoad(this.sim.map, ends.a, ends.b) : null;
    if (!path || path.length < 2) {
      s.failed.add(pairKey(pair.a, pair.b));
      return null;
    }
    if (!this.canSpend(s, path.length * PRICES.road * 1.3)) return null; // too poor for this road for now
    const pop = Math.min(pair.a.pop, pair.b.pop);
    const st = STYLES[s.style];
    return {
      type: 'bus',
      a: pair.a,
      b: pair.b,
      path,
      cursor: 0,
      stage: 'road',
      stops: [],
      want: Math.min(6, 2 + st.wantBonus + Math.floor(pop / 500)),
      model: pop >= 400 ? 'bus-l' : 'bus-s',
    };
  }

  private busStep(s: AiState, p: BusProject): number {
    switch (p.stage) {
      case 'road':
        return this.layRoad(s, p);
      case 'stops':
        return this.placeBusStops(s, p);
      case 'depot':
        return this.placeDepot(s, p, 'road', p.path, 1, 20);
      case 'route':
        return this.makeRoute(s, p);
      case 'fleet':
        return this.buyBuses(s, p);
    }
  }

  private layRoad(s: AiState, p: BusProject): number {
    const map = this.sim.map;
    const co = this.sim.playerCompany(s.id);
    let laid = 0;
    while (laid < EDGES_PER_STEP && p.cursor < p.path.length - 1) {
      const a = p.path[p.cursor];
      const b = p.path[p.cursor + 1];
      const d = DX.findIndex((dx, k) => dx === b.x - a.x && DY[k] === b.y - a.y);
      const ia = map.idx(a.x, a.y);
      if (d < 0) return this.giveUp(s, p);
      if (!(map.road.get(ia) & CONN(d))) {
        if (co.cash < PRICES.road * 2) return RETRY; // wait for money (stay where we are)
        execute(this.sim, s.id, { t: 'build', tool: 'road', a, b });
        if (!(map.road.get(ia) & CONN(d))) return this.giveUp(s, p); // the world changed under the plan: try another pair
      }
      p.cursor++;
      laid++;
    }
    if (p.cursor >= p.path.length - 1) p.stage = 'stops';
    return AI_STEP_TICKS;
  }

  private placeBusStops(s: AiState, p: BusProject): number {
    const len = p.path.length;
    const tryAt = (order: number[]): number | null => {
      for (const i of order) {
        const t = p.path[i];
        const r = execute(this.sim, s.id, { t: 'ensureStop', x: t.x, y: t.y, kind: 'road' });
        if (r.ok && r.id !== undefined) return r.id;
      }
      return null;
    };
    const sa = tryAt(Array.from({ length: Math.min(12, len) }, (_, i) => i));
    const sb = tryAt(Array.from({ length: Math.min(12, len) }, (_, i) => len - 1 - i));
    if (sa === null || sb === null || sa === sb) return this.giveUp(s, p);
    p.stops = [sa, sb];
    p.stage = 'depot';
    return AI_STEP_TICKS;
  }

  private buyBuses(s: AiState, p: BusProject): number {
    const t = this.sim.transit;
    const have = t.vehicles.filter((v) => v.routeId === p.routeId).length;
    if (have >= p.want) return this.finish(s, p);
    if (!this.canSpend(s, vehiclePrice(modelOf(p.model), 1) * 1.2)) return RETRY;
    const r = execute(this.sim, s.id, { t: 'buyVehicle', routeId: p.routeId!, modelId: p.model, cars: 1 });
    if (!r.ok && have === 0) return this.giveUp(s, p); // not even one bus could run: the route is no use
    return AI_STEP_TICKS * 3;
  }

  // ---- steps shared by bus and rail ----

  /** A depot of the given kind near the start of the line (reused if the company already has one nearby) */
  private placeDepot(s: AiState, p: Project, kind: 'road' | 'rail', tiles: Tile[], from: number, upTo: number): number {
    const t = this.sim.transit;
    const near = tiles[Math.min(from, tiles.length - 1)];
    const have = [...t.depots.values()].some((d) => d.kind === kind && d.owner === s.id && dist(d, near) < 60);
    if (!have) {
      let ok = false;
      for (let i = from; i < Math.min(upTo, tiles.length) && !ok; i++)
        ok = execute(this.sim, s.id, { t: 'place', tool: 'depot', x: tiles[i].x, y: tiles[i].y, ...(kind === 'rail' ? { kind } : {}) }).ok;
      if (!ok) return this.giveUp(s, p);
    }
    p.stage = 'route';
    return AI_STEP_TICKS;
  }

  private makeRoute(s: AiState, p: Project): number {
    const stops = p.type === 'bus' ? p.stops : p.stations;
    const r = execute(this.sim, s.id, { t: 'routeCreate', stops });
    if (!r.ok || r.id === undefined) return this.giveUp(s, p);
    p.routeId = r.id;
    p.stage = 'fleet';
    return AI_STEP_TICKS;
  }

  /** A project is done: remember the towns as linked, and rest a while before the next */
  private finish(s: AiState, p: Project): number {
    s.connected.add(p.a.id);
    s.connected.add(p.b.id);
    s.routes++;
    s.project = undefined;
    return STYLES[s.style].cooldown;
  }

  // ---- rail ----

  private startRail(s: AiState): RailProject | null {
    const pair = this.choosePair(s);
    if (!pair) return null;
    // A station, a line, a depot, and a train cost a lot: wait until the company can pay for the whole thing and keep its reserve
    const sub = dist(pair.a, pair.b) <= SUBWAY_MAX_DIST && hash01(this.sim.map.seed, s.id, s.routes + 7) < 0.5;
    if (sub) {
      const tiles = Math.abs(pair.a.x - pair.b.x) + Math.abs(pair.a.y - pair.b.y) + 3;
      if (!this.canSpend(s, tiles * subwayCost(3) + 2 * (PRICES.stationBase + PRICES.stationTile) + PRICES.depotRail + 6_000_000)) return null;
      return { type: 'rail', a: pair.a, b: pair.b, stage: 'stations', stations: [], ends: [], edges: [], line: [], cursor: 0, sub: [] };
    }
    const estimate = dist(pair.a, pair.b) * 1.3 * PRICES.rail + 2 * (PRICES.stationBase + PRICES.stationTile * STATION_LEN) + PRICES.depotRail + 6_000_000;
    if (!this.canSpend(s, estimate)) return null;
    return { type: 'rail', a: pair.a, b: pair.b, stage: 'stations', stations: [], ends: [], edges: [], line: [], cursor: 0 };
  }

  private railStep(s: AiState, p: RailProject): number {
    switch (p.stage) {
      case 'stations':
        return this.placeStations(s, p);
      case 'lay':
        return this.layRail(s, p);
      case 'depot':
        return this.placeDepot(s, p, 'rail', p.line, 2, 40);
      case 'route':
        return this.makeRoute(s, p);
      case 'fleet':
        return this.buyTrain(s, p);
    }
  }

  /** One station beside a town, as close to the other town as it can be, lying along the direction between them */
  private placeStation(s: AiState, town: Town, toward: Town): { id: number; end: Tile; out: Tile } | null {
    const axis: 0 | 1 = Math.abs(toward.x - town.x) >= Math.abs(toward.y - town.y) ? 1 : 0;
    const cand: Tile[] = [];
    for (const r of [4, 6, 8, 11, 14, 18])
      for (let k = 0; k < 16; k++) cand.push({ x: Math.round(town.x + r * Math.cos((k * Math.PI) / 8)), y: Math.round(town.y + r * Math.sin((k * Math.PI) / 8)) });
    cand.sort((u, v) => dist(u, toward) - dist(v, toward));
    for (const c of cand.slice(0, 70)) {
      const r = execute(this.sim, s.id, { t: 'place', tool: 'station', x: c.x, y: c.y, opts: { axis, len: STATION_LEN, tracks: 1, design: 0 } });
      if (!r.ok || r.id === undefined) continue;
      const east = axis === 1 ? toward.x >= c.x : toward.y >= c.y;
      const end = axis === 1 ? { x: east ? c.x + STATION_LEN - 1 : c.x, y: c.y } : { x: c.x, y: east ? c.y + STATION_LEN - 1 : c.y };
      const step = east ? 1 : -1;
      const out = axis === 1 ? { x: end.x + step, y: end.y } : { x: end.x, y: end.y + step };
      return { id: r.id, end, out };
    }
    return null;
  }

  private placeStations(s: AiState, p: RailProject): number {
    if (p.sub) return this.planSubway(s, p);
    const sa = this.placeStation(s, p.a, p.b);
    const sb = sa ? this.placeStation(s, p.b, p.a) : null;
    if (!sa || !sb) return this.giveUp(s, p);
    const path = autoRailPath(this.sim.map, sa.out, sb.out);
    if (!path || path.length < 2) return this.giveUp(s, p);
    p.stations = [sa.id, sb.id];
    p.ends = [sa, sb];
    p.line = path.map((t) => ({ x: t.x, y: t.y }));
    p.edges = [{ a: sa.end, b: sa.out }, ...path.slice(0, -1).map((t, i) => ({ a: { x: t.x, y: t.y }, b: { x: path[i + 1].x, y: path[i + 1].y } })), { a: sb.out, b: sb.end }];
    p.stage = 'lay';
    return AI_STEP_TICKS;
  }

  /** Plan a subway between two towns: an L-shaped line under the streets, sloping from depth 2 at the ends to depth 3 at the corner */
  private planSubway(s: AiState, p: RailProject): number {
    const A = { x: Math.round(p.a.x), y: Math.round(p.a.y) };
    const B = { x: Math.round(p.b.x), y: Math.round(p.b.y) };
    const C = { x: B.x, y: A.y };
    const n1 = Math.abs(C.x - A.x);
    const n2 = Math.abs(B.y - C.y);
    // The stops sit one tile in from each end, on straight track: each straight run needs room for them
    if ((n1 > 0 && n1 < 3) || (n2 > 0 && n2 < 3) || n1 + n2 < 6) return this.giveUp(s, p);
    const first = subwayLine(A, C, 2, n1 > 0 ? 3 : 2) ?? lineTiles(A.x, A.y, C.x, C.y).map((t) => ({ ...t, depth: 2 }));
    const second = subwayLine(C, B, n1 > 0 ? 3 : 2, 2) ?? lineTiles(C.x, C.y, B.x, B.y).map((t) => ({ ...t, depth: 2 }));
    const tiles = [...first, ...second.slice(1)].map((t) => ({ x: t.x, y: t.y, depth: t.depth }));
    const map = this.sim.map;
    // Land only, and not where a surface rail already runs
    if (tiles.some((t) => !map.inBounds(t.x, t.y) || map.levelAt(t.x, t.y) <= 0 || map.rail.get(map.idx(t.x, t.y)) !== 0)) return this.giveUp(s, p);
    p.sub = tiles;
    p.line = tiles.map((t) => ({ x: t.x, y: t.y }));
    p.edges = tiles.slice(0, -1).map((t, i) => ({ a: { x: t.x, y: t.y }, b: { x: tiles[i + 1].x, y: tiles[i + 1].y } }));
    p.stage = 'lay';
    return AI_STEP_TICKS;
  }

  /** Lay the next few edges of a subway, and when the line is done put the two stops on it */
  private laySubway(s: AiState, p: RailProject, sub: { x: number; y: number; depth: number }[]): number {
    const map = this.sim.map;
    const co = this.sim.playerCompany(s.id);
    let laid = 0;
    while (laid < EDGES_PER_STEP && p.cursor < p.edges.length) {
      const { a, b } = p.edges[p.cursor];
      const nb = sub[p.cursor + 1];
      if (co.cash < subwayCost(4) * 2) return RETRY;
      execute(this.sim, s.id, { t: 'build', tool: 'subway', a, b, z: [sub[p.cursor].depth, nb.depth] });
      if (!hasSub(map.subway.get(map.idx(b.x, b.y)))) return this.giveUp(s, p);
      p.cursor++;
      laid++;
    }
    if (p.cursor >= p.edges.length) {
      const ids: number[] = [];
      for (const t of [sub[1], sub[sub.length - 2]]) {
        const r = execute(this.sim, s.id, { t: 'ensureStop', x: t.x, y: t.y, kind: 'rail' });
        if (!r.ok || r.id === undefined) return this.giveUp(s, p);
        ids.push(r.id);
      }
      p.stations = ids;
      p.stage = 'depot';
    }
    return AI_STEP_TICKS;
  }

  private layRail(s: AiState, p: RailProject): number {
    if (p.sub) return this.laySubway(s, p, p.sub);
    const map = this.sim.map;
    const co = this.sim.playerCompany(s.id);
    let laid = 0;
    while (laid < EDGES_PER_STEP && p.cursor < p.edges.length) {
      const { a, b } = p.edges[p.cursor];
      const d = DX8.findIndex((dx, k) => dx === b.x - a.x && DY8[k] === b.y - a.y);
      if (d < 0) return this.giveUp(s, p);
      const ia = map.idx(a.x, a.y);
      if (!(map.rail.get(ia) & (1 << d))) {
        if (co.cash < PRICES.rail * 2) return RETRY;
        execute(this.sim, s.id, { t: 'build', tool: 'rail', a, b });
        if (!(map.rail.get(ia) & (1 << d))) return this.giveUp(s, p);
      }
      p.cursor++;
      laid++;
    }
    if (p.cursor >= p.edges.length) p.stage = 'depot';
    return AI_STEP_TICKS;
  }

  /** One train per line (a single track: two trains running toward each other would block one another) */
  private buyTrain(s: AiState, p: RailProject): number {
    const t = this.sim.transit;
    if (t.vehicles.some((v) => v.routeId === p.routeId)) return this.finish(s, p);
    const m = TRAIN_MODELS.find((x) => x.kind === 'ローカル') ?? TRAIN_MODELS[0];
    const cars = clampCars(m, STYLES[s.style].railCars);
    if (!this.canSpend(s, vehiclePrice(m, cars) * 1.2)) return RETRY;
    const r = execute(this.sim, s.id, { t: 'buyVehicle', routeId: p.routeId!, modelId: m.id, cars });
    if (!r.ok) return this.giveUp(s, p);
    return AI_STEP_TICKS * 3;
  }

  // ---- real estate ----

  /** Buy a listed property, or build a new facility in a big town, or improve one it owns. One thing per action */
  private estateStep(s: AiState): number {
    const sim = this.sim;
    const map = sim.map;
    const co = sim.playerCompany(s.id);
    const st = STYLES[s.style];
    const mine = map.facilities.filter((f) => f.playerId === s.id && (f.owner ?? 'player') === 'player');
    // 1. A property for sale at its asking price, the cheapest first (towns put new ones up all the time)
    if (mine.length < st.estateMax) {
      const listed = listedFacilities(map)
        .filter((f) => this.canSpendQuiet(s, facilityValue(f)))
        .sort((x, y) => facilityValue(x) - facilityValue(y));
      if (listed.length && execute(sim, s.id, { t: 'fin', op: 'acquire', id: listed[0].id }).ok) return AI_STEP_TICKS * 2;
    }
    // 2. A new facility in one of the bigger towns (they take turns, so the facilities spread out)
    if (mine.length < st.estateMax) {
      const towns = [...map.towns]
        .filter((t) => t.pop >= 300)
        .sort((a, b) => b.pop - a.pop)
        .slice(0, 12);
      const type = ESTATE_TYPES[(s.turn++ + s.id) % ESTATE_TYPES.length];
      const size = st.reserve > 5_000_000 ? 'S' : 'M';
      if (towns.length && this.canSpend(s, facilityCost(type, size) * 1.1)) {
        const t = towns[(s.turn + s.id) % towns.length];
        const designs = DESIGN_COUNT[type] ?? 20;
        for (let k = 0; k < 30; k++) {
          const r = 3 + Math.floor(k / 6) * 2;
          const x = Math.round(t.x + r * Math.cos((k * Math.PI) / 3 + t.id));
          const y = Math.round(t.y + r * Math.sin((k * Math.PI) / 3 + t.id));
          const res = execute(sim, s.id, { t: 'place', tool: type, x, y, fac: { design: Math.floor(hash01(map.seed, s.id, s.turn + k) * designs), size } });
          if (res.ok) return AI_STEP_TICKS * 2;
        }
        return RETRY;
      }
      return RETRY;
    }
    // 3. Everything is built: improve what it owns while there is cash to spare
    if (this.canSpendQuiet(s, 6_000_000) && mine.length) {
      const f = mine[(s.turn++ + s.id) % mine.length];
      execute(sim, s.id, { t: 'facUpgrade', facilityId: f.id });
    }
    return TICKS_PER_DAY / 2 + (co.cash > 0 ? 0 : RETRY);
  }

  /** canSpend without borrowing */
  private canSpendQuiet(s: AiState, amount: number): boolean {
    return this.sim.playerCompany(s.id).cash - amount >= STYLES[s.style].reserve;
  }
}
