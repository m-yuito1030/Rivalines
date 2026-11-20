import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { GameMap } from '../../world/gameMap';
import { Transit, type Vehicle } from './transit';

const map = () => new GameMap(64, 1, () => new Uint8Array(4096).fill(SEA_LEVEL + 20));
const snap = (id: number, pi: number, t: number, trail: number[], path?: number[]) =>
  ({ id, routeId: 1, modelId: 'mirai8000', mode: 'rail', order: 0, pi, t, state: 'move', load: 0, cap: 100, speed: 0.1, trail, len: trail.length, flight: null, hx: 1, hy: 0, dir: 0, stuck: 0, cars: 4, hold: false, resTo: 9, ...(path ? { path } : {}) }) as unknown as Omit<Vehicle, 'path' | 'cargo'> & { path?: number[] };

describe('クライアントの補間(なめらかに動かす)', () => {
  it('10Hz の更新の間を、60fps で単調に・なめらかに進む(1フレームの移動が小さく、飛ばない)', () => {
    const t = new Transit(map());
    const path = Array.from({ length: 20 }, (_, i) => 10 * 64 + 5 + i); // y=10 を東へ
    // 100ms ごとに 0.5 タイルずつ進む(5タイル/秒)
    const times: number[] = [];
    const ps: number[] = [];
    const realNow = performance.now;
    let clock = 1000;
    (performance as { now: () => number }).now = () => clock;
    try {
      for (let k = 0; k <= 6; k++) {
        clock = 1000 + k * 100;
        const p = 4 + k * 0.5;
        const pi = Math.floor(p);
        t.mirrorVehicles([snap(1, pi, p - pi, [path[pi], path[pi - 1], path[pi - 2], path[pi - 3]], k === 0 ? path : undefined)], []);
        // この間を 16ms ごとに描く
        for (let f = 0; f < 6; f++) {
          clock = 1000 + k * 100 + f * 16;
          t.smoothMirror(clock);
          const v = t.vehicles[0];
          if (k >= 2) {
            times.push(clock);
            ps.push(v.pi + v.t);
          }
        }
      }
    } finally {
      (performance as { now: () => number }).now = realNow;
    }
    // 単調に増える
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1] - 1e-9);
    // 1フレーム(16ms)あたりの移動は、速度 5タイル/秒 ≈ 0.08 の近く(カクつくと 0.5 などの大きな飛びになる)
    const steps = ps.slice(1).map((p, i) => p - ps[i]);
    expect(Math.max(...steps)).toBeLessThan(0.2);
    // 全体としては進んでいる
    expect(ps[ps.length - 1] - ps[0]).toBeGreaterThan(1);
  });
  it('編成の軌跡(trail)は頭の位置と矛盾せず、頭が1タイル進むたびに1タイルずつずれる', () => {
    const t = new Transit(map());
    const path = Array.from({ length: 20 }, (_, i) => 10 * 64 + 5 + i);
    let clock = 0;
    (performance as { now: () => number }).now = () => clock;
    clock = 0;
    t.mirrorVehicles([snap(1, 5, 0, [path[5], path[4], path[3], path[2]], path)], []);
    clock = 100;
    t.mirrorVehicles([snap(1, 6, 0, [path[6], path[5], path[4], path[3]])], []);
    for (const now of [100, 150, 200]) {
      clock = now;
      t.smoothMirror(now);
      const v = t.vehicles[0];
      expect(v.trail[0]).toBe(path[v.pi]); // 頭は表示の位置のタイル
      for (let j = 1; j < v.trail.length; j++) expect(Math.abs(v.trail[j - 1] - v.trail[j])).toBe(1); // 隣り合うタイル
    }
  });
  it('経路が変わったとき(新しい経路が届いた)は補間せず、新しい状態をそのまま出す', () => {
    const t = new Transit(map());
    const p1 = Array.from({ length: 10 }, (_, i) => 5 * 64 + i);
    const p2 = Array.from({ length: 10 }, (_, i) => 20 * 64 + i);
    let clock = 0;
    (performance as { now: () => number }).now = () => clock;
    t.mirrorVehicles([snap(1, 8, 0.5, [p1[8], p1[7]], p1)], []);
    clock = 100;
    t.mirrorVehicles([snap(1, 1, 0, [p2[1], p2[0]], p2)], []);
    clock = 150;
    t.smoothMirror(150);
    const v = t.vehicles[0];
    expect(v.pi).toBe(1); // 新しい経路の位置(古い経路との補間で巻き戻らない)
    expect(v.trail[0]).toBe(p2[1]);
  });
  it('停車中の車両は動かず、届かなくなった車両(gone)は消える', () => {
    const t = new Transit(map());
    const path = [10 * 64 + 5, 10 * 64 + 6, 10 * 64 + 7];
    let clock = 0;
    (performance as { now: () => number }).now = () => clock;
    t.mirrorVehicles([{ ...snap(1, 2, 0, [path[2], path[1]], path), state: 'load' } as never], []);
    clock = 100;
    t.mirrorVehicles([{ ...snap(1, 2, 0, [path[2], path[1]]), state: 'load' } as never], []);
    for (const now of [120, 180, 260]) {
      t.smoothMirror(now);
      expect(t.vehicles[0].pi).toBe(2);
      expect(t.vehicles[0].t).toBe(0);
    }
    t.mirrorVehicles([], [1]);
    expect(t.vehicles).toHaveLength(0);
  });
});
