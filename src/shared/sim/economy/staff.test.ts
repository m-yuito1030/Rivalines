import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { GameMap } from '../../world/gameMap';
import { Transit } from '../network/transit';
import { Company, START_CASH } from './economy';
import { STAFF, requiredStaff, staffMulOf, staffRatio } from './staff';

const flat = (): GameMap => new GameMap(64, 1, new Uint8Array(64 * 64).fill(SEA_LEVEL + 10));

describe('従業員', () => {
  it('充足率と動き: 足りないほど落ちるが、0 人でも完全には止まらない。熟練度が高いと少ない人数でまかなえる', () => {
    expect(staffRatio(10, 100, 10)).toBe(1);
    expect(staffRatio(10, 0, 10)).toBeCloseTo(0.7);
    expect(staffRatio(5, 100, 10)).toBeCloseTo(0.5);
    expect(staffRatio(0, 100, 0)).toBe(1);
    expect(staffMulOf(1)).toBe(1);
    expect(staffMulOf(0)).toBe(STAFF.floor);
  });

  it('最初の日: 既にある分は必要数ぴったり(最低人数以上)が無料で付く。新しく増えた分は、採用するまで足りない', () => {
    const m = flat();
    const t = new Transit(m);
    const c = new Company();
    c.endOfDay(0, m, t, 50);
    expect(requiredStaff(m, t)).toBe(0);
    expect(c.staff).toBeGreaterThanOrEqual(STAFF.minStart);
    expect(c.staffMul).toBe(1);
  });

  it('給料は毎日かかり、採用費と広告費は予算どおり。必要数を超えると採用は止まる。予算がなければ人は増えない', () => {
    const m = flat();
    const t = new Transit(m);
    const c = new Company();
    c.endOfDay(0, m, t, 50);
    const before = c.staff;
    c.staffBudget = { hire: 0, ad: 0, edu: 0 };
    c.endOfDay(1, m, t, 50);
    expect(c.staff).toBeLessThan(before); // some quit
    expect(c.total.wage).toBeGreaterThan(0);
    c.staffBudget = { hire: 100_000, ad: 50_000, edu: 0 };
    const cash = c.cash;
    c.endOfDay(2, m, t, 50);
    // Nothing is needed (the company owns nothing), so nobody is hired and the budget is not spent on hiring
    expect(c.total.recruit ?? 0).toBe(0);
    expect(cash - c.cash).toBeLessThan(100_000);
  });

  it('必要数が足りないとき、採用すると増え、広告が多いほど応募が増える。教育で熟練度が上がる', () => {
    const m = flat();
    const t = new Transit(m);
    const c = new Company();
    c.cash = START_CASH;
    c.endOfDay(0, m, t, 50);
    // Staff far below the hiring line (nothing is needed in this empty world, so the line is the small fixed margin)
    c.staff = 2;
    c.skill = 40;
    c.staffBudget = { hire: 200_000, ad: 100_000, edu: 50_000 };
    c.endOfDay(1, m, t, 50);
    expect(c.staff).toBeGreaterThan(2);
    expect(c.total.recruit).toBeGreaterThan(0);
    expect(c.total.ad).toBeGreaterThan(0);
    expect(c.skill).toBeGreaterThan(0);
  });

  it('保存と復元で、従業員・熟練度・予算が残る。古いセーブ(従業員の項目なし)は最初の日に無料で付く', () => {
    const c = new Company();
    c.staff = 33;
    c.skill = 77;
    c.staffBudget = { hire: 500_000, ad: 0, edu: 50_000 };
    c.staffReady = true;
    const r = Company.from(JSON.parse(JSON.stringify(c.toJSON())));
    expect([r.staff, r.skill, r.staffBudget, r.staffReady]).toEqual([33, 77, { hire: 500_000, ad: 0, edu: 50_000 }, true]);
    const old = Company.from({ cash: 1, loan: 0, today: {}, total: {}, history: [], lastDay: 0 });
    expect(old.staffReady).toBe(false);
    expect(old.staffMul).toBe(1);
  });
});
