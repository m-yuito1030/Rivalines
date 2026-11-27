import { demandMul, elasticity, priceMul } from '../facility/pricing';
import { gradeOf as facilityGrade, gradeSpendMul, repMul, repOf } from '../../world/facilityQuality';
import { type VehicleModel, modelOf } from '../../data/models';
import { FACILITY_SPECS, type Facility, facilityAttract, facilityBuildCost, facilityUpkeep, hourFactor } from '../../world/facilities';
import type { GameMap } from '../../world/gameMap';
import type { Mode } from '../../data/models';
import { DAY_TICKS, type Stop, type Transit, todOf } from '../network/transit';
import type { Rival } from './rivals';
import { fiscalRange } from '../world/calendar';
import { devIncome } from './development';

/** A company's management (funds, sales, costs, loans, acquisitions). Amounts in yen. */
export const START_CASH = 30_000_000;
/** Multiplayer: toll for passing one tile of another company's track or road */
export const TOLL = { rail: 300, road: 80 } as const;

export { FARE } from '../network/fares';

/** Construction and placement costs */
export const PRICES = {
  road: 2_000, // one road edge (tile)
  rail: 4_000, // one rail edge
  bridge: 30_000, // bridge, per tile
  tunnel: 50_000, // tunnel, per tile
  stop: 10_000,
  stationBase: 50_000,
  stationTile: 15_000, // per platform tile
  waypoint: 500,
  signal: 8_000,
  depotRoad: 100_000,
  depotRail: 150_000,
  depotAir: 400_000,
  airport: 2_000_000,
  terraform: 800, // per tile per level
} as const;

/** Vehicle prices: per vehicle for road and air, per car for rail (multiplied by the car count) */
export function vehiclePrice(model: VehicleModel, cars = 1): number {
  const per = model.mode === 'road' ? model.cap * 3000 : model.mode === 'rail' ? model.cap * 2500 * (0.8 + model.speed * 0.4) : model.cap * 20000;
  return Math.round((per * (model.mode === 'rail' ? cars : 1)) / 1000) * 1000;
}
/** Vehicle running cost (per day): 3% of the price */
export const RUNNING_RATE = 0.03;

/** Stock: number of issued shares (fixed) */
export const SHARES = 100_000;

/** Credit rating: score -> grade. The annual interest rate and the loan-limit multiplier per grade */
export const GRADES = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'D'] as const;
const GRADE_MIN = [85, 75, 65, 55, 45, 30, 15, 0];
const GRADE_RATE = [0.03, 0.04, 0.05, 0.065, 0.08, 0.105, 0.13, 0.16];
const GRADE_MULT = [1.5, 1.3, 1.1, 1.0, 0.7, 0.4, 0.15, 0];
export const gradeIndex = (score: number): number => GRADE_MIN.findIndex((m) => score >= m);
export const gradeOf = (score: number): string => GRADES[gradeIndex(score)];

/** Fiscal year-end: corporate tax rate, yearly depreciation rate of infrastructure (construction costs capitalized), and the dividend payout options */
export const TAX_RATE = 0.3;
export const DEPRECIATION_RATE = 0.1;
export const PAYOUT_OPTIONS = [0, 0.2, 0.4] as const;

/** Loans */
export const LOAN_STEP = 1_000_000;
export const LOAN_MAX_CAP = 500_000_000;

/** Staff training: at each training level (0..MAX), running costs fall and service brings more passengers. Training costs money and days, and labor cost (training cost) according to the level is charged every day */
export const TRAINING = { max: 5, costCut: 0.04, demandUp: 0.03, days: 7, dailyPerLevel: 20_000 } as const;
/** Cost to go from training level to level+1 */
export const trainingCost = (level: number): number => Math.round((2_000_000 * Math.pow(level + 1, 1.5)) / 100_000) * 100_000;

/** Management categories (labels for sales and costs) */
export const REVENUE_CATS = ['fare-road', 'fare-rail', 'fare-air', 'facility', 'subsidiary', 'sale', 'toll-in', 'gift-in', 'realestate'] as const;
export const COST_CATS = ['build', 'vehicle', 'running', 'upkeep', 'interest', 'acquire', 'tax', 'dividend', 'toll-out', 'gift-out', 'ad', 'training'] as const;
export const CAT_LABEL: Record<string, string> = {
  'fare-road': '運賃(バス)',
  'fare-rail': '運賃(鉄道)',
  'fare-air': '運賃(航空)',
  facility: '施設の売上',
  subsidiary: '子会社の利益',
  sale: '資産の売却',
  build: '建設費',
  vehicle: '車両購入',
  running: '車両の運行費',
  upkeep: '施設・駅の維持費',
  interest: '利払い',
  acquire: '買収',
  tax: '法人税',
  dividend: '配当',
  'toll-in': '通行料(受取)',
  realestate: '不動産収入(沿線開発)',
  'toll-out': '通行料(支払)',
  'gift-in': '資金支援(受取)',
  'gift-out': '資金支援(送金)',
  ad: '広告費',
  training: '従業員の研修費',
};

export interface DayRecord {
  day: number;
  revenue: number;
  cost: number;
}

type Ledger = Record<string, number>;

/** Financial statement (profit and loss of one fiscal year, and the position at year end) */
export interface FiscalReport {
  period: number;
  from: string;
  to: string;
  /** Revenue (fares + facilities + subsidiaries) */
  revenue: number;
  running: number;
  upkeep: number;
  /** Depreciation (10% of infrastructure) */
  depreciation: number;
  /** Operating profit = revenue - running costs - upkeep - depreciation */
  opProfit: number;
  interest: number;
  /** Extraordinary gains (sale of assets) */
  special: number;
  preTax: number;
  tax: number;
  netIncome: number;
  dividend: number;
  cash: number;
  assets: number;
  infra: number;
  loan: number;
  netWorth: number;
  stock: number;
}

export interface CompanyState {
  cash: number;
  loan: number;
  today: Ledger;
  total: Ledger;
  history: DayRecord[];
  lastDay: number;
  credit?: number;
  stock?: number;
  stockHistory?: number[];
  fy?: Ledger;
  infra?: number;
  loss?: number;
  period?: number;
  payout?: number;
  reports?: FiscalReport[];
  training?: number;
  trainingPending?: { to: number; left: number };
}

/** Multiplayer: so facilities' daily earnings update only once, the Simulation sets the ID of the first company that does the close */
export const FIRST_OWNER = { id: 0 };

export class Company {
  cash = START_CASH;
  /** Borrowings (principal) */
  loan = 0;
  /** Today's sales and costs (by category) */
  today: Ledger = {};
  /** Cumulative since the start */
  total: Ledger = {};
  /** Records of the last 30 days (newest at the end) */
  history: DayRecord[] = [];
  lastDay = 0;
  /** Credit score (0-100), share price, and price history */
  credit = 60;
  stock = 300;
  stockHistory: number[] = [];
  /** This fiscal period's sales and costs (by category). Closed at year end */
  fy: Ledger = {};
  /** Book value of infrastructure whose construction cost was capitalized (depreciated 10% per period) */
  infra = 0;
  /** Loss carried forward (a loss offsets later profits to reduce tax) */
  loss = 0;
  /** Current period (period N) */
  period = 1;
  /** Dividend payout ratio (share of net profit paid as dividends). Chosen by the player */
  payout = 0;
  /** Past financial statements (newest last; the latest 10 periods) */
  reports: FiscalReport[] = [];
  /** Staff training level (0..TRAINING.max), and training in progress (days left until it finishes) */
  training = 0;
  trainingPending?: { to: number; left: number };

  /** Multiplier on running costs (lowered by training) */
  get costMul(): number {
    return 1 - TRAINING.costCut * this.training;
  }

  /** Multiplier on passenger generation at stops (service quality; raised by training) */
  get serviceMul(): number {
    return 1 + TRAINING.demandUp * this.training;
  }

  /** Start training. Returns the reason if it cannot be started (the cost is paid up front; the current level stays until it finishes) */
  startTraining(): string | null {
    if (this.trainingPending) return `研修中です(あと${this.trainingPending.left}日)`;
    if (this.training >= TRAINING.max) return 'これ以上は研修できません(最高レベル)';
    const cost = trainingCost(this.training);
    if (!this.spend('training', cost)) return `資金が足りません(研修費 ${yen(cost)})`;
    this.trainingPending = { to: this.training + 1, left: TRAINING.days };
    return null;
  }

  afford(cost: number): boolean {
    return this.cash >= cost;
  }

  earn(cat: string, amount: number): void {
    if (!(amount > 0)) return;
    this.cash += amount;
    this.today[cat] = (this.today[cat] ?? 0) + amount;
    this.total[cat] = (this.total[cat] ?? 0) + amount;
    this.fy[cat] = (this.fy[cat] ?? 0) + amount;
  }

  /** Pay if funds suffice and return true. Do nothing if they do not */
  spend(cat: string, amount: number): boolean {
    if (!this.afford(amount)) return false;
    this.pay(cat, amount);
    return true;
  }

  /** Pay regardless of funds (running costs, interest, etc.; the balance may go negative) */
  pay(cat: string, amount: number): void {
    if (!(amount > 0)) return;
    this.cash -= amount;
    this.today[cat] = (this.today[cat] ?? 0) + amount;
    this.total[cat] = (this.total[cat] ?? 0) + amount;
    this.fy[cat] = (this.fy[cat] ?? 0) + amount;
    if (cat === 'build') this.infra += amount; // construction cost is booked as an asset
  }

  /** Net assets = cash + assets (valuation of facilities, vehicles, depots) + infrastructure book value - borrowings */
  netWorth(assets: number): number {
    return this.cash + assets + this.infra - this.loan;
  }

  /** Loan limit (depends on net assets and rating). Cannot borrow at rating D */
  maxLoan(credit: number, assets: number): number {
    const base = 10_000_000 + Math.max(0, this.netWorth(assets)) * 0.5;
    return Math.min(LOAN_MAX_CAP, Math.floor((base * GRADE_MULT[gradeIndex(credit)]) / LOAN_STEP) * LOAN_STEP);
  }

  /** Annual interest rate (the higher the rating, the lower: 3% to 16%) */
  interestRate(credit: number): number {
    return GRADE_RATE[gradeIndex(credit)];
  }

  /** Borrow. Returns the reason if it cannot be borrowed */
  borrow(amount: number, credit: number, assets: number): string | null {
    if (!(amount > 0)) return '金額を指定してください';
    const limit = this.maxLoan(credit, assets);
    if (this.loan + amount > limit) return `融資の上限(${limit.toLocaleString()}円)を超えます`;
    this.loan += amount;
    this.cash += amount;
    return null;
  }

  /** Repay (within cash; amount=Infinity for all). Returns the amount repaid */
  repay(amount: number): number {
    const pay = Math.max(0, Math.min(amount, this.loan, this.cash));
    this.loan -= pay;
    this.cash -= pay;
    return pay;
  }

  /** Day close: pay running costs, upkeep, and interest, receive subsidiaries' profit, update rating and share price, and record */
  endOfDay(day: number, map: GameMap, transit: Transit, rating: number, rivals: Rival[] = [], ownerId?: number): void {
    // Vehicle running costs (in multiplayer, only vehicles on the company's own routes)
    let running = 0;
    const mine = (routeId: number) => ownerId === undefined || transit.routes.get(routeId)?.owner === ownerId;
    for (const v of transit.vehicles) if (mine(v.routeId)) running += vehiclePrice(modelOf(v.modelId), v.cars) * RUNNING_RATE;
    this.pay('running', Math.round(running * this.costMul));
    // Upkeep of stations, stops, depots, and facilities
    let upkeep = 0;
    for (const s of transit.stops.values()) if (ownerId === undefined || s.owner === ownerId) upkeep += stopUpkeep(s);
    for (const d of transit.depots.values()) if (ownerId === undefined || d.owner === ownerId) upkeep += 500;
    for (const f of map.facilities) if ((f.owner ?? 'player') === 'player' && (ownerId === undefined || f.playerId === ownerId)) upkeep += facilityUpkeep(f);
    this.pay('upkeep', Math.round(upkeep));
    // Training cost (labor cost by level) and training progress
    this.pay('training', this.training * TRAINING.dailyPerLevel);
    if (this.trainingPending && --this.trainingPending.left <= 0) {
      this.training = this.trainingPending.to;
      this.trainingPending = undefined;
    }
    // Interest (prorated daily)
    this.pay('interest', Math.round((this.loan * this.interestRate(this.credit)) / 360));
    // Profit of subsidiaries (acquired rivals)
    for (const r of rivals) if (r.acquired && (ownerId === undefined || r.acquiredBy === ownerId)) this.earn('subsidiary', r.profit);
    // Real-estate income from line development
    let dev = 0;
    for (const s of transit.stops.values()) if (s.dev && !s.waypoint && (ownerId === undefined || s.owner === ownerId)) dev += devIncome(s);
    this.earn('realestate', dev);
    // Update facilities' daily earnings (a guide for acquisition prices). In multiplayer, the first company's close updates everyone's once
    if (ownerId === undefined || ownerId === FIRST_OWNER.id)
      for (const f of map.facilities) {
        f.income = (f.income ?? 0) * 0.8 + (f.dayIncome ?? 0) * 0.2;
        f.dayIncome = 0;
      }
    const revenue = REVENUE_CATS.reduce((a, c) => a + (this.today[c] ?? 0), 0);
    const cost = COST_CATS.reduce((a, c) => a + (this.today[c] ?? 0), 0);
    this.history.push({ day, revenue, cost });
    if (this.history.length > 30) this.history.shift();
    this.today = {};
    this.lastDay = day;
    this.updateCreditAndStock(rating, assetValue(map, transit, rivals, ownerId));
  }

  /** Average profit per day recently, and the profit margin on sales (-1 to 1) */
  profitStats(days = 7): { avg: number; margin: number } {
    const h = this.history.slice(-days);
    if (!h.length) return { avg: 0, margin: 0 };
    const rev = h.reduce((a, d) => a + d.revenue, 0);
    const cost = h.reduce((a, d) => a + d.cost, 0);
    return { avg: (rev - cost) / h.length, margin: rev > 0 ? Math.max(-1, Math.min(1, (rev - cost) / rev)) : cost > 0 ? -1 : 0 };
  }

  /** Update the rating score and share price from that day's situation */
  updateCreditAndStock(rating: number, assets: number): void {
    const nw = this.netWorth(assets);
    const lev = 100 * (1 - Math.max(0, Math.min(1, this.loan / Math.max(1, nw))));
    const { avg, margin } = this.profitStats();
    const prof = this.history.length ? 50 + 50 * Math.max(-1, Math.min(1, margin * 2)) : 60;
    const s = 0.4 * rating + 0.3 * lev + 0.3 * prof - (this.cash < 0 ? 15 : 0);
    this.credit = Math.max(0, Math.min(100, this.credit * 0.7 + s * 0.3));
    // Share price = (net assets + 120 days of profit) / shares x credit adjustment. Smoothed so it does not jump
    const target = Math.max(10, ((nw + 120 * Math.max(0, avg)) / SHARES) * (0.8 + 0.4 * (this.credit / 100)));
    this.stock = this.stock * 0.7 + target * 0.3;
    this.stockHistory.push(this.stock);
    if (this.stockHistory.length > 60) this.stockHistory.shift();
  }

  get marketCap(): number {
    return this.stock * SHARES;
  }

  /**
   * Fiscal close: finalize period `period`'s profit and loss, pay corporate tax (offset by the loss carried forward) and dividends, and record the statement.
   * Revenue - running costs - upkeep - depreciation = operating profit; - interest paid + extraordinary gains (asset sales) = pre-tax profit.
   */
  closeFiscalYear(period: number, assets: number): FiscalReport {
    const f = this.fy;
    const sum = (cats: readonly string[]) => cats.reduce((a, k) => a + (f[k] ?? 0), 0);
    const revenue = sum(['fare-road', 'fare-rail', 'fare-air', 'facility', 'subsidiary', 'toll-in', 'realestate']);
    const running = f.running ?? 0;
    const upkeep = (f.upkeep ?? 0) + (f['toll-out'] ?? 0) + (f.ad ?? 0) + (f.training ?? 0);
    const depreciation = Math.round(this.infra * DEPRECIATION_RATE);
    this.infra -= depreciation;
    const opProfit = revenue - running - upkeep - depreciation;
    const interest = f.interest ?? 0;
    const special = f.sale ?? 0;
    const preTax = opProfit - interest + special;
    let tax = 0;
    if (preTax > 0) {
      const used = Math.min(this.loss, preTax);
      this.loss -= used;
      tax = Math.round((preTax - used) * TAX_RATE);
    } else this.loss += -preTax;
    const nwBefore = this.netWorth(assets);
    this.pay('tax', tax);
    const netIncome = preTax - tax;
    const dividend = netIncome > 0 && this.payout > 0 ? Math.round(Math.min(Math.max(0, this.cash), netIncome * this.payout)) : 0;
    this.pay('dividend', dividend);
    // The share price moves with the results (good results raise it, a loss lowers it; a dividend adds a little)
    const reaction = Math.max(-0.1, Math.min(0.1, (netIncome / Math.max(1_000_000, nwBefore)) * 0.5)) + this.payout * 0.04;
    this.stock = Math.max(10, this.stock * (1 + reaction));
    if (this.stockHistory.length) this.stockHistory[this.stockHistory.length - 1] = this.stock;
    const r = fiscalRange(period);
    const rep: FiscalReport = {
      period,
      from: r.from,
      to: r.to,
      revenue,
      running,
      upkeep,
      depreciation,
      opProfit,
      interest,
      special,
      preTax,
      tax,
      netIncome,
      dividend,
      cash: this.cash,
      assets,
      infra: this.infra,
      loan: this.loan,
      netWorth: this.netWorth(assets),
      stock: this.stock,
    };
    this.reports.push(rep);
    if (this.reports.length > 10) this.reports.shift();
    this.fy = {};
    this.period = period + 1;
    return rep;
  }

  /** A passenger paid a fare */
  fare(mode: Mode, amount: number): void {
    this.earn(`fare-${mode}`, amount);
  }

  /** n passengers arrived: they become sales of the company's own facilities in the stop's catchment (not of other companies' facilities) */
  visits(map: GameMap, stop: Stop, n: number, tick: number, payee?: (f: Facility) => Company | null): void {
    if (!stop.facs || !stop.facs.length) return;
    const hour = (todOf(tick) / DAY_TICKS) * 24;
    const fs = stop.facs.map((id) => map.facilities.find((f) => f.id === id)).filter((f): f is Facility => !!f);
    const w = fs.map((f) => facilityAttract(f) * hourFactor(FACILITY_SPECS[f.type], hour));
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0) return;
    fs.forEach((f, i) => {
      const spec = FACILITY_SPECS[f.type];
      const share = (n * w[i]) / sum;
      f.visits = (f.visits ?? 0) + share;
      if ((f.owner ?? 'player') !== 'player') return;
      const to = payee ? payee(f) : this;
      if (!to) return;
      // Visitors from the station also buy more or less depending on price (price sensitivity is the value computed at the day close)
      const amount =
        share * spec.conversion * spec.spend * priceMul(f) * demandMul(priceMul(f), f.elast ?? elasticity(f.type, 0, true)) * gradeSpendMul(facilityGrade(f)) * repMul(repOf(f));
      if (amount > 0) {
        to.earn('facility', amount);
        f.dayIncome = (f.dayIncome ?? 0) + amount;
      }
    });
  }

  toJSON(): CompanyState {
    return {
      cash: this.cash,
      loan: this.loan,
      today: this.today,
      total: this.total,
      history: this.history,
      lastDay: this.lastDay,
      credit: this.credit,
      stock: this.stock,
      stockHistory: this.stockHistory,
      fy: this.fy,
      infra: this.infra,
      loss: this.loss,
      period: this.period,
      payout: this.payout,
      reports: this.reports,
      training: this.training,
      trainingPending: this.trainingPending,
    };
  }

  static from(s: CompanyState): Company {
    const c = new Company();
    c.cash = s.cash;
    c.loan = s.loan;
    c.today = s.today ?? {};
    c.total = s.total ?? {};
    c.history = s.history ?? [];
    c.lastDay = s.lastDay ?? 0;
    c.credit = s.credit ?? 60;
    c.stock = s.stock ?? 300;
    c.stockHistory = s.stockHistory ?? [];
    c.fy = s.fy ?? {};
    c.infra = s.infra ?? 0;
    c.loss = s.loss ?? 0;
    c.period = s.period ?? 1;
    c.payout = s.payout ?? 0;
    c.reports = s.reports ?? [];
    c.training = s.training ?? 0;
    c.trainingPending = s.trainingPending;
    return c;
  }
}

/** Upkeep of stops and stations (per day) */
export function stopUpkeep(s: Stop): number {
  if (s.waypoint) return 0;
  if (s.kind === 'road') return 300;
  if (s.kind === 'air') return 20_000;
  return s.station ? 2000 + s.station.len * s.station.tracks * 300 : 1500;
}

/** Facility valuation (a guide for acquisition and sale): 90% of construction cost + 60 days of the latest daily earnings */
export function facilityValue(f: Facility): number {
  return Math.round((facilityBuildCost(f) * 0.9 + (f.income ?? 0) * 60) / 1000) * 1000;
}

/** Total valuation of assets (facilities, vehicles, depots). Used for net assets and the loan limit */
export function assetValue(map: GameMap, transit: Transit, rivals: Rival[] = [], ownerId?: number): number {
  let a = 0;
  const all = ownerId === undefined;
  for (const r of rivals) if (r.acquired && (all || r.acquiredBy === ownerId)) a += r.value * 0.7; // valuation of subsidiaries
  for (const f of map.facilities) if ((f.owner ?? 'player') === 'player' && (all || f.playerId === ownerId)) a += facilityValue(f) * 0.7;
  for (const v of transit.vehicles) if (all || transit.routes.get(v.routeId)?.owner === ownerId) a += vehiclePrice(modelOf(v.modelId), v.cars) * 0.5;
  for (const d of transit.depots.values())
    if (all || d.owner === ownerId) a += (d.kind === 'road' ? PRICES.depotRoad : d.kind === 'rail' ? PRICES.depotRail : PRICES.depotAir) * 0.5;
  return Math.round(a);
}

export const yen = (n: number) => `${n < 0 ? '-' : ''}¥${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`;
