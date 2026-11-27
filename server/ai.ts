import type { Simulation } from '../src/shared/sim/simulation';
import { TICKS_PER_DAY } from '../src/shared/sim/simulation';
import type { Town } from '../src/shared/world/town';
import { CONN, DX, DY } from '../src/shared/world/directions';
import { AI_ID_BASE, AI_MAX } from '../src/shared/sim/economy/aiCompanies';
import { hash01 } from '../src/shared/sim/world/events';
import { planRoad, type Tile } from '../src/shared/sim/ai/roadPlanner';
import { modelOf } from '../src/shared/data/models';
import { vehiclePrice } from '../src/shared/sim/economy/economy';
import { execute } from './commands/index';
import { PRICES } from './economyApi';

/** Game ticks between one AI action and the next (one action lays a few road tiles, or does one step of the project) */
export const AI_STEP_TICKS = 100;
/** Road edges laid per action (kept small, so a road visibly grows instead of appearing at once) */
export const EDGES_PER_STEP = 12;
/** Towns closer or farther than this (tiles) are not linked */
const MIN_DIST = 20;
const MAX_DIST = 300;
/** Most routes one AI company runs */
const MAX_ROUTES = 8;
/** Wait this long after finishing a project, and after something fails */
const COOLDOWN = 2400;
const RETRY = 900;

type Stage = 'road' | 'stops' | 'depot' | 'route' | 'fleet';

interface Project {
  a: Town;
  b: Town;
  path: Tile[];
  cursor: number;
  stage: Stage;
  stops: number[];
  routeId?: number;
  want: number;
  model: string;
}

interface AiState {
  id: number;
  nextAt: number;
  home?: Town;
  /** Towns this company already links, and the town pairs it has linked (as "a-b") */
  connected: Set<number>;
  links: Set<string>;
  failed: Set<string>;
  project?: Project;
  routes: number;
}

const pairKey = (a: Town, b: Town) => (a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`);
const dist = (a: Tile, b: Tile) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The computer-run companies: each one links nearby towns with a road, puts a bus stop in each, a depot, a route, and buses, step by step.
 * It uses the same commands a player would (so cost, ownership, and rules are the same), and waits when it cannot afford the next step.
 * Everything here is plain rules. Nothing is saved: after a restart a company starts a fresh project, and reuses the roads and stops already built.
 */
export class AiPlanner {
  private readonly states: AiState[] = [];

  constructor(
    private readonly sim: Simulation,
    count: number,
  ) {
    const n = Math.max(0, Math.min(AI_MAX, Math.floor(count)));
    for (let i = 0; i < n; i++) this.states.push({ id: AI_ID_BASE + i, nextAt: 0, connected: new Set(), links: new Set(), failed: new Set(), routes: 0 });
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
      s.nextAt = tick + this.act(s);
    }
  }

  /** One action for one company. Returns how many ticks to wait before the next */
  private act(s: AiState): number {
    const sim = this.sim;
    const co = sim.playerCompany(s.id);
    if (!s.project) {
      if (s.routes >= MAX_ROUTES) return TICKS_PER_DAY;
      const p = this.startProject(s);
      if (!p) return RETRY * 2;
      if (co.cash < p.path.length * PRICES.road * 1.3) return RETRY * 2; // too poor for this road for now (keep waiting, the project is not started)
      s.project = p;
      return AI_STEP_TICKS;
    }
    const p = s.project;
    switch (p.stage) {
      case 'road':
        return this.layRoad(s, p);
      case 'stops':
        return this.placeStops(s, p);
      case 'depot':
        return this.placeDepot(s, p);
      case 'route':
        return this.makeRoute(s, p);
      case 'fleet':
        return this.buyBuses(s, p);
    }
  }

  private giveUp(s: AiState, p: Project): number {
    s.failed.add(pairKey(p.a, p.b));
    s.project = undefined;
    return RETRY;
  }

  /** Choose the next pair of towns to link, and plan the road between them. null if there is nothing to do now */
  private startProject(s: AiState): Project | null {
    const map = this.sim.map;
    const towns = map.towns.filter((t) => t.roads.length > 3);
    if (towns.length < 2) return null;
    if (!s.home) {
      const pool = [...towns].sort((x, y) => y.pop - x.pop).slice(0, Math.min(10, towns.length));
      s.home = pool[Math.floor(hash01(map.seed, s.id, 5) * pool.length)];
    }
    const from = s.connected.size ? towns.filter((t) => s.connected.has(t.id)) : [s.home];
    let best: { a: Town; b: Town; d: number } | null = null;
    for (const a of from) {
      for (const b of towns) {
        if (b.id === a.id || s.connected.has(b.id) || s.failed.has(pairKey(a, b))) continue;
        const d = dist(a, b);
        if (d < MIN_DIST || d > MAX_DIST) continue;
        // Prefer near towns, and a little the bigger ones
        const score = d - Math.min(30, b.pop / 40);
        if (!best || score < best.d) best = { a, b, d: score };
      }
    }
    if (!best) return null;
    const ends = this.townEnds(best.a, best.b);
    if (!ends) {
      s.failed.add(pairKey(best.a, best.b));
      return null;
    }
    const path = planRoad(map, ends.a, ends.b);
    if (!path || path.length < 2) {
      s.failed.add(pairKey(best.a, best.b));
      return null;
    }
    const pop = Math.min(best.a.pop, best.b.pop);
    return { a: best.a, b: best.b, path, cursor: 0, stage: 'road', stops: [], want: Math.min(5, 2 + Math.floor(pop / 500)), model: pop >= 400 ? 'bus-l' : 'bus-s' };
  }

  /** The road tiles of two towns that are closest to each other (where the new road leaves one town and joins the other) */
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

  /** Lay a few more edges of the road */
  private layRoad(s: AiState, p: Project): number {
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

  /** A bus stop at each end (on the new road, as close to the town as it goes) */
  private placeStops(s: AiState, p: Project): number {
    const len = p.path.length;
    const tryAt = (order: number[]): number | null => {
      for (const i of order) {
        const t = p.path[i];
        const r = execute(this.sim, s.id, { t: 'ensureStop', x: t.x, y: t.y, kind: 'road' });
        if (r.ok && r.id !== undefined) return r.id;
      }
      return null;
    };
    const near = Array.from({ length: Math.min(12, len) }, (_, i) => i);
    const far = Array.from({ length: Math.min(12, len) }, (_, i) => len - 1 - i);
    const sa = tryAt(near);
    const sb = tryAt(far);
    if (sa === null || sb === null || sa === sb) return this.giveUp(s, p);
    p.stops = [sa, sb];
    p.stage = 'depot';
    return AI_STEP_TICKS;
  }

  /** A depot beside the first stop, unless the company already has one nearby */
  private placeDepot(s: AiState, p: Project): number {
    const t = this.sim.transit;
    const have = [...t.depots.values()].some((d) => d.owner === s.id && dist(d, p.path[0]) < 60);
    if (!have) {
      let ok = false;
      for (let i = 1; i < Math.min(20, p.path.length) && !ok; i++) {
        const tile = p.path[i];
        ok = execute(this.sim, s.id, { t: 'place', tool: 'depot', x: tile.x, y: tile.y }).ok;
      }
      if (!ok) return this.giveUp(s, p);
    }
    p.stage = 'route';
    return AI_STEP_TICKS;
  }

  private makeRoute(s: AiState, p: Project): number {
    const r = execute(this.sim, s.id, { t: 'routeCreate', stops: p.stops });
    if (!r.ok || r.id === undefined) return this.giveUp(s, p);
    p.routeId = r.id;
    p.stage = 'fleet';
    return AI_STEP_TICKS;
  }

  /** Buy the buses, one at a time, as money allows. When there are enough, the project is done */
  private buyBuses(s: AiState, p: Project): number {
    const t = this.sim.transit;
    const have = t.vehicles.filter((v) => v.routeId === p.routeId).length;
    if (have >= p.want) {
      s.connected.add(p.a.id);
      s.connected.add(p.b.id);
      s.links.add(pairKey(p.a, p.b));
      s.routes++;
      s.project = undefined;
      return COOLDOWN;
    }
    const co = this.sim.playerCompany(s.id);
    if (co.cash < vehiclePrice(modelOf(p.model), 1) * 2) return RETRY;
    const r = execute(this.sim, s.id, { t: 'buyVehicle', routeId: p.routeId!, modelId: p.model, cars: 1 });
    if (!r.ok && have === 0) return this.giveUp(s, p); // not even one bus could run: the route is no use
    return AI_STEP_TICKS * 3;
  }
}
