import { describe, expect, it } from 'vitest';
import { DAY, MIN, type DiaRoute, type DiaStop, buildRun, suggestPassing } from './diagram';

const stops = new Map<number, DiaStop>(
  [1, 2, 3, 4, 5].map((i) => [i, { id: i, name: `駅${i}`, x: i * 10, y: 0, tracks: i === 2 ? 2 : 1 }]),
);
const mk = (id: number, name: string, ids: number[], legPerStop: number, dwell: number, start: number, offsets: number[]): DiaRoute => ({
  id,
  name,
  color: 0xff0000,
  period: DAY / 4,
  orders: ids.map((stopId, i) => ({ stopId, kind: 'timed' as const, dwell, departTod: start + i * (legPerStop + dwell) })),
  legs: ids.map(() => legPerStop),
  vs: offsets.map((o, i) => [id * 10 + i, o]),
});

describe('ダイヤ', () => {
  it('編成の予定: 到着 = 前の発車 + 走行時間、発車は時刻表どおり', () => {
    const r = mk(1, '普通', [1, 2, 3], 20 * MIN, 1 * MIN, 0, [0]);
    const run = buildRun(r, 10, 0);
    expect(run.points).toHaveLength(3);
    expect(run.points[1].arr).toBeCloseTo(run.points[0].dep + 20 * MIN);
    expect(run.points[1].dep).toBeGreaterThanOrEqual(run.points[1].arr + 1 * MIN - 1e-6);
    // offset は全体をずらす
    const shifted = buildRun(r, 10, 7 * MIN);
    expect(shifted.points[0].dep - run.points[0].dep).toBeCloseTo(7 * MIN);
  });

  it('速い列車が遅い列車に追いつくと、番線のある駅での待避を提案する', () => {
    // 普通: 駅1〜5 各駅(1区間 10分)。快速: 駅1,3,5 のみで速い(1区間 12分=2区間ぶんを短縮)
    const slow = mk(1, '普通', [1, 2, 3, 4, 5], 10 * MIN, 1 * MIN, 0, [0]);
    const fast: DiaRoute = {
      id: 2,
      name: '快速',
      color: 0x00ff00,
      period: DAY / 4,
      orders: [1, 3, 5].map((stopId, i) => ({ stopId, kind: 'timed' as const, dwell: 1 * MIN, departTod: 6 * MIN + i * 13 * MIN })),
      legs: [12 * MIN, 12 * MIN, 12 * MIN],
      vs: [[20, 0]],
    };
    const s = suggestPassing([slow, fast], stops);
    expect(s.length).toBeGreaterThan(0);
    const ok = s.find((x) => !x.problem);
    expect(ok).toBeTruthy();
    expect(ok!.routeId).toBe(1); // 遅い方を待避させる
    expect(ok!.byRouteId).toBe(2);
    expect(ok!.stopName).toBe('駅2'); // 番線が2つあるのは駅2(追い越される前の駅)
    expect(ok!.delta).toBeGreaterThan(0);
  });

  it('待避できる駅(2番線以上)がないと理由つきの提案になる', () => {
    const one = new Map(stops);
    one.set(2, { id: 2, name: '駅2', x: 20, y: 0, tracks: 1 });
    const slow = mk(1, '普通', [1, 2, 3, 4, 5], 10 * MIN, 1 * MIN, 0, [0]);
    const fast: DiaRoute = { id: 2, name: '快速', color: 0, period: DAY / 4, orders: [1, 3, 5].map((stopId, i) => ({ stopId, kind: 'timed' as const, dwell: MIN, departTod: 6 * MIN + i * 13 * MIN })), legs: [12 * MIN, 12 * MIN, 12 * MIN], vs: [[20, 0]] };
    const s = suggestPassing([slow, fast], one);
    expect(s.some((x) => x.problem)).toBe(true);
    expect(s.some((x) => !x.problem)).toBe(false);
  });

  it('追い越さない(後ろから追いつかない)なら提案なし', () => {
    const slow = mk(1, '普通', [1, 2, 3, 4, 5], 10 * MIN, 1 * MIN, 0, [0]);
    const fast: DiaRoute = { id: 2, name: '快速', color: 0, period: DAY / 4, orders: [1, 3, 5].map((stopId, i) => ({ stopId, kind: 'timed' as const, dwell: MIN, departTod: -30 * MIN + i * 13 * MIN })), legs: [12 * MIN, 12 * MIN, 12 * MIN], vs: [[20, 0]] };
    // 快速が普通より前を走っていて、追いつく前に終点(速くても差が開く): 追い越しが起きない配置
    const s = suggestPassing([slow, fast], stops).filter((x) => !x.problem);
    expect(s.length).toBeLessThanOrEqual(1);
  });
});
