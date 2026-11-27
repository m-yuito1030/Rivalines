import { describe, expect, it } from 'vitest';
import { GameMap } from '../../world/gameMap';
import { SEA_LEVEL } from '../../world/constants';
import { Simulation, TICKS_PER_DAY } from '../simulation';
import { TAX_RATE } from './economy';
import { Government, LEVY_BASE, POLICIES, POLICY_KEYS, SUBSIDY_CAP_MIN, classify, corporateTaxRate, policyOfMonth, runningMul, stanceOfPeriod } from './government';

describe('国策と政権', () => {
  it('国策は、世界の種と年月だけで決まる(同じなら同じ)。月ごとに違いが出て、すべての種類が出うる', () => {
    expect(policyOfMonth(7, 2026, 5)).toBe(policyOfMonth(7, 2026, 5));
    const seen = new Set<string>();
    for (let y = 2026; y < 2036; y++) for (let m = 1; m <= 12; m++) seen.add(policyOfMonth(20260401, y, m));
    expect(seen.size).toBe(POLICY_KEYS.length);
    const months = new Set<string>();
    for (let m = 1; m <= 12; m++) months.add(policyOfMonth(20260401, 2027, m));
    expect(months.size).toBeGreaterThan(2);
  });

  it('政権(企業寄り・中道・再分配)は、年度ごとに決まり、3種類とも出る', () => {
    const seen = new Set<string>();
    for (let p = 1; p < 60; p++) seen.add(stanceOfPeriod(20260401, p));
    expect(seen.size).toBe(3);
  });

  it('規模の分類: 3社未満は対象外。上位3分の1が大企業、下位の半分が小さい会社', () => {
    expect([
      ...classify([
        { id: 1, netWorth: 9 },
        { id: 2, netWorth: 1 },
      ]).values(),
    ]).toEqual(['none', 'none']);
    const list = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, netWorth: (6 - i) * 100 }));
    const c = classify(list);
    expect([1, 2].map((i) => c.get(i))).toEqual(['large', 'large']);
    expect([3].map((i) => c.get(i))).toEqual(['middle']);
    expect([4, 5, 6].map((i) => c.get(i))).toEqual(['small', 'small', 'small']);
  });

  it('法人税率: 大企業だけ高い。増税で大企業がさらに上がり、減税で全社が下がる(15%〜50%に収める)', () => {
    const base = TAX_RATE;
    expect(corporateTaxRate(base, 'small', 'normal', 'balanced')).toBeCloseTo(base);
    expect(corporateTaxRate(base, 'large', 'normal', 'balanced')).toBeCloseTo(base + 0.05);
    expect(corporateTaxRate(base, 'large', 'austerity', 'balanced')).toBeCloseTo(base + 0.1);
    expect(corporateTaxRate(base, 'small', 'austerity', 'balanced')).toBeCloseTo(base);
    expect(corporateTaxRate(base, 'small', 'taxcut', 'balanced')).toBeCloseTo(base - 0.05);
    expect(corporateTaxRate(base, 'large', 'normal', 'redistribute')).toBeGreaterThan(corporateTaxRate(base, 'large', 'normal', 'probiz'));
    expect(corporateTaxRate(0.2, 'small', 'taxcut', 'probiz')).toBeGreaterThanOrEqual(0.15);
    expect(corporateTaxRate(0.45, 'large', 'austerity', 'redistribute')).toBeLessThanOrEqual(0.5);
  });

  it('運行費: 環境規制は車両の多い会社ほど重い。規制緩和は1割安い', () => {
    expect(runningMul('normal', 500)).toBe(1);
    expect(runningMul('eco', 0)).toBeCloseTo(1.08);
    expect(runningMul('eco', 150)).toBeCloseTo(1.25);
    expect(runningMul('eco', 9999)).toBeCloseTo(1.25);
    expect(runningMul('dereg', 10)).toBe(0.9);
    expect(POLICIES.infra.buildMul).toBeLessThan(1);
    expect(POLICIES.tourism.visitorMul).toBeGreaterThan(1);
  });
});

describe('大企業への課税と、小さい会社への還元', () => {
  const list = [
    { id: 1, netWorth: 100_000_000 },
    { id: 2, netWorth: 60_000_000 },
    { id: 3, netWorth: 30_000_000 },
    { id: 4, netWorth: 10_000_000 },
    { id: 5, netWorth: 5_000_000 },
    { id: 6, netWorth: 1_000_000 },
  ];

  it('上位3分の1が純資産の一定割合を納め、下位の半分に配られる。お金は増えも減りもしない(国庫を含めて)', () => {
    const g = new Government();
    const r = g.monthly(list, 'normal', 'balanced');
    expect([...r.levies.keys()].sort()).toEqual([1, 2]);
    expect(r.levies.get(1)).toBe(Math.round(100_000_000 * LEVY_BASE));
    expect([...r.subsidies.keys()].sort()).toEqual([4, 5, 6]);
    const paid = [...r.levies.values()].reduce((a, b) => a + b, 0);
    const given = [...r.subsidies.values()].reduce((a, b) => a + b, 0);
    expect(paid).toBe(given + g.treasury);
    expect(given).toBeGreaterThan(0);
  });

  it('1社あたりの上限があり、配りきれない分は国庫に残って次の月に回る。増税は2倍・減税は半分', () => {
    const g = new Government();
    const r = g.monthly(list, 'normal', 'redistribute');
    for (const [id, amount] of r.subsidies) {
      const nw = list.find((c) => c.id === id)!.netWorth;
      expect(amount).toBeLessThanOrEqual(Math.max(SUBSIDY_CAP_MIN, Math.round(nw * 0.03)));
    }
    const before = g.treasury;
    expect(before).toBeGreaterThanOrEqual(0);
    const a = new Government().monthly(list, 'austerity', 'balanced').levies.get(1)!;
    const n = new Government().monthly(list, 'normal', 'balanced').levies.get(1)!;
    const t = new Government().monthly(list, 'taxcut', 'balanced').levies.get(1)!;
    expect(a).toBe(n * 2);
    expect(t).toBe(Math.round(n / 2));
  });

  it('3社未満では課税も還元もしない。国庫は保存して戻せる', () => {
    const g = new Government();
    const r = g.monthly(list.slice(0, 2), 'normal', 'balanced');
    expect(r.levies.size + r.subsidies.size).toBe(0);
    g.treasury = 12345;
    const h = new Government();
    h.load(g.toJSON());
    expect(h.treasury).toBe(12345);
  });
});

describe('シミュレーションへの反映', () => {
  const mk = () => {
    const size = 128;
    const map = new GameMap(size, 20260401, new Uint8Array(size * size).fill(SEA_LEVEL + 20));
    const sim = new Simulation(map, undefined, { multi: true });
    sim.setOnline([1, 2, 3, 4, 5, 6]);
    for (let i = 1; i <= 6; i++) sim.playerCompany(i).cash = i * 10_000_000;
    return sim;
  };

  it('月が変わる日の締めで、大企業から課税し、小さい会社に補助金が入る', () => {
    const sim = mk();
    // Advance to the day close that ends April 2026 (day 29: April 1 + 29 days = April 30 is index 29)
    sim.tick = 30 * TICKS_PER_DAY - TICKS_PER_DAY / 4 - 1;
    const before = [1, 2, 3, 4, 5, 6].map((i) => sim.playerCompany(i).cash);
    sim.step();
    const after = [1, 2, 3, 4, 5, 6].map((i) => sim.playerCompany(i).cash);
    const levy = [1, 2, 3, 4, 5, 6].map((i) => sim.playerCompany(i).total.levy ?? 0);
    const subsidy = [1, 2, 3, 4, 5, 6].map((i) => sim.playerCompany(i).total.subsidy ?? 0);
    expect(levy[5]).toBeGreaterThan(0); // the richest (id 6) is large
    expect(levy[0]).toBe(0); // the poorest is not
    expect(subsidy[0]).toBeGreaterThan(0); // the poorest gets a subsidy
    expect(subsidy[5]).toBe(0);
    expect(after[0]).toBeGreaterThan(before[0] - 1_000_000);
    expect(sim.gov.treasury).toBeGreaterThanOrEqual(0);
  });

  it('govInfoFor: 今の国策・来月の国策・自分の規模と来月の課税額・切り替わる日を返す', () => {
    const sim = mk();
    const g = sim.govInfoFor(6);
    expect(POLICY_KEYS).toContain(g.policy);
    expect(POLICY_KEYS).toContain(g.next);
    expect(g.size).toBe('large');
    expect(g.levy).toBeGreaterThan(0);
    expect(g.changeDay).toBeGreaterThan(sim.day);
    expect(sim.govInfoFor(1).levy).toBe(0);
    expect(sim.govInfoFor(1).size).toBe('small');
  });

  it('国庫はセーブに残る', () => {
    const sim = mk();
    sim.gov.treasury = 777;
    const again = new Simulation(sim.map, sim.state(), { multi: true });
    expect(again.gov.treasury).toBe(777);
  });
});
