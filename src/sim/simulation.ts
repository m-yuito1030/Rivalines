import type { GameMap } from '../world/gameMap';
import { TOWN_REGION, growTown, makeRng, placeTowns, placeTownsRegion, type Rng } from '../world/towns';
import { Transit, type TransitSave } from './transit';
import type { Town } from '../world/town';
import { type RatingState, newRating, stepRating } from './rating';
import { migrateStep } from './migration';
import { Company, FIRST_OWNER, RUNNING_RATE, TOLL, type CompanyState, vehiclePrice } from './economy';
import { Pacts, type PactState } from './pacts';
import { Weekly, type WeeklyState, playerMetrics } from './weekly';
import { AUCTION_TYPES, Auctions, OPEN_EVERY_DAYS, type AuctionState } from './auctions';
import { hash01 } from './events';
import { FACILITY_SPECS } from '../world/facilities';
import { createRivals, stepRivals, type Rival } from './rivals';
import { dailyVisitors } from './facilityVisitors';
import { calendarOf, fiscalPeriodOf, quarterOf } from './calendar';
import { assetValue, type FiscalReport } from './economy';
import { modelOf } from '../data/models';
import { spawnCityBusiness } from './cityBusiness';
import { placePublicFacilities, placeTownHall } from './publicFacilities';

/** セーブから復元するための状態 */
export interface SimState {
  tick: number;
  speed: number;
  rng: number;
  towns: Town[];
  /** 巨大マップ: 街を生成済みの区画 */
  townRegions?: number[];
  /** マルチプレイ: 提携(乗り入れ契約)・入札と独占権 */
  pacts?: PactState;
  auctions?: AuctionState;
  weekly?: WeeklyState;
  /** マルチプレイ: 会社ごとの経営 */
  players?: [number, CompanyState][];
  transit: TransitSave;
  rating?: RatingState;
  migrated?: number;
  facilities?: import('../world/facilities').Facility[];
  company?: CompanyState;
  rivals?: Rival[];
  rivalRng?: number;
  pubRng?: number;
}

/** 実時間30分 = ゲーム内1日(速度x1)。1tick = 実0.1秒(x1) */
export const TICKS_PER_SECOND = 10;
export const TICKS_PER_DAY = 30 * 60 * TICKS_PER_SECOND;
/** 会社の評価を更新する間隔(tick) */
export const RATING_EVERY = 600;
/** 人口移動を試みる間隔(tick) */
export const MIGRATE_EVERY = 300;
/** 街が民間の施設(百貨店など)を建てるか検討する間隔(tick) */
export const CITY_EVERY = 1800;

export class Simulation {
  tick = 0;
  /** 0=一時停止 */
  speed = 1;
  private acc = 0;
  private rng: Rng;
  readonly transit: Transit;
  /** 会社の評価(1分ごとに更新) */
  rating: RatingState = newRating();
  /** マルチプレイ: 会社(アカウントID → 会社)。切断中の会社は日次・決算の処理を止める */
  readonly players = new Map<number, Company>();
  readonly online = new Set<number>();
  /** マルチプレイ: 提携(通行料の割引) */
  readonly pacts = new Pacts();
  /** マルチプレイ: 入札(競り)と独占権 */
  readonly auctions = new Auctions();
  /** マルチプレイ: 週間ランキング */
  readonly weekly = new Weekly();
  multi = false;
  /** 運行が始まった地域へ移住した人数(累計) */
  migrated = 0;
  /** 会社(資金・売上・費用・融資) */
  company = new Company();
  /** マルチプレイ: 会社を取り出す(なければ新設) */
  playerCompany(id: number): Company {
    let c = this.players.get(id);
    if (!c) {
      c = new Company();
      this.players.set(id, c);
    }
    return c;
  }

  /** マルチプレイ: ログイン中の会社を更新する。切断中の会社の路線は止まる */
  setOnline(ids: Iterable<number>): void {
    this.online.clear();
    for (const i of ids) this.online.add(i);
    this.transit.frozen.clear();
    for (const id of this.players.keys()) if (!this.online.has(id)) this.transit.frozen.add(id);
  }

  /** 競合する交通会社(買収できる)。乱数は街の成長とは別系列 */
  rivals: Rival[] = [];
  private rivalRng: Rng;
  /** 公共施設(市役所・学校)の配置用の乱数(街の成長の乱数とは別系列) */
  private pubRng: Rng;
  /** 施設の来場者の乱数 */
  private facRng: Rng;
  /** いまの日の通し番号(開始日=0) */
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
    this.transit.onFare = (mode, amount, routeId) => {
      const r = this.transit.routes.get(routeId);
      (this.multi && r?.owner ? this.playerCompany(r.owner) : this.company).fare(mode, amount);
      if (r) r.dayRevenue = (r.dayRevenue ?? 0) + amount;
    };
    this.transit.serviceMul = (owner) => (this.multi && owner ? this.playerCompany(owner) : this.company).serviceMul;
    this.transit.onVisit = (stop, n, tick) => this.company.visits(this.map, stop, n, tick, this.multi ? (f) => (f.playerId ? this.playerCompany(f.playerId) : null) : undefined);
    // 他社のインフラを走ると通行料(線路・道路の共有)
    this.transit.onTile = (_v, route, tile) => {
      if (!this.multi || !route.owner) return;
      const own = this.map.infraOwner.get(tile);
      if (!own || own === route.owner) return;
      const toll = (this.map.rail.get(tile) ? TOLL.rail : TOLL.road) * (1 - this.pacts.discountBetween(route.owner, own));
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
      if (restore.rating) this.rating = restore.rating;
      this.migrated = restore.migrated ?? 0;
      map.facilities.push(...(restore.facilities ?? []));
      map.facilityVer++;
      if (restore.company) this.company = Company.from(restore.company);
      for (const [id, c] of restore.players ?? []) this.players.set(id, Company.from(c));
      if (restore.pacts) this.pacts.load(restore.pacts);
      if (restore.auctions) this.auctions.load(restore.auctions);
      if (restore.weekly) this.weekly.load(restore.weekly);
      this.rivals = restore.rivals ?? createRivals(this.rivalRng, this.multi ? 20 : 4);
      if (restore.rivalRng !== undefined) this.rivalRng.setState(restore.rivalRng);
      if (restore.pubRng !== undefined) this.pubRng.setState(restore.pubRng);
    } else {
      if (map.chunked) this.discoverNear(map.size / 2, map.size / 2, 0, true);
      else placeTowns(map, this.rng, (t) => void placeTownHall(map, t, this.pubRng));
      this.rivals = createRivals(this.rivalRng, this.multi ? 20 : 4);
      placePublicFacilities(map, this.transit, this.pubRng); // 市役所は最初から建っている
    }
  }

  /**
   * 巨大マップ: (x,y) の周囲の区画に街を生み出す(未生成の区画だけ)。
   * firstTwo: 開始時、街が2つ以上できるまで中心から渦巻き状に探す。
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

  /** セーブ用に状態を取り出す */
  state(): SimState {
    return { tick: this.tick, speed: this.speed, rng: this.rng.getState(), pacts: this.pacts.toJSON(), auctions: this.auctions.toJSON(), weekly: this.weekly.toJSON(), players: [...this.players].map(([id, c]) => [id, c.toJSON()] as [number, CompanyState]), towns: this.map.towns, townRegions: [...this.map.townRegions], transit: this.transit.save(), rating: this.rating, migrated: this.migrated, facilities: this.map.facilities, company: this.company.toJSON(), rivals: this.rivals, rivalRng: this.rivalRng.getState(), pubRng: this.pubRng.getState() };
  }

  /** 直近のフレームで進めたtick数と所要時間(HUD用) */
  lastSteps = 0;
  lastMs = 0;
  /** 処理が追いつかず、速度を落として進めているか */
  throttled = false;

  /**
   * 実経過秒を渡す。速度に応じてtickを進める。
   * 時間予算(budgetMs)を超えたら残りは捨て、ゲーム速度を自動的に落とす(フリーズ防止)。
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

  step(): void {
    this.tick++;
    for (const t of this.map.towns) if (this.tick >= t.nextGrowth) growTown(this.map, t, this.tick, this.rng);
    this.transit.step(this.tick);
    if (this.tick % MIGRATE_EVERY === 0) this.migrated += migrateStep(this.map, this.transit, this.rng);
    if (this.tick % RATING_EVERY === 0) stepRating(this.rating, this.map, this.transit, Math.min(20, Math.max(0, this.multi ? 0 : -this.company.cash) / 1_000_000));
    if (this.tick % CITY_EVERY === 0) {
      spawnCityBusiness(this.map, this.transit, this.rng, 0.35, this.rivals);
      placePublicFacilities(this.map, this.transit, this.pubRng);
    }
    // 日の締めは暦の日付が変わる 0:00 に行う(開始は6:00なので、開始から 3/4 日後が最初)
    if ((this.tick + TICKS_PER_DAY / 4) % TICKS_PER_DAY === 0) {
      const ended = (this.tick + TICKS_PER_DAY / 4) / TICKS_PER_DAY - 1; // 今締める日(開始日=0)
      // 施設の来場者(周辺の人口・停留所・競合・広告で決まる)。売上は今日の分として計上してから日を締める
      dailyVisitors(this.map, this.transit, ended, this.facRng, (f, amount) => {
        const c = this.multi ? (f.playerId ? this.playerCompany(f.playerId) : null) : this.company;
        if (c && (!this.multi || this.online.has(f.playerId!))) c.earn('facility', amount);
      });
      if (this.multi) {
        let first = true;
        for (const [id, c] of this.players) {
          if (!this.online.has(id)) continue; // 切断中はそのまま止める
          if (first) FIRST_OWNER.id = id;
          first = false;
          c.endOfDay(ended, this.map, this.transit, this.rating.score, this.rivals, id);
        }
      } else this.company.endOfDay(ended, this.map, this.transit, this.rating.score, this.rivals);
      if (this.multi) {
        this.auctionDay(ended);
        this.weekly.onDay(ended, [...this.players.keys()], (id) => playerMetrics(this, id));
      }
      stepRivals(this.rivals, this.rivalRng);
      // 事業年度をまたぐ日(3月31日→4月1日)は決算
      const a = calendarOf(ended);
      const b = calendarOf(ended + 1);
      const pa = fiscalPeriodOf(a.year, a.month);
      if (pa !== fiscalPeriodOf(b.year, b.month)) {
        if (this.multi) {
          for (const [id, c] of this.players) if (this.online.has(id)) c.closeFiscalYear(pa, assetValue(this.map, this.transit, this.rivals, id));
        } else {
          const rep = this.company.closeFiscalYear(pa, assetValue(this.map, this.transit, this.rivals));
          this.onFiscalClose?.(rep);
        }
      }
      // 路線ごとの1日あたり収入と利益(運賃収入 - 車両の運行費)
      for (const r of this.transit.routes.values()) {
        const run = this.transit.vehicles.filter((v) => v.routeId === r.id).reduce((a, v) => a + vehiclePrice(modelOf(v.modelId), v.cars) * RUNNING_RATE, 0);
        r.income = (r.income ?? 0) * 0.8 + (r.dayRevenue ?? 0) * 0.2;
        r.profit = r.income - run;
        r.dayRevenue = 0;
      }
    }
  }

  /** マルチプレイ: 競りの決着と、新しい競りを開く(日締めに1回。人口の多い街から、日付で決まる) */
  private auctionDay(day: number): void {
    this.auctions.settleDay((who, amount) => this.online.has(who) && this.playerCompany(who).spend('acquire', amount));
    if (day % OPEN_EVERY_DAYS !== 0) return;
    const towns = [...this.map.towns].sort((a, b) => b.pop - a.pop).slice(0, 30);
    if (!towns.length) return;
    const t = towns[Math.floor(hash01(this.map.seed, day, 11) * towns.length)];
    const type = AUCTION_TYPES[Math.floor(hash01(this.map.seed, day, 12) * AUCTION_TYPES.length)];
    this.auctions.open(t.id, type, Math.round((FACILITY_SPECS[type].cost * 0.5) / 100_000) * 100_000);
  }

  /** 決算(事業年度の締め)が行われたときに呼ばれる */
  onFiscalClose?: (report: FiscalReport) => void;

  /** ゲーム内日時。2026年4月1日 06:00 開始、実際の暦で1日ずつ進む。期(第N期)・四半期つき */
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
