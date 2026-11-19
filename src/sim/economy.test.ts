import { describe, expect, it } from 'vitest';
import { modelOf } from '../data/models';
import { SEA_LEVEL } from '../world/constants';
import { FACILITY_SPECS, planFacility, placeFacility } from '../world/facilities';
import { GameMap } from '../world/gameMap';
import { connect } from '../world/roads';
import { Company, START_CASH, TAX_RATE, assetValue, facilityValue, gradeOf, vehiclePrice } from './economy';
import { acquirePrice, acquireRival, createRivals, divestPrice, divestRival, stepRivals } from './rivals';
import { companyRanking, playerRank, routeRanking, stopRanking, townRanking } from './ranking';
import { Simulation, TICKS_PER_DAY } from './simulation';
import { Transit } from './transit';
import { spawnCityBusiness } from './cityBusiness';
import { makeRng } from '../world/towns';
import { calendarOf, fiscalPeriodOf, fiscalRange, quarterOf } from './calendar';

describe('会社の経営', () => {
  it('収入・支出・残高、足りなければ支出できない、運行費は残高がマイナスでも払う', () => {
    const c = new Company();
    expect(c.cash).toBe(START_CASH);
    c.earn('fare-road', 1000);
    expect(c.cash).toBe(START_CASH + 1000);
    expect(c.spend('build', START_CASH * 2)).toBe(false);
    expect(c.cash).toBe(START_CASH + 1000);
    expect(c.spend('build', 500)).toBe(true);
    c.pay('running', START_CASH * 2);
    expect(c.cash).toBeLessThan(0);
    expect(c.today['fare-road']).toBe(1000);
    expect(c.today.build).toBe(500);
  });
  it('融資: 評価で上限と金利が変わり、最悪の評価では借りられず、返済できる', () => {
    const c = new Company();
    expect(c.maxLoan(10, 0)).toBe(0);
    expect(c.maxLoan(90, 0)).toBeGreaterThan(c.maxLoan(30, 0));
    expect(c.interestRate(90)).toBeLessThan(c.interestRate(20));
    expect(c.borrow(5_000_000, 60, 0)).toBeNull();
    expect(c.loan).toBe(5_000_000);
    expect(c.cash).toBe(START_CASH + 5_000_000);
    expect(c.borrow(500_000_000, 60, 0)).toContain('上限');
    expect(c.repay(2_000_000)).toBe(2_000_000);
    expect(c.loan).toBe(3_000_000);
    expect(c.repay(Infinity)).toBe(3_000_000);
    expect(c.loan).toBe(0);
    expect(c.netWorth(1000)).toBe(c.cash + 1000);
  });
  it('価格: 車両は両数で比例し、鉄道は高速ほど高い', () => {
    const m = modelOf('mirai8000');
    expect(vehiclePrice(m, 8)).toBe(vehiclePrice(m, 4) * 2);
    expect(vehiclePrice(modelOf('bus-l'))).toBeGreaterThan(vehiclePrice(modelOf('bus-s')));
  });
});

function line() {
  const size = 128;
  const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
  for (let x = 5; x < 60; x++) connect(map, x, 20, 1, false);
  for (const x of [8, 9, 54, 55]) map.building.set(map.idx(x, 21), 3);
  return map;
}

describe('売上(運賃・施設)と費用', () => {
  it('運賃: 乗車で基本運賃、停留所到着で距離運賃が入る。1日の締めで運行費・維持費・利払いが引かれる', () => {
    const map = line();
    const sim = new Simulation(map);
    const tr = sim.transit;
    const a = tr.addStop(7, 20)!;
    const b = tr.addStop(56, 20)!;
    const r = tr.addRoute([a.id, b.id])!;
    tr.addVehicle(r.id, 0);
    sim.company.borrow(10_000_000, 60, 0);
    const cash0 = sim.company.cash;
    for (let i = 0; i < 5000; i++) sim.step();
    expect(sim.company.total['fare-road'] ?? 0).toBeGreaterThan(0);
    const fare = sim.company.total['fare-road'];
    // 日の締め
    while (sim.tick < TICKS_PER_DAY) sim.step();
    expect(sim.company.total.running).toBeGreaterThan(0);
    expect(sim.company.total.upkeep).toBeGreaterThan(0);
    expect(sim.company.total.interest).toBeGreaterThan(0);
    expect(sim.company.history).toHaveLength(1);
    expect(sim.company.history[0].revenue).toBeGreaterThanOrEqual(fare);
    expect(sim.company.cash).not.toBe(cash0);
    // セーブで経営も保たれる
    const st = JSON.parse(JSON.stringify(sim.state()));
    const sim2 = new Simulation(line(), st);
    expect(sim2.company.cash).toBe(sim.company.cash);
    expect(sim2.company.loan).toBe(sim.company.loan);
    expect(sim2.company.history).toHaveLength(1);
  });
  it('施設の売上: 自社の施設だけ売上になり、他社の施設は売上にならない。買収で自社に', () => {
    const map = line();
    const sim = new Simulation(map);
    const tr = sim.transit;
    const b = tr.addStop(56, 20)!;
    const a = tr.addStop(7, 20)!;
    const mk = (owner: 'player' | 'city') => placeFacility(map, planFacility(map, 56, 24, 'department', () => false), 'department', owner);
    const f = mk('city');
    for (let t = 0; t < 120; t++) tr.step(t);
    expect(b.facs).toContain(f.id);
    const co = sim.company;
    const before = co.total.facility ?? 0;
    // 他社の施設は売上にならない(来場だけ数える)
    co.visits(map, b, 100, 0);
    expect(co.total.facility ?? 0).toBe(before);
    expect(f.visits).toBeGreaterThan(0);
    // 買収
    const price = facilityValue(f);
    expect(price).toBeGreaterThan(FACILITY_SPECS.department.cost * 0.8);
    expect(co.spend('acquire', price)).toBe(true);
    f.owner = 'player';
    co.visits(map, b, 100, 13 * 600 - 6 * 600); // 13時(営業時間内)
    expect(co.total.facility ?? 0).toBeGreaterThan(before);
    expect(f.dayIncome ?? 0).toBeGreaterThan(0);
    // 自社の施設は維持費がかかり、資産評価に入る
    expect(assetValue(map, tr)).toBeGreaterThan(0);
    void a;
  });
  it('民間の施設: 街が大きくなると百貨店などが建つ(他社)', () => {
    const size = 160;
    const map = new GameMap(size, 3, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
    const sim = new Simulation(map);
    for (let i = 0; i < 60000; i++) sim.step();
    const town = [...map.towns].sort((p, q) => q.pop - p.pop)[0];
    expect(town.pop).toBeGreaterThan(250);
    const rng = makeRng(4);
    let built = 0;
    for (let i = 0; i < 40; i++) built += spawnCityBusiness(map, sim.transit, rng, 1);
    // シミュレーション中にも建つので、ここでの新規が0でも構わない。民間の施設が存在し、百貨店・モールはスプライト用の情報を持つ
    expect(built).toBeGreaterThanOrEqual(0);
    expect(map.facilities.some((f) => f.owner === 'city')).toBe(true);
    for (const f of map.facilities.filter((x) => x.owner === 'city' && (x.type === 'department' || x.type === 'mall'))) {
      expect(['S', 'M', 'L']).toContain(f.size);
      expect(f.design).toBeGreaterThanOrEqual(0);
      expect(f.design).toBeLessThan(20);
      expect(f.w).toBe(f.size === 'L' ? 2 : 1);
    }
    // 民間の施設は city。市役所・学校は public で別扱い
    expect(map.facilities.every((f) => f.owner === 'city' || f.owner === 'public')).toBe(true);
    void Transit;
  });
});

describe('格付け・株価・競合会社の買収・ランキング', () => {
  it('格付けの区分: 点数が高いほど金利が低く融資上限が大きい。D は借りられない', () => {
    expect(gradeOf(90)).toBe('AAA');
    expect(gradeOf(60)).toBe('BBB');
    expect(gradeOf(20)).toBe('CCC');
    expect(gradeOf(5)).toBe('D');
    const c = new Company();
    expect(c.interestRate(90)).toBeLessThan(c.interestRate(60));
    expect(c.interestRate(60)).toBeLessThan(c.interestRate(20));
    expect(c.maxLoan(5, 0)).toBe(0);
    expect(c.maxLoan(90, 0)).toBeGreaterThan(c.maxLoan(60, 0));
  });
  it('日々の更新で格付けと株価が動く: 黒字・低負債だと上がり、赤字・借金だと下がる', () => {
    const map = line();
    const tr = new Transit(map);
    const good = new Company();
    const bad = new Company();
    bad.loan = 20_000_000;
    bad.cash = -5_000_000;
    for (let d = 0; d < 30; d++) {
      good.history.push({ day: d, revenue: 1_000_000, cost: 300_000 });
      bad.history.push({ day: d, revenue: 100_000, cost: 900_000 });
      good.updateCreditAndStock(80, 0);
      bad.updateCreditAndStock(20, 0);
    }
    expect(good.credit).toBeGreaterThan(bad.credit);
    expect(good.stock).toBeGreaterThan(bad.stock);
    expect(good.stockHistory.length).toBe(30);
    expect(good.marketCap).toBeCloseTo(good.stock * 100_000);
    void tr;
  });
  it('競合会社: 決定論的に増減し、買収で傘下に入り(施設が自社に)、利益が毎日入り、手放せる', () => {
    const mk = () => createRivals(makeRng(5));
    const a = mk();
    const b = mk();
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    const ra = makeRng(9);
    const rb = makeRng(9);
    for (let i = 0; i < 60; i++) {
      stepRivals(a, ra);
      stepRivals(b, rb);
    }
    expect(a).toEqual(b);
    expect(a[0].stockHistory.length).toBeGreaterThan(30);
    const map = line();
    const sim = new Simulation(map);
    const r = sim.rivals[0];
    const f = placeFacility(map, planFacility(map, 80, 80, 'hotel', () => false), 'hotel', 'city');
    f.ownerId = r.id;
    const other = placeFacility(map, planFacility(map, 100, 100, 'hotel', () => false), 'hotel', 'city');
    other.ownerId = sim.rivals[1].id;
    const price = acquirePrice(r);
    expect(price).toBeGreaterThan(r.value);
    sim.company.cash = price - 1;
    expect(acquireRival(sim.company, r, map)).toContain('資金');
    expect(r.acquired).toBe(false);
    sim.company.cash = price + 1_000_000;
    expect(acquireRival(sim.company, r, map)).toBeNull();
    expect(r.acquired).toBe(true);
    expect(f.owner).toBe('player');
    expect(other.owner).toBe('city'); // ほかの会社の施設はそのまま
    expect(acquireRival(sim.company, r, map)).toContain('傘下');
    // 傘下の利益が毎日入る
    const before = sim.company.total.subsidiary ?? 0;
    while (sim.tick < TICKS_PER_DAY) sim.step();
    expect(sim.company.total.subsidiary ?? 0).toBeGreaterThan(before);
    // 傘下の評価は資産に入る。手放すと売却代金が入り、傘下から外れる
    expect(assetValue(map, sim.transit, sim.rivals)).toBeGreaterThan(assetValue(map, sim.transit, []));
    const get = divestRival(sim.company, r);
    expect(get).toBe(divestPrice(r));
    expect(r.acquired).toBe(false);
    // セーブで競合・株価が保たれる
    const st = JSON.parse(JSON.stringify(sim.state()));
    const sim2 = new Simulation(line(), st);
    expect(sim2.rivals.map((x) => x.value)).toEqual(sim.rivals.map((x) => x.value));
    expect(sim2.company.stock).toBeCloseTo(sim.company.stock);
  });
  it('ランキング: 会社(時価総額順・傘下は除く)、街、停留所の乗降、路線の利益', () => {
    const map = line();
    const sim = new Simulation(map);
    const tr = sim.transit;
    const a = tr.addStop(7, 20)!;
    const b = tr.addStop(56, 20)!;
    const r = tr.addRoute([a.id, b.id])!;
    tr.addVehicle(r.id, 0);
    for (let i = 0; i < 3 * 600; i++) sim.step();
    expect(stopRanking(tr)[0].traffic).toBeGreaterThanOrEqual(stopRanking(tr)[1].traffic);
    expect(stopRanking(tr).some((s) => s.traffic > 0)).toBe(true);
    while (sim.tick < TICKS_PER_DAY) sim.step();
    const rr = routeRanking(tr);
    expect(rr).toHaveLength(1);
    expect(rr[0].income).toBeGreaterThan(0);
    expect(rr[0].profit).toBeLessThan(rr[0].income); // 運行費が引かれる
    const rows = companyRanking(sim.company, sim.rivals, map, tr);
    expect(rows).toHaveLength(5);
    expect([...rows].sort((p, q) => q.marketCap - p.marketCap)).toEqual(rows);
    sim.rivals[2].acquired = true;
    expect(companyRanking(sim.company, sim.rivals, map, tr)).toHaveLength(4);
    const pr = playerRank(sim.company, sim.rivals, map, tr);
    expect(pr.rank).toBeGreaterThanOrEqual(1);
    expect(pr.total).toBe(4);
    expect(townRanking(map, tr).map((t) => t.pop)).toEqual([...townRanking(map, tr).map((t) => t.pop)].sort((x, y) => y - x));
  });
});

describe('暦と決算期', () => {
  it('2026年4月1日 06:00 開始、実際の暦(月の日数・うるう年)で1日ずつ進み、期・四半期が決まる', () => {
    const map = line();
    const sim = new Simulation(map);
    expect(sim.date).toMatchObject({ year: 2026, month: 4, day: 1, hour: 6, minute: 0, period: 1, quarter: 1, weekday: 3 }); // 水曜
    expect(calendarOf(0)).toMatchObject({ year: 2026, month: 4, day: 1 });
    expect(calendarOf(29)).toMatchObject({ month: 4, day: 30 });
    expect(calendarOf(30)).toMatchObject({ month: 5, day: 1 });
    expect(calendarOf(364)).toMatchObject({ year: 2027, month: 3, day: 31 });
    expect(calendarOf(365)).toMatchObject({ year: 2027, month: 4, day: 1 });
    // うるう年(2028年2月は29日まである)
    const feb29 = Array.from({ length: 1500 }, (_, i) => calendarOf(i)).find((c) => c.year === 2028 && c.month === 2 && c.day === 29);
    expect(feb29).toBeDefined();
    expect(fiscalPeriodOf(2026, 4)).toBe(1);
    expect(fiscalPeriodOf(2027, 3)).toBe(1);
    expect(fiscalPeriodOf(2027, 4)).toBe(2);
    expect([4, 6, 7, 9, 10, 12, 1, 3].map(quarterOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(fiscalRange(1)).toEqual({ from: '2026/4/1', to: '2027/3/31' });
    expect(fiscalRange(3)).toEqual({ from: '2028/4/1', to: '2029/3/31' });
    // 1日(TICKS_PER_DAY)進むと翌日の同時刻
    for (let i = 0; i < TICKS_PER_DAY; i++) sim.step();
    expect(sim.date).toMatchObject({ month: 4, day: 2, hour: 6 });
  });
  it('決算: 損益の確定・インフラ償却・繰越欠損金の相殺・法人税・配当・決算書。期の最終日に自動で行われる', () => {
    const c = new Company();
    c.fy = { 'fare-road': 10_000_000, running: 2_000_000, upkeep: 1_000_000, interest: 500_000 };
    c.infra = 20_000_000; // 償却 2,000,000
    const cash0 = c.cash;
    c.payout = 0.4;
    const r1 = c.closeFiscalYear(1, 0);
    expect(r1.revenue).toBe(10_000_000);
    expect(r1.depreciation).toBe(2_000_000);
    expect(r1.opProfit).toBe(10_000_000 - 2_000_000 - 1_000_000 - 2_000_000); // 5,000,000
    expect(r1.preTax).toBe(4_500_000);
    expect(r1.tax).toBe(Math.round(4_500_000 * TAX_RATE));
    expect(r1.netIncome).toBe(4_500_000 - r1.tax);
    expect(r1.dividend).toBe(Math.round(r1.netIncome * 0.4));
    expect(c.cash).toBe(cash0 - r1.tax - r1.dividend);
    expect(c.infra).toBe(18_000_000);
    expect(c.period).toBe(2);
    expect(c.fy).toEqual({});
    // 赤字は繰越欠損金になり、次の黒字と相殺して税が減る
    c.fy = { 'fare-road': 1_000_000, running: 4_000_000 };
    const r2 = c.closeFiscalYear(2, 0);
    expect(r2.preTax).toBeLessThan(0);
    expect(r2.tax).toBe(0);
    expect(r2.dividend).toBe(0);
    expect(c.loss).toBeGreaterThan(0);
    const lossBefore = c.loss;
    c.fy = { 'fare-road': lossBefore + 1_000_000 + 1_620_000 };
    c.infra = 0;
    const r3 = c.closeFiscalYear(3, 0);
    expect(c.loss).toBe(0);
    expect(r3.preTax).toBe(lossBefore + 1_000_000 + 1_620_000);
    expect(r3.tax).toBe(Math.round((r3.preTax - lossBefore) * TAX_RATE));
    expect(c.reports).toHaveLength(3);
    // 決算書はセーブされる
    const c2 = Company.from(JSON.parse(JSON.stringify(c.toJSON())));
    expect(c2.reports).toHaveLength(3);
    expect(c2.period).toBe(4);
    expect(c2.payout).toBe(0.4);
  });
  it('建設費は資産計上(インフラ)され、純資産に含まれる。決算の日にシミュレーションが自動で決算する', () => {
    const c = new Company();
    const nw0 = c.netWorth(0);
    expect(c.spend('build', 1_000_000)).toBe(true);
    expect(c.infra).toBe(1_000_000);
    expect(c.netWorth(0)).toBe(nw0); // 現金が減った分、インフラ資産が増える
    const map = line();
    const sim = new Simulation(map);
    const closed: number[] = [];
    sim.onFiscalClose = (r) => closed.push(r.period);
    // 2027年3月31日の終わり(= 開始から365日後の 0:00)まで進める
    const end = 365 * TICKS_PER_DAY - TICKS_PER_DAY / 4;
    while (sim.tick < end - 1) sim.step();
    expect(closed).toEqual([]);
    sim.step();
    sim.step();
    expect(closed).toEqual([1]);
    expect(sim.date).toMatchObject({ year: 2027, month: 4, day: 1, period: 2 });
    expect(sim.company.reports).toHaveLength(1);
    expect(sim.company.reports[0].from).toBe('2026/4/1');
    expect(sim.company.period).toBe(2);
  });
});
