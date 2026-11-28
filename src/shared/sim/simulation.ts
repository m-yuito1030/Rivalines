import type { GameMap } from '../world/gameMap';
import { isAiId } from './economy/aiCompanies';
import { Government, POLICIES, type GovInfo, classify, corporateTaxRate, policyOfDay, policyOfMonth, runningMul, stanceOfDay, LEVY_BASE, STANCES } from './economy/government';
import type { TownNews } from '../world/districts';
import { TOWN_REGION, growTown, makeRng, placeTowns, placeTownsRegion, type Rng } from '../world/towns';
import { Transit, type TransitSave } from './network/transit';
import type { Town } from '../world/town';
import { type RatingState, newRating, stepRating } from './economy/rating';
import { migrateStep } from './world/migration';
import { Company, FIRST_OWNER, RUNNING_RATE, TAX_RATE, TOLL, type CompanyState, vehiclePrice } from './economy/economy';
import { Pacts, type PactState } from './economy/pacts';
import { Weekly, type WeeklyState, playerMetrics } from './economy/weekly';
import { AUCTION_TYPES, Auctions, OPEN_EVERY_DAYS, type AuctionState } from './economy/auctions';
import { hash01 } from './world/events';
import { FACILITY_SPECS } from '../world/facilities';
import { createRivals, stepRivals, type Rival } from './economy/rivals';
import { processListings } from './facility/listings';
import { dailyVisitors } from './facility/facilityVisitors';
import { calendarOf, fiscalPeriodOf, quarterOf } from './world/calendar';
import { assetValue, type FiscalReport } from './economy/economy';
import { modelOf } from '../data/models';
import { spawnCityBusiness } from './facility/cityBusiness';
import { placePublicFacilities, placeTownHall } from './facility/publicFacilities';

/** State for restoring from a save */
export interface SimState {
  tick: number;
  speed: number;
  rng: number;
  towns: Town[];
  /** Huge map: the regions whose towns have been generated */
  townRegions?: number[];
  /** Buildings under construction [tile index, tick when they finish] (if absent, everything is finished) */
  sites?: [number, number][];
  /** Multiplayer: pacts (through-running agreements), auctions, and monopoly rights */
  pacts?: PactState;
  auctions?: AuctionState;
  weekly?: WeeklyState;
  /** Multiplayer: the government's treasury */
  gov?: { treasury: number };
  /** Multiplayer: each company's finances */
  players?: [number, CompanyState][];
  transit: TransitSave;
  rating?: RatingState;
  migrated?: number;
  facilities?: import('../world/facilities').Facility[];
  company?: CompanyState;
  rivals?: Rival[];
  rivalRng?: number;
  pubRng?: number;
  /** The recent news about the towns, and the next news number */
  news?: TownNews[];
  nextNewsId?: number;
}

/** 30 real minutes = 1 in-game day (at speed x1). 1 tick = 0.1 real seconds (x1) */
export const TICKS_PER_SECOND = 10;
export const TICKS_PER_DAY = 30 * 60 * TICKS_PER_SECOND;
/** Interval (ticks) for updating the company rating */
export const RATING_EVERY = 600;
/** Interval (ticks) for attempting migration */
export const MIGRATE_EVERY = 300;
/** Interval (ticks) at which towns consider building private facilities (department stores, etc.) */
export const CITY_EVERY = 1800;

export class Simulation {
  /** Amounts earned by vehicles and facilities since the last send (so the screen can show which one earned; cleared at every send) */
  readonly vehicleEarn = new Map<number, number>();
  readonly facilityEarn = new Map<number, number>();
  tick = 0;
  /** 0 = paused */
  speed = 1;
  private acc = 0;
  private rng: Rng;
  readonly transit: Transit;
  /** Company rating (updated every minute) */
  rating: RatingState = newRating();
  /** Multiplayer: companies (account ID -> company). A disconnected company's daily and fiscal processing stops */
  readonly players = new Map<number, Company>();
  readonly online = new Set<number>();
  /** Multiplayer: pacts (toll discounts) */
  readonly pacts = new Pacts();
  /** Multiplayer: auctions and monopoly rights */
  readonly auctions = new Auctions();
  /** Multiplayer: weekly ranking */
  readonly weekly = new Weekly();
  /** Multiplayer: the government (policies and the levy on large companies are derived from the date; only the treasury is state) */
  readonly gov = new Government();
  multi = false;
  /** Cumulative number of people who moved to areas where service started */
  migrated = 0;
  /** The company (funds, sales, costs, loans) */
  company = new Company();
  /** Multiplayer: get a company (created if absent) */
  playerCompany(id: number): Company {
    let c = this.players.get(id);
    if (!c) {
      c = new Company();
      c.buildMul = POLICIES[policyOfDay(this.map.seed, this.day)].buildMul;
      this.players.set(id, c);
    }
    return c;
  }

  /** Finish buildings whose construction is done (for ones demolished meanwhile, just drop the record) */
  private finishSites(): void {
    const m = this.map;
    for (const [i, at] of m.sites) {
      if (this.tick < at) continue;
      m.sites.delete(i);
      if (!m.construction.get(i)) continue;
      m.construction.set(i, 0);
      const x = i % m.size;
      m.touch(x, (i - x) / m.size);
    }
  }

  /** Multiplayer: delete a company (leaving or deletion). Facilities become listed properties; routes, vehicles, stops, and depots are removed */
  removePlayer(id: number): void {
    for (const r of [...this.transit.routes.values()]) if (r.owner === id) this.transit.removeRoute(r.id);
    for (const s of [...this.transit.stops.values()]) if (s.owner === id) this.transit.removeStop(s.id);
    for (const d of [...this.transit.depots.values()]) if (d.owner === id) this.transit.removeDepot(d.id);
    for (const s of this.transit.stops.values()) if (s.allow?.includes(id)) s.allow = s.allow.filter((x) => x !== id);
    this.transit.grants.delete(id);
    for (const g of this.transit.grants.values()) g.delete(id);
    let touched = false;
    for (const f of this.map.facilities) {
      if (f.playerId !== id) continue;
      f.owner = 'city';
      f.ownerId = undefined;
      f.playerId = undefined;
      f.listedDay = this.day;
      touched = true;
    }
    if (touched) this.map.facilityVer++;
    this.pacts.pacts = this.pacts.pacts.filter((p) => p.a !== id && p.b !== id);
    this.pacts.proposals = this.pacts.proposals.filter((p) => p.from !== id && p.to !== id);
    for (const l of this.auctions.lots) if (l.bid?.who === id) l.bid = undefined;
    this.auctions.rights = this.auctions.rights.filter((r) => r.owner !== id);
    // Rivals the company had acquired become independent again (otherwise they would stay owned by nobody, and nobody could buy them)
    for (const r of this.rivals) {
      if (r.acquired && r.acquiredBy === id) {
        r.acquired = false;
        r.acquiredBy = undefined;
      }
    }
    this.weekly.forget(id);
    this.players.delete(id);
    this.online.delete(id);
    this.transit.frozen.delete(id);
  }

  /** Multiplayer: update the companies that are logged in. A disconnected company's routes stop */
  setOnline(ids: Iterable<number>): void {
    this.online.clear();
    for (const i of ids) this.online.add(i);
    this.transit.frozen.clear();
    for (const id of this.players.keys()) if (!this.online.has(id)) this.transit.frozen.add(id);
  }

  /** Rival transit companies (can be acquired). Their random numbers are a separate stream from town growth */
  rivals: Rival[] = [];
  private rivalRng: Rng;
  /** Random numbers for placing public facilities (town halls, schools) (a separate stream from town growth) */
  private pubRng: Rng;
  /** Random numbers for facility visitors */
  private facRng: Rng;
  /** The running day number (start date = 0) */
  get day(): number {
    return Math.floor((this.tick + TICKS_PER_DAY / 4) / TICKS_PER_DAY);
  }

  constructor(
    readonly map: GameMap,
    restore?: SimState,
    opts: { multi?: boolean } = {},
  ) {
    this.multi = !!opts.multi;
    this.rng = makeRng(map.seed ^ 0x5bd1e995);
    this.transit = new Transit(map, this.rng);
    this.rivalRng = makeRng(map.seed ^ 0x2545f491);
    this.pubRng = makeRng(map.seed ^ 0x7f4a7c15);
    this.facRng = makeRng(map.seed ^ 0x3c6ef372);
    this.transit.onFare = (mode, amount, routeId, vehicleId) => {
      const r = this.transit.routes.get(routeId);
      if (vehicleId !== undefined && this.multi && r?.owner) this.vehicleEarn.set(vehicleId, (this.vehicleEarn.get(vehicleId) ?? 0) + amount);
      (this.multi && r?.owner ? this.playerCompany(r.owner) : this.company).fare(mode, amount);
      if (r) r.dayRevenue = (r.dayRevenue ?? 0) + amount;
    };
    this.transit.serviceMul = (owner) => (this.multi && owner ? this.playerCompany(owner) : this.company).serviceMul;
    this.transit.onVisit = (stop, n, tick) => this.company.visits(this.map, stop, n, tick, this.multi ? (f) => (f.playerId ? this.playerCompany(f.playerId) : null) : undefined);
    // Running over another company's infrastructure costs a toll (sharing tracks and roads)
    this.transit.onTile = (_v, route, tile) => {
      if (!this.multi || !route.owner) return;
      // A subway tile (no surface rail on it) belongs to whoever dug it
      const own = this.map.subwayVer !== 0 && this.map.subway.get(tile) && !this.map.rail.get(tile) ? this.map.subwayOwner.get(tile) : this.map.infraOwner.get(tile);
      if (!own || own === route.owner) return;
      const toll = (this.map.railAt(tile) ? TOLL.rail : TOLL.road) * (1 - this.pacts.discountBetween(route.owner, own));
      this.playerCompany(route.owner).pay('toll-out', toll);
      this.playerCompany(own).earn('toll-in', toll);
    };
    if (restore) {
      this.tick = restore.tick;
      this.speed = restore.speed;
      this.rng.setState(restore.rng);
      map.towns.push(...restore.towns);
      for (const r of restore.townRegions ?? []) map.townRegions.add(r);
      this.transit.restore(restore.transit);
      this.transit.repair(); // fix broken routes left in saved data by earlier bugs when loading
      if (restore.rating) this.rating = restore.rating;
      this.migrated = restore.migrated ?? 0;
      map.facilities.push(...(restore.facilities ?? []));
      map.facilityVer++;
      if (restore.company) this.company = Company.from(restore.company);
      for (const [id, c] of restore.players ?? []) this.players.set(id, Company.from(c));
      if (restore.pacts) this.pacts.load(restore.pacts);
      if (restore.auctions) this.auctions.load(restore.auctions);
      for (const [i, at] of restore.sites ?? []) {
        this.map.sites.set(i, at);
        this.map.construction.set(i, 1);
      }
      if (restore.weekly) this.weekly.load(restore.weekly);
      this.gov.load(restore.gov);
      this.news = restore.news ?? [];
      this.nextNewsId = restore.nextNewsId ?? 1;
      this.rivals = restore.rivals ?? createRivals(this.rivalRng, this.multi ? 20 : 4);
      if (restore.rivalRng !== undefined) this.rivalRng.setState(restore.rivalRng);
      if (restore.pubRng !== undefined) this.pubRng.setState(restore.pubRng);
    } else {
      if (map.chunked) this.discoverNear(map.size / 2, map.size / 2, 0, true);
      else placeTowns(map, this.rng, (t) => void placeTownHall(map, t, this.pubRng));
      this.rivals = createRivals(this.rivalRng, this.multi ? 20 : 4);
      placePublicFacilities(map, this.transit, this.pubRng); // the town hall is there from the start
    }
  }

  /**
   * Huge map: spawn towns in the regions around (x,y) (only regions not yet generated).
   * firstTwo: at the start, search in a spiral from the centre until two or more towns exist.
   */
  discoverNear(x: number, y: number, radius = 1, firstTwo = false): void {
    const map = this.map;
    if (!map.chunked) return;
    const n = Math.ceil(map.size / TOWN_REGION);
    const cx = Math.min(n - 1, Math.max(0, Math.floor(x / TOWN_REGION)));
    const cy = Math.min(n - 1, Math.max(0, Math.floor(y / TOWN_REGION)));
    const run = (r: number) => {
      for (let ry = cy - r; ry <= cy + r; ry++)
        for (let rx = cx - r; rx <= cx + r; rx++) {
          if (rx < 0 || ry < 0 || rx >= n || ry >= n) continue;
          const key = ry * n + rx;
          if (map.townRegions.has(key)) continue;
          map.townRegions.add(key);
          placeTownsRegion(map, rx, ry, (t) => void placeTownHall(map, t, this.pubRng));
        }
    };
    if (!firstTwo) return run(radius);
    for (let r = 1; r < n && map.towns.length < 2; r++) run(r);
  }

  /** Take out the state for saving */
  state(): SimState {
    return {
      tick: this.tick,
      speed: this.speed,
      rng: this.rng.getState(),
      pacts: this.pacts.toJSON(),
      auctions: this.auctions.toJSON(),
      sites: [...this.map.sites],
      weekly: this.weekly.toJSON(),
      gov: this.gov.toJSON(),
      players: [...this.players].map(([id, c]) => [id, c.toJSON()] as [number, CompanyState]),
      towns: this.map.towns,
      townRegions: [...this.map.townRegions],
      transit: this.transit.save(),
      rating: this.rating,
      migrated: this.migrated,
      facilities: this.map.facilities,
      company: this.company.toJSON(),
      rivals: this.rivals,
      rivalRng: this.rivalRng.getState(),
      pubRng: this.pubRng.getState(),
      news: this.news,
      nextNewsId: this.nextNewsId,
    };
  }

  /** Ticks advanced and time taken in the latest frame (for the HUD) */
  lastSteps = 0;
  lastMs = 0;
  /** Whether processing could not keep up and the speed is being reduced */
  throttled = false;

  /**
   * Pass the elapsed real seconds. Advances ticks according to the speed.
   * If the time budget (budgetMs) is exceeded, the rest is discarded and the game speed is lowered automatically (to prevent freezes).
   */
  advance(dtSec: number, budgetMs = 10): void {
    this.lastSteps = 0;
    this.lastMs = 0;
    if (this.speed === 0) return;
    this.acc += dtSec * TICKS_PER_SECOND * this.speed;
    const want = Math.floor(this.acc);
    this.acc -= want;
    const t0 = performance.now();
    let n = 0;
    this.throttled = false;
    while (n < want) {
      this.step();
      n++;
      if ((n & 3) === 0 && performance.now() - t0 > budgetMs) {
        this.throttled = n < want;
        break;
      }
    }
    this.lastSteps = n;
    this.lastMs = performance.now() - t0;
  }

  /** The recent news about the towns (newest last). Kept short; the clients show the latest */
  news: TownNews[] = [];
  private nextNewsId = 1;
  private readonly pushNews = (e: Omit<TownNews, 'id' | 'tick'>): void => {
    this.news.push({ ...e, id: this.nextNewsId++, tick: this.tick });
    if (this.news.length > 60) this.news.splice(0, this.news.length - 60);
  };

  step(): void {
    this.tick++;
    if (this.tick % 100 === 0) this.finishSites();
    for (const t of this.map.towns) if (this.tick >= t.nextGrowth) growTown(this.map, t, this.tick, this.rng, TICKS_PER_DAY, this.pushNews);
    this.transit.step(this.tick);
    if (this.tick % MIGRATE_EVERY === 0) this.migrated += migrateStep(this.map, this.transit, this.rng);
    if (this.tick % RATING_EVERY === 0) stepRating(this.rating, this.map, this.transit, Math.min(20, Math.max(0, this.multi ? 0 : -this.company.cash) / 1_000_000));
    if (this.tick % CITY_EVERY === 0) {
      spawnCityBusiness(this.map, this.transit, this.rng, 0.35, this.rivals);
      placePublicFacilities(this.map, this.transit, this.pubRng);
    }
    // The day close happens at 0:00 when the calendar date changes (the start is 6:00, so the first is 3/4 of a day after the start)
    if ((this.tick + TICKS_PER_DAY / 4) % TICKS_PER_DAY === 0) {
      const ended = (this.tick + TICKS_PER_DAY / 4) / TICKS_PER_DAY - 1; // the day being closed (start date = 0)
      // Facility visitors (decided by surrounding population, stops, rivals, and advertising). Book sales as today's before closing the day
      dailyVisitors(
        this.map,
        this.transit,
        ended,
        this.facRng,
        (f, amount) => {
          const c = this.multi ? (f.playerId ? this.playerCompany(f.playerId) : null) : this.company;
          if (c && (!this.multi || this.online.has(f.playerId!))) {
            c.earn('facility', amount);
            if (this.multi) this.facilityEarn.set(f.id, (this.facilityEarn.get(f.id) ?? 0) + amount);
          }
        },
        this.multi ? POLICIES[policyOfDay(this.map.seed, ended)].visitorMul : 1,
      );
      if (this.multi) {
        // The national policy of the day being closed sets the running-cost multiplier (a larger fleet pays more under an environmental policy)
        const policy = policyOfDay(this.map.seed, ended);
        const fleet = new Map<number, number>();
        for (const v of this.transit.vehicles) {
          const owner = this.transit.routes.get(v.routeId)?.owner;
          if (owner) fleet.set(owner, (fleet.get(owner) ?? 0) + 1);
        }
        let first = true;
        for (const [id, c] of this.players) {
          if (!this.online.has(id)) continue; // a disconnected company is left frozen
          if (first) FIRST_OWNER.id = id;
          first = false;
          c.govRunMul = runningMul(policy, fleet.get(id) ?? 0);
          c.endOfDay(ended, this.map, this.transit, this.rating.score, this.rivals, id);
        }
        this.governmentDay(ended);
      } else this.company.endOfDay(ended, this.map, this.transit, this.rating.score, this.rivals);
      // Listed properties: set listing dates and demolish those past their deadline, clearing the land
      processListings(this.map, this.day);
      if (this.multi) {
        this.auctionDay(ended);
        this.weekly.onDay(ended, [...this.online], (id) => playerMetrics(this, id)); // offline companies are frozen, so they are not counted (so many accounts do not make it heavy)
      }
      stepRivals(this.rivals, this.rivalRng);
      // The day that crosses a fiscal year (March 31 -> April 1) closes the books
      const a = calendarOf(ended);
      const b = calendarOf(ended + 1);
      const pa = fiscalPeriodOf(a.year, a.month);
      if (pa !== fiscalPeriodOf(b.year, b.month)) {
        if (this.multi) {
          // Corporate tax: large companies pay a higher rate, depending on the government's stance and policy
          const cls = classify(this.rankedOnline());
          const policy = policyOfDay(this.map.seed, ended);
          const stance = stanceOfDay(this.map.seed, ended);
          for (const [id, c] of this.players) {
            if (!this.online.has(id)) continue;
            c.taxRate = corporateTaxRate(TAX_RATE, cls.get(id) ?? 'none', policy, stance);
            c.closeFiscalYear(pa, assetValue(this.map, this.transit, this.rivals, id));
          }
        } else {
          const rep = this.company.closeFiscalYear(pa, assetValue(this.map, this.transit, this.rivals));
          this.onFiscalClose?.(rep);
        }
      }
      // Income and profit per day for each route (fare income - vehicle running cost)
      for (const r of this.transit.routes.values()) {
        const run = this.transit.vehicles.filter((v) => v.routeId === r.id).reduce((a, v) => a + vehiclePrice(modelOf(v.modelId), v.cars) * RUNNING_RATE, 0);
        r.income = (r.income ?? 0) * 0.8 + (r.dayRevenue ?? 0) * 0.2;
        r.profit = r.income - run;
        r.dayRevenue = 0;
      }
    }
  }

  /** The online companies with their net assets (for the government's size classes) */
  private rankedOnline(): { id: number; netWorth: number }[] {
    const out: { id: number; netWorth: number }[] = [];
    for (const id of this.online) {
      if (isAiId(id)) continue; // the government's size classes are for players only
      const c = this.players.get(id);
      if (c) out.push({ id, netWorth: c.netWorth(assetValue(this.map, this.transit, this.rivals, id)) });
    }
    return out;
  }

  /** Multiplayer: government work at a day close. At month end the large companies pay the levy and the treasury is paid out to the small ones; the next day's construction multiplier is set */
  private governmentDay(ended: number): void {
    const seed = this.map.seed;
    if (calendarOf(ended).month !== calendarOf(ended + 1).month) {
      const r = this.gov.monthly(this.rankedOnline(), policyOfDay(seed, ended), stanceOfDay(seed, ended));
      for (const [id, amount] of r.levies) this.players.get(id)?.pay('levy', amount);
      for (const [id, amount] of r.subsidies) this.players.get(id)?.earn('subsidy', amount);
    }
    const next = POLICIES[policyOfDay(seed, ended + 1)].buildMul;
    for (const c of this.players.values()) c.buildMul = next;
  }

  /** What to show a player about the government right now */
  govInfoFor(id: number): GovInfo {
    const seed = this.map.seed;
    const day = this.day;
    const d = calendarOf(day);
    const nm = d.month === 12 ? { y: d.year + 1, m: 1 } : { y: d.year, m: d.month + 1 };
    const ranked = this.rankedOnline();
    const size = classify(ranked).get(id) ?? 'none';
    const policy = policyOfDay(seed, day);
    const stance = stanceOfDay(seed, day);
    const nw = ranked.find((c) => c.id === id)?.netWorth ?? 0;
    const levy = size === 'large' && nw > 0 ? Math.round(nw * LEVY_BASE * POLICIES[policy].levyMul * STANCES[stance].levyMul) : 0;
    let changeDay = day + 1;
    while (changeDay - day < 40 && calendarOf(changeDay).month === d.month) changeDay++;
    return { policy, next: policyOfMonth(seed, nm.y, nm.m), stance, treasury: this.gov.treasury, size, levy, changeDay };
  }

  /** Multiplayer: settle auctions and open new ones (once per day close; starting from the most populous towns, decided by the date) */
  private auctionDay(day: number): void {
    this.auctions.settleDay((who, amount) => this.online.has(who) && this.playerCompany(who).spend('acquire', amount));
    if (day % OPEN_EVERY_DAYS !== 0) return;
    const towns = [...this.map.towns].sort((a, b) => b.pop - a.pop).slice(0, 30);
    if (!towns.length) return;
    const t = towns[Math.floor(hash01(this.map.seed, day, 11) * towns.length)];
    const type = AUCTION_TYPES[Math.floor(hash01(this.map.seed, day, 12) * AUCTION_TYPES.length)];
    this.auctions.open(t.id, type, Math.round((FACILITY_SPECS[type].cost * 0.5) / 100_000) * 100_000);
  }

  /** Called when a fiscal close (year end) happens */
  onFiscalClose?: (report: FiscalReport) => void;

  /** In-game date and time. Starts at 06:00 on April 1, 2026 and advances one day at a time on the real calendar. Includes the period (period N) and the quarter */
  get date() {
    const total = this.tick + TICKS_PER_DAY / 4;
    const days = Math.floor(total / TICKS_PER_DAY);
    const dayFrac = (total % TICKS_PER_DAY) / TICKS_PER_DAY;
    const minutes = Math.floor(dayFrac * 24 * 60);
    const c = calendarOf(days);
    return {
      year: c.year,
      month: c.month,
      day: c.day,
      weekday: c.weekday,
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
      period: fiscalPeriodOf(c.year, c.month),
      quarter: quarterOf(c.month),
    };
  }
}
