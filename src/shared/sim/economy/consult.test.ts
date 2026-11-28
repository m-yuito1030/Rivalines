import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { planFacility, placeFacility } from '../../world/facilities';
import { GameMap } from '../../world/gameMap';
import { Transit } from '../network/transit';
import { Company } from './economy';
import { CONSULT, consultTips } from './consult';

const flat = (): GameMap => new GameMap(160, 1, new Uint8Array(160 * 160).fill(SEA_LEVEL + 10));

describe('コンサル', () => {
  it('路線が一つもないときは、最初にやることを教える。契約していない会社では画面に出ない(出すかどうかは画面側)', () => {
    const m = flat();
    const tips = consultTips({ facilities: m.facilities, towns: [], transit: new Transit(m), company: new Company(), rivals: [], day: 0 });
    expect(tips[0].kind).toBe('start');
  });

  it('売り出し中の優良物件は、元が取れるのが早い順に並び、売上がない物件は出ない', () => {
    const m = flat();
    const mk = (x: number, income: number) => {
      const f = placeFacility(
        m,
        planFacility(m, x, 40, 'hotel', () => false),
        'hotel',
        'city',
      );
      f.ownerId = undefined; // for sale
      f.income = income;
      f.listedDay = 0;
      return f;
    };
    const good = mk(20, 2_000_000);
    const weak = mk(60, 100);
    const none = mk(100, 0);
    const tips = consultTips({ facilities: m.facilities, towns: [], transit: new Transit(m), company: new Company(), rivals: [], day: 3 }).filter((t) => t.kind === 'property');
    expect(tips.map((t) => t.buy)).toContain(good.id);
    expect(tips.map((t) => t.buy)).not.toContain(none.id);
    const iGood = tips.findIndex((t) => t.buy === good.id);
    const iWeak = tips.findIndex((t) => t.buy === weak.id);
    if (iWeak >= 0) expect(iGood).toBeLessThan(iWeak);
  });

  it('従業員が足りないと、急ぎの助言が出る。現金が少ないときも出る', () => {
    const m = flat();
    const c = new Company();
    c.staffReady = true;
    c.staffMul = 0.6;
    c.staffReq = 50;
    c.cash = 1_000_000;
    const kinds = consultTips({ facilities: [], towns: [], transit: new Transit(m), company: c, rivals: [], day: 0 }).map((t) => t.kind);
    expect(kinds).toContain('staff');
    expect(kinds).toContain('cash');
  });

  it('料金は期日に引かれ、払えなければ契約が終わる。保存と復元で契約が残る', () => {
    const m = flat();
    const t = new Transit(m);
    const c = new Company();
    c.consult = { next: 10 };
    c.endOfDay(9, m, t, 50);
    expect(c.total.consult ?? 0).toBe(0);
    c.endOfDay(10, m, t, 50);
    expect(c.total.consult).toBe(CONSULT.fee);
    expect(c.consult!.next).toBe(10 + CONSULT.days);
    expect(Company.from(JSON.parse(JSON.stringify(c.toJSON()))).consult).toEqual({ next: 10 + CONSULT.days });
    c.cash = 10;
    c.consult = { next: 11 };
    c.endOfDay(11, m, t, 50);
    expect(c.consult).toBeUndefined();
  });
});
