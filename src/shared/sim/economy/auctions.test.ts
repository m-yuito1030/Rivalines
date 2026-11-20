import { describe, expect, it } from 'vitest';
import { Auctions, LOT_DAYS, MAX_LOTS, blockingRight } from './auctions';

describe('入札・独占権', () => {
  it('競りを開く: 同じ街・種類の重複と、権利者がいる街・種類は不可。同時数に上限', () => {
    const a = new Auctions();
    expect(a.open(1, 'mall', 1_000_000)).not.toBeNull();
    expect(a.open(1, 'mall', 1_000_000)).toBeNull();
    expect(a.open(1, 'hotel', 1_000_000)).not.toBeNull();
    a.rights.push({ townId: 2, type: 'mall', owner: 7, paid: 1 });
    expect(a.open(2, 'mall', 1_000_000)).toBeNull();
    for (let i = 3; a.lots.length < MAX_LOTS; i++) a.open(i, 'stadium', 1);
    expect(a.open(99, 'park' as never, 1)).toBeNull();
  });

  it('入札: 最低額・刻み(5%上乗せ)・自分への再入札の不可', () => {
    const a = new Auctions();
    const lot = a.open(1, 'mall', 1_500_000)!;
    expect(a.bid(1, lot.id, 1_000_000)).not.toBeNull();
    expect(a.bid(1, lot.id, 1_500_000)).toBeNull();
    expect(a.bid(1, lot.id, 2_000_000)).not.toBeNull(); // 自分が最高額
    expect(a.bid(2, lot.id, 1_550_000)).not.toBeNull(); // 5%未満
    expect(a.minNext(lot)).toBe(1_580_000);
    expect(a.bid(2, lot.id, 1_580_000)).toBeNull();
    expect(lot.bid).toEqual({ who: 2, amount: 1_580_000 });
    expect(a.bid(2, 999, 9e9)).not.toBeNull();
  });

  it('決着: 締め切りの日に最高額の会社が支払って権利を得る。入札なしは流札、支払えなければ流札', () => {
    const a = new Auctions();
    const l1 = a.open(1, 'mall', 1)!;
    a.open(2, 'hotel', 1);
    const l3 = a.open(3, 'stadium', 1)!;
    a.bid(5, l1.id, 100);
    a.bid(6, l3.id, 100);
    const paid: [number, number][] = [];
    const pay = (who: number, amt: number) => {
      if (who === 6) return false;
      paid.push([who, amt]);
      return true;
    };
    for (let d = 1; d < LOT_DAYS; d++) expect(a.settleDay(pay)).toEqual([]);
    const res = a.settleDay(pay);
    expect(res).toHaveLength(3);
    expect(res.find((r) => r.lot.id === l1.id)).toMatchObject({ winner: 5, amount: 100 });
    expect(res.find((r) => r.lot.id === l3.id)!.failed).toBe(true);
    expect(res.filter((r) => r.winner === undefined && !r.failed)).toHaveLength(1);
    expect(paid).toEqual([[5, 100]]);
    expect(a.holder(1, 'mall')).toBe(5);
    expect(a.holder(3, 'stadium')).toBeUndefined();
    expect(a.lots).toHaveLength(0);
  });

  it('独占権: 街の範囲内で他社の施設だけ妨げる。離れた場所・他の種類・持ち主は妨げない。セーブ復元', () => {
    const a = new Auctions();
    a.rights.push({ townId: 1, type: 'mall', owner: 7, paid: 1 });
    const towns = [{ x: 100, y: 100, pop: 500 }] as never[]; // 村(半径10)
    expect(blockingRight(a, towns, 8, 'mall', 105, 100)).toBeTruthy();
    expect(blockingRight(a, towns, 7, 'mall', 105, 100)).toBeUndefined();
    expect(blockingRight(a, towns, 8, 'hotel', 105, 100)).toBeUndefined();
    expect(blockingRight(a, towns, 8, 'mall', 140, 100)).toBeUndefined();
    const b = new Auctions();
    b.load(JSON.parse(JSON.stringify(a.toJSON())));
    expect(b.holder(1, 'mall')).toBe(7);
  });
});
