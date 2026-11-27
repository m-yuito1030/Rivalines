import { calendarOf, fiscalPeriodOf } from '../world/calendar';
import { hash01 } from '../world/events';

/**
 * The government (multiplayer): it keeps the early players from simply staying ahead for ever.
 *  - Every month a national policy is in force (decided only by the date and the world seed, so it is the same for everyone and survives restarts).
 *  - Every fiscal year a stance sets how hard the government leans on big companies.
 *  - Each month the biggest companies (by net assets) pay a levy into the treasury, and the treasury is paid out to the smaller companies.
 * Only companies that are online take part (offline companies are frozen, like everything else about them).
 */
export type PolicyKey = 'normal' | 'austerity' | 'taxcut' | 'infra' | 'tourism' | 'eco' | 'dereg';
export type StanceKey = 'probiz' | 'balanced' | 'redistribute';

export interface PolicyDef {
  /** Japanese names and descriptions (shown through tr()) */
  name: string;
  desc: string;
  /** How the big-company levy scales */
  levyMul: number;
  /** Added to the corporate tax rate: for big companies (`large`) and for everyone (`all`) */
  taxAddLarge: number;
  taxAddAll: number;
  /** Multiplier on construction costs */
  buildMul: number;
  /** Multiplier on facility visitors */
  visitorMul: number;
  /** Vehicle running costs: base multiplier, and extra for a large fleet (reaches the full extra at FLEET_FULL vehicles) */
  runBase: number;
  runFleet: number;
  /** Relative chance of being picked in a month */
  weight: number;
}

export const POLICIES: Record<PolicyKey, PolicyDef> = {
  normal: { name: '通常の運営', desc: '特別な国策はありません', levyMul: 1, taxAddLarge: 0, taxAddAll: 0, buildMul: 1, visitorMul: 1, runBase: 1, runFleet: 0, weight: 3 },
  austerity: {
    name: '増税',
    desc: '大企業への課税が2倍になり、法人税が大企業だけ5ポイント上がります',
    levyMul: 2,
    taxAddLarge: 0.05,
    taxAddAll: 0,
    buildMul: 1,
    visitorMul: 1,
    runBase: 1,
    runFleet: 0,
    weight: 1.5,
  },
  taxcut: {
    name: '減税',
    desc: '大企業への課税が半分になり、法人税が全社5ポイント下がります',
    levyMul: 0.5,
    taxAddLarge: 0,
    taxAddAll: -0.05,
    buildMul: 1,
    visitorMul: 1,
    runBase: 1,
    runFleet: 0,
    weight: 1.5,
  },
  infra: {
    name: '公共事業',
    desc: '建設費が2割安くなります(道路・線路・駅・施設など)',
    levyMul: 1,
    taxAddLarge: 0,
    taxAddAll: 0,
    buildMul: 0.8,
    visitorMul: 1,
    runBase: 1,
    runFleet: 0,
    weight: 2,
  },
  tourism: { name: '観光振興', desc: '施設への来場者が2割増えます', levyMul: 1, taxAddLarge: 0, taxAddAll: 0, buildMul: 1, visitorMul: 1.2, runBase: 1, runFleet: 0, weight: 2 },
  eco: {
    name: '環境規制',
    desc: '車両の運行費が増えます。車両が多い会社ほど重くなります(最大 +25%)',
    levyMul: 1,
    taxAddLarge: 0,
    taxAddAll: 0,
    buildMul: 1,
    visitorMul: 1,
    runBase: 1.08,
    runFleet: 0.17,
    weight: 1.5,
  },
  dereg: { name: '規制緩和', desc: '車両の運行費が1割安くなります', levyMul: 1, taxAddLarge: 0, taxAddAll: 0, buildMul: 1, visitorMul: 1, runBase: 0.9, runFleet: 0, weight: 1.5 },
};
export const POLICY_KEYS = Object.keys(POLICIES) as PolicyKey[];

export const STANCES: Record<StanceKey, { name: string; levyMul: number; taxMul: number }> = {
  probiz: { name: '企業寄りの政権', levyMul: 0.6, taxMul: 0.5 },
  balanced: { name: '中道の政権', levyMul: 1, taxMul: 1 },
  redistribute: { name: '再分配重視の政権', levyMul: 1.5, taxMul: 1.5 },
};

/** The monthly levy on the biggest companies: share of net assets per month (before the policy and stance) */
export const LEVY_BASE = 0.003;
/** The corporate tax surcharge for big companies (before the policy and stance) */
export const LARGE_TAX_ADD = 0.05;
/** A fleet this big takes the full extra running cost under an environmental policy */
export const FLEET_FULL = 150;
/** The least number of online companies for the levy and the payout to apply */
export const MIN_COMPANIES = 3;
/** The most paid to one small company in one month: a share of its net assets, with a floor */
export const SUBSIDY_CAP_SHARE = 0.03;
export const SUBSIDY_CAP_MIN = 300_000;

/** The policy in force in a calendar month (year, month 1..12). Deterministic from the world seed */
export function policyOfMonth(seed: number, year: number, month: number): PolicyKey {
  const total = POLICY_KEYS.reduce((a, k) => a + POLICIES[k].weight, 0);
  let r = hash01(seed, year * 12 + month, 71) * total;
  for (const k of POLICY_KEYS) {
    r -= POLICIES[k].weight;
    if (r < 0) return k;
  }
  return 'normal';
}

/** The stance of the government in a fiscal period (period 1 = April 2026 to March 2027) */
export function stanceOfPeriod(seed: number, period: number): StanceKey {
  const r = hash01(seed, period, 73);
  return r < 0.3 ? 'probiz' : r < 0.7 ? 'balanced' : 'redistribute';
}

/** The policy in force on a running day number (start date = 0) */
export function policyOfDay(seed: number, day: number): PolicyKey {
  const d = calendarOf(day);
  return policyOfMonth(seed, d.year, d.month);
}

/** The stance in force on a running day number */
export function stanceOfDay(seed: number, day: number): StanceKey {
  const d = calendarOf(day);
  return stanceOfPeriod(seed, fiscalPeriodOf(d.year, d.month));
}

/** Multiplier on a company's vehicle running costs under a policy, given how many vehicles it runs */
export function runningMul(policy: PolicyKey, vehicles: number): number {
  const p = POLICIES[policy];
  return p.runBase + p.runFleet * Math.min(1, vehicles / FLEET_FULL);
}

export interface Ranked {
  id: number;
  netWorth: number;
}

export type SizeClass = 'large' | 'middle' | 'small' | 'none';

/** Size classes by net assets among the online companies: the top third is large, the bottom half small. `none` when too few companies */
export function classify(list: Ranked[]): Map<number, SizeClass> {
  const out = new Map<number, SizeClass>();
  if (list.length < MIN_COMPANIES) {
    for (const c of list) out.set(c.id, 'none');
    return out;
  }
  const sorted = [...list].sort((a, b) => b.netWorth - a.netWorth || a.id - b.id);
  const large = Math.ceil(sorted.length / 3);
  const small = Math.floor(sorted.length / 2);
  sorted.forEach((c, i) => out.set(c.id, i < large ? 'large' : i >= sorted.length - small ? 'small' : 'middle'));
  return out;
}

/** The corporate tax rate for a company of a size class */
export function corporateTaxRate(base: number, cls: SizeClass, policy: PolicyKey, stance: StanceKey): number {
  const p = POLICIES[policy];
  let add = p.taxAddAll;
  if (cls === 'large') add += LARGE_TAX_ADD * STANCES[stance].taxMul + p.taxAddLarge;
  return Math.min(0.5, Math.max(0.15, base + add));
}

export interface MonthlyResult {
  levies: Map<number, number>;
  subsidies: Map<number, number>;
}

/** What the government keeps (the treasury is paid out to small companies, so the money goes round) */
export class Government {
  treasury = 0;

  /** Month end: collect the levy from the large companies, then pay the treasury out to the small ones */
  monthly(list: Ranked[], policy: PolicyKey, stance: StanceKey): MonthlyResult {
    const levies = new Map<number, number>();
    const subsidies = new Map<number, number>();
    const cls = classify(list);
    const rate = LEVY_BASE * POLICIES[policy].levyMul * STANCES[stance].levyMul;
    for (const c of list) {
      if (cls.get(c.id) === 'large' && c.netWorth > 0) {
        const amount = Math.round(c.netWorth * rate);
        if (amount > 0) {
          levies.set(c.id, amount);
          this.treasury += amount;
        }
      }
    }
    const small = list.filter((c) => cls.get(c.id) === 'small');
    if (small.length && this.treasury > 0) {
      const share = Math.floor(this.treasury / small.length);
      for (const c of small) {
        const pay = Math.min(share, Math.max(SUBSIDY_CAP_MIN, Math.round(Math.max(0, c.netWorth) * SUBSIDY_CAP_SHARE)));
        if (pay > 0) {
          subsidies.set(c.id, pay);
          this.treasury -= pay;
        }
      }
    }
    return { levies, subsidies };
  }

  toJSON(): { treasury: number } {
    return { treasury: this.treasury };
  }

  load(s: { treasury?: number } | undefined): void {
    this.treasury = Math.max(0, s?.treasury ?? 0);
  }
}

/** What a client shows about the government */
export interface GovInfo {
  policy: PolicyKey;
  /** The policy of next month (announced ahead so players can prepare) */
  next: PolicyKey;
  stance: StanceKey;
  treasury: number;
  /** This company's size class now (`none` when fewer than MIN_COMPANIES are online) */
  size: SizeClass;
  /** The levy this company would pay at the end of this month (0 if not large) */
  levy: number;
  /** Day number when the policy next changes */
  changeDay: number;
}
