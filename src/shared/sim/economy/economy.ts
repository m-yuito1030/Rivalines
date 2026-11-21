import { demandMul, elasticity, priceMul } from '../facility/pricing';
import { type VehicleModel, modelOf } from '../../data/models';
import { FACILITY_SPECS, type Facility, facilityAttract, facilityBuildCost, facilityUpkeep, hourFactor } from '../../world/facilities';
import type { GameMap } from '../../world/gameMap';
import type { Mode } from '../../data/models';
import { DAY_TICKS, type Stop, type Transit, todOf } from '../network/transit';
import type { Rival } from './rivals';
import { fiscalRange } from '../world/calendar';
import { devIncome } from './development';

/** 会社の経営(資金・売上・費用・融資・買収)。金額は円。 */
export const START_CASH = 30_000_000;
/** マルチプレイ: 他社の線路・道路を1タイル通るときの通行料 */
export const TOLL = { rail: 300, road: 80 } as const;

export { FARE } from '../network/fares';

/** 建設・設置の費用 */
export const PRICES = {
  road: 2_000, // 道路1辺(タイル)
  rail: 4_000, // 線路1辺
  bridge: 30_000, // 橋 1タイル
  tunnel: 50_000, // トンネル 1タイル
  stop: 10_000,
  stationBase: 50_000,
  stationTile: 15_000, // ホーム1タイルあたり
  waypoint: 500,
  signal: 8_000,
  depotRoad: 100_000,
  depotRail: 150_000,
  depotAir: 400_000,
  airport: 2_000_000,
  terraform: 800, // 1タイル・1段
} as const;

/** 車両の価格: 道路・航空は1台あたり、鉄道は1両あたり(両数を掛ける) */
export function vehiclePrice(model: VehicleModel, cars = 1): number {
  const per = model.mode === 'road' ? model.cap * 3000 : model.mode === 'rail' ? model.cap * 2500 * (0.8 + model.speed * 0.4) : model.cap * 20000;
  return Math.round((per * (model.mode === 'rail' ? cars : 1)) / 1000) * 1000;
}
/** 車両の運行費(1日あたり): 価格の3% */
export const RUNNING_RATE = 0.03;

/** 株式: 発行済み株式数(固定) */
export const SHARES = 100_000;

/** 格付け(信用): 点数 → 区分。区分ごとの年利と融資上限の倍率 */
export const GRADES = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'D'] as const;
const GRADE_MIN = [85, 75, 65, 55, 45, 30, 15, 0];
const GRADE_RATE = [0.03, 0.04, 0.05, 0.065, 0.08, 0.105, 0.13, 0.16];
const GRADE_MULT = [1.5, 1.3, 1.1, 1.0, 0.7, 0.4, 0.15, 0];
export const gradeIndex = (score: number): number => GRADE_MIN.findIndex((m) => score >= m);
export const gradeOf = (score: number): string => GRADES[gradeIndex(score)];

/** 決算: 法人税率・インフラ(建設費を資産計上したもの)の年間償却率・配当性向の選択肢 */
export const TAX_RATE = 0.3;
export const DEPRECIATION_RATE = 0.1;
export const PAYOUT_OPTIONS = [0, 0.2, 0.4] as const;

/** 融資 */
export const LOAN_STEP = 1_000_000;
export const LOAN_MAX_CAP = 500_000_000;

/** 従業員教育: 研修レベル(0〜MAX)ごとに、運行費が下がり、接客で乗客が増える。研修には費用と日数がかかり、レベルに応じた人件費(研修費)が毎日かかる */
export const TRAINING = { max: 5, costCut: 0.04, demandUp: 0.03, days: 7, dailyPerLevel: 20_000 } as const;
/** 研修レベル level → level+1 にする費用 */
export const trainingCost = (level: number): number => Math.round((2_000_000 * Math.pow(level + 1, 1.5)) / 100_000) * 100_000;

/** 経営の分類(売上・費用のラベル) */
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

/** 決算書(1事業年度の損益と、期末の財政状態) */
export interface FiscalReport {
  period: number;
  from: string;
  to: string;
  /** 売上高(運賃+施設+子会社) */
  revenue: number;
  running: number;
  upkeep: number;
  /** 減価償却費(インフラの10%) */
  depreciation: number;
  /** 営業利益 = 売上高 - 運行費 - 維持費 - 減価償却費 */
  opProfit: number;
  interest: number;
  /** 特別利益(資産の売却) */
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

/** マルチプレイ: 施設の日次収益の更新を1回だけにするため、締めを行う最初の会社のIDを Simulation が設定する */
export const FIRST_OWNER = { id: 0 };

export class Company {
  cash = START_CASH;
  /** 借入金(元本) */
  loan = 0;
  /** 今日の売上・費用(分類別) */
  today: Ledger = {};
  /** 開始からの累計 */
  total: Ledger = {};
  /** 直近30日の記録(新しい順に末尾へ) */
  history: DayRecord[] = [];
  lastDay = 0;
  /** 信用の点数(0〜100)と、株価・株価の履歴 */
  credit = 60;
  stock = 300;
  stockHistory: number[] = [];
  /** 今期(事業年度)の売上・費用(分類別)。決算で締める */
  fy: Ledger = {};
  /** 建設費を資産計上したインフラの簿価(毎期10%償却) */
  infra = 0;
  /** 繰越欠損金(赤字は翌期以降の黒字と相殺して税を減らす) */
  loss = 0;
  /** 現在の期(第N期) */
  period = 1;
  /** 配当性向(当期純利益のうち配当に回す割合)。プレイヤーが選ぶ */
  payout = 0;
  /** 過去の決算書(新しいものが末尾。直近10期) */
  reports: FiscalReport[] = [];
  /** 従業員の研修レベル(0〜TRAINING.max)と、研修中(完了までの残り日数) */
  training = 0;
  trainingPending?: { to: number; left: number };

  /** 運行費にかかる倍率(研修で下がる) */
  get costMul(): number {
    return 1 - TRAINING.costCut * this.training;
  }

  /** 停留所の乗客の発生にかかる倍率(接客の質。研修で上がる) */
  get serviceMul(): number {
    return 1 + TRAINING.demandUp * this.training;
  }

  /** 研修を始める。始められなければ理由を返す(費用は先払い。完了までは今のレベルのまま) */
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

  /** 資金が足りれば支払って true。足りなければ何もしない */
  spend(cat: string, amount: number): boolean {
    if (!this.afford(amount)) return false;
    this.pay(cat, amount);
    return true;
  }

  /** 資金に関係なく支払う(運行費・利払いなど。残高はマイナスになりうる) */
  pay(cat: string, amount: number): void {
    if (!(amount > 0)) return;
    this.cash -= amount;
    this.today[cat] = (this.today[cat] ?? 0) + amount;
    this.total[cat] = (this.total[cat] ?? 0) + amount;
    this.fy[cat] = (this.fy[cat] ?? 0) + amount;
    if (cat === 'build') this.infra += amount; // 建設費は資産に計上する
  }

  /** 純資産 = 現金 + 資産(施設・車両・基地の評価額)+ インフラの簿価 - 借入金 */
  netWorth(assets: number): number {
    return this.cash + assets + this.infra - this.loan;
  }

  /** 融資の上限(純資産と格付けで変わる)。格付け D では借りられない */
  maxLoan(credit: number, assets: number): number {
    const base = 10_000_000 + Math.max(0, this.netWorth(assets)) * 0.5;
    return Math.min(LOAN_MAX_CAP, Math.floor((base * GRADE_MULT[gradeIndex(credit)]) / LOAN_STEP) * LOAN_STEP);
  }

  /** 年利(格付けが高いほど低い: 3%〜16%) */
  interestRate(credit: number): number {
    return GRADE_RATE[gradeIndex(credit)];
  }

  /** 借りる。借りられなければ理由を返す */
  borrow(amount: number, credit: number, assets: number): string | null {
    if (!(amount > 0)) return '金額を指定してください';
    const limit = this.maxLoan(credit, assets);
    if (this.loan + amount > limit) return `融資の上限(${limit.toLocaleString()}円)を超えます`;
    this.loan += amount;
    this.cash += amount;
    return null;
  }

  /** 返済(現金の範囲で。amount=Infinity で全額)。返済できた額を返す */
  repay(amount: number): number {
    const pay = Math.max(0, Math.min(amount, this.loan, this.cash));
    this.loan -= pay;
    this.cash -= pay;
    return pay;
  }

  /** 1日の締め: 運行費・維持費・利払いを払い、子会社の利益を受け取り、格付けと株価を更新して記録する */
  endOfDay(day: number, map: GameMap, transit: Transit, rating: number, rivals: Rival[] = [], ownerId?: number): void {
    // 車両の運行費(マルチプレイでは自社の路線の車両だけ)
    let running = 0;
    const mine = (routeId: number) => ownerId === undefined || transit.routes.get(routeId)?.owner === ownerId;
    for (const v of transit.vehicles) if (mine(v.routeId)) running += vehiclePrice(modelOf(v.modelId), v.cars) * RUNNING_RATE;
    this.pay('running', Math.round(running * this.costMul));
    // 駅・停留所・基地・施設の維持費
    let upkeep = 0;
    for (const s of transit.stops.values()) if (ownerId === undefined || s.owner === ownerId) upkeep += stopUpkeep(s);
    for (const d of transit.depots.values()) if (ownerId === undefined || d.owner === ownerId) upkeep += 500;
    for (const f of map.facilities) if ((f.owner ?? 'player') === 'player' && (ownerId === undefined || f.playerId === ownerId)) upkeep += facilityUpkeep(f);
    this.pay('upkeep', Math.round(upkeep));
    // 研修費(レベルに応じた人件費)と、研修の進行
    this.pay('training', this.training * TRAINING.dailyPerLevel);
    if (this.trainingPending && --this.trainingPending.left <= 0) {
      this.training = this.trainingPending.to;
      this.trainingPending = undefined;
    }
    // 利払い(日割り)
    this.pay('interest', Math.round((this.loan * this.interestRate(this.credit)) / 360));
    // 子会社(買収した競合会社)の利益
    for (const r of rivals) if (r.acquired && (ownerId === undefined || r.acquiredBy === ownerId)) this.earn('subsidiary', r.profit);
    // 沿線開発の不動産収入
    let dev = 0;
    for (const s of transit.stops.values()) if (s.dev && !s.waypoint && (ownerId === undefined || s.owner === ownerId)) dev += devIncome(s);
    this.earn('realestate', dev);
    // 施設の1日の収益を更新(買収額の目安に使う)。マルチプレイでは全社分を最初の会社の締めで1回だけ更新する
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

  /** 直近の1日あたりの平均利益と、売上に対する利益率(-1〜1) */
  profitStats(days = 7): { avg: number; margin: number } {
    const h = this.history.slice(-days);
    if (!h.length) return { avg: 0, margin: 0 };
    const rev = h.reduce((a, d) => a + d.revenue, 0);
    const cost = h.reduce((a, d) => a + d.cost, 0);
    return { avg: (rev - cost) / h.length, margin: rev > 0 ? Math.max(-1, Math.min(1, (rev - cost) / rev)) : cost > 0 ? -1 : 0 };
  }

  /** 格付けの点数と株価を、その日の状況で更新する */
  updateCreditAndStock(rating: number, assets: number): void {
    const nw = this.netWorth(assets);
    const lev = 100 * (1 - Math.max(0, Math.min(1, this.loan / Math.max(1, nw))));
    const { avg, margin } = this.profitStats();
    const prof = this.history.length ? 50 + 50 * Math.max(-1, Math.min(1, margin * 2)) : 60;
    const s = 0.4 * rating + 0.3 * lev + 0.3 * prof - (this.cash < 0 ? 15 : 0);
    this.credit = Math.max(0, Math.min(100, this.credit * 0.7 + s * 0.3));
    // 株価 = (純資産 + 利益の120日分) / 株式数 × 信用による補正。急変しないよう均す
    const target = Math.max(10, ((nw + 120 * Math.max(0, avg)) / SHARES) * (0.8 + 0.4 * (this.credit / 100)));
    this.stock = this.stock * 0.7 + target * 0.3;
    this.stockHistory.push(this.stock);
    if (this.stockHistory.length > 60) this.stockHistory.shift();
  }

  get marketCap(): number {
    return this.stock * SHARES;
  }

  /**
   * 決算: 第 period 期の損益を確定し、法人税(繰越欠損金で相殺)と配当を支払い、決算書を残す。
   * 売上高 - 運行費 - 維持費 - 減価償却費 = 営業利益、 - 支払利息 + 特別利益(資産売却) = 税引前利益。
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
    // 決算の内容で株価が動く(好決算は上昇、赤字は下落。配当があると少し上乗せ)
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

  /** 旅客が運賃を払った */
  fare(mode: Mode, amount: number): void {
    this.earn(`fare-${mode}`, amount);
  }

  /** 到着した旅客が n 人: 停留所の集客圏にある自社施設の売上になる(他社の施設には入らない) */
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
      // 駅から来た客も、料金で買う人が増減する(値上げへの敏感さは、1日の締めに計算した値)
      const amount = share * spec.conversion * spec.spend * priceMul(f) * demandMul(priceMul(f), f.elast ?? elasticity(f.type, 0, true));
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

/** 停留所・駅の維持費(1日) */
export function stopUpkeep(s: Stop): number {
  if (s.waypoint) return 0;
  if (s.kind === 'road') return 300;
  if (s.kind === 'air') return 20_000;
  return s.station ? 2000 + s.station.len * s.station.tracks * 300 : 1500;
}

/** 施設の評価額(買収・売却の目安): 建設費の90% + 直近の1日の収益の60日分 */
export function facilityValue(f: Facility): number {
  return Math.round((facilityBuildCost(f) * 0.9 + (f.income ?? 0) * 60) / 1000) * 1000;
}

/** 資産(施設・車両・基地)の評価額の合計。純資産と融資の上限に使う */
export function assetValue(map: GameMap, transit: Transit, rivals: Rival[] = [], ownerId?: number): number {
  let a = 0;
  const all = ownerId === undefined;
  for (const r of rivals) if (r.acquired && (all || r.acquiredBy === ownerId)) a += r.value * 0.7; // 子会社の評価
  for (const f of map.facilities) if ((f.owner ?? 'player') === 'player' && (all || f.playerId === ownerId)) a += facilityValue(f) * 0.7;
  for (const v of transit.vehicles) if (all || transit.routes.get(v.routeId)?.owner === ownerId) a += vehiclePrice(modelOf(v.modelId), v.cars) * 0.5;
  for (const d of transit.depots.values())
    if (all || d.owner === ownerId) a += (d.kind === 'road' ? PRICES.depotRoad : d.kind === 'rail' ? PRICES.depotRail : PRICES.depotAir) * 0.5;
  return Math.round(a);
}

export const yen = (n: number) => `${n < 0 ? '-' : ''}¥${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`;
