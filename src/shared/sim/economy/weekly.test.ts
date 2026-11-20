import { describe, expect, it } from 'vitest';
import { WEEK_DAYS, Weekly, standings, winners } from './weekly';

const M = (nw: number, pax: number, profit: number) => ({ nw, pax, profit });

describe('週間ランキング', () => {
  it('週の最後の日に結果を確定し、数え直す。基準のない(途中参加の)会社は次の週から', () => {
    const w = new Weekly();
    const cur: Record<number, ReturnType<typeof M>> = { 1: M(100, 10, 5), 2: M(200, 0, 0) };
    for (let d = 0; d < WEEK_DAYS - 1; d++) expect(w.onDay(d, [1, 2], (id) => cur[id])).toBeNull();
    cur[1] = M(150, 30, 25);
    cur[2] = M(180, 5, -20);
    cur[3] = M(999, 999, 999); // 途中参加
    const r = w.onDay(WEEK_DAYS - 1, [1, 2, 3], (id) => cur[id])!;
    expect(r.week).toBe(1);
    expect(r.rows).toEqual([
      { id: 1, nw: 50, pax: 20, profit: 20 },
      { id: 2, nw: -20, pax: 5, profit: -20 },
    ]); // 3 は基準がないので入らない
    expect(w.week).toBe(2);
    expect(w.last).toBe(r);
    // 次の週の基準は確定時点の値
    expect(standings(w.toJSON(), [{ id: 3, name: 'c', netWorth: 1000, passengers: 1000, profitTotal: 1000 }])[0].d).toEqual(M(1, 1, 1));
  });

  it('途中経過: 基準との差で、純資産の増加が多い順。基準のない会社は0', () => {
    const w = new Weekly();
    w.onDay(0, [1, 2], (id) => (id === 1 ? M(100, 0, 0) : M(500, 0, 0)));
    const st = standings(w.toJSON(), [
      { id: 1, name: 'a', netWorth: 160, passengers: 3, profitTotal: 9 },
      { id: 2, name: 'b', netWorth: 480, passengers: 0, profitTotal: 0 },
      { id: 9, name: 'z', netWorth: 1e6, passengers: 5, profitTotal: 5 },
    ]);
    expect(st.map((s) => s.id)).toEqual([1, 9, 2]);
    expect(st[0].d).toEqual(M(60, 3, 9));
    expect(st[1].d).toEqual(M(0, 0, 0));
  });

  it('部門ごとの1位と、セーブ・復元', () => {
    const w = new Weekly();
    w.onDay(0, [1, 2], () => M(0, 0, 0));
    const cur: Record<number, ReturnType<typeof M>> = { 1: M(10, 1, 100), 2: M(5, 9, 50) };
    for (let d = 1; d < WEEK_DAYS; d++) w.onDay(d, [1, 2], d === WEEK_DAYS - 1 ? (id) => cur[id] : () => M(0, 0, 0));
    expect(winners(w.last)).toEqual({ nw: 1, pax: 2, profit: 1 });
    expect(winners(undefined)).toEqual({ nw: undefined, pax: undefined, profit: undefined });
    const q = new Weekly();
    q.load(JSON.parse(JSON.stringify(w.toJSON())));
    expect(q.week).toBe(2);
    expect(q.last?.rows).toHaveLength(2);
  });
});
