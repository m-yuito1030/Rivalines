import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/shared/world/gameMap';
import { Simulation } from '../src/shared/sim/simulation';
import { SEA_LEVEL } from '../src/shared/world/constants';
import { execute } from './commands/index';
import { validTxArgs } from './commands/route';
import { MAX_ORDERS_PER_ROUTE, MAX_ROUTES_PER_PLAYER } from './commands/util';
import { Governor, MSG_PER_SEC, isHeavy, messageLimit } from './limits';
import { Replicator } from './replicate';
import { Accounts } from './accounts';
import type { Cmd } from '../src/shared/protocol';

const world = () => {
  const map = new GameMap(128, 1, new Uint8Array(128 * 128).fill(SEA_LEVEL + 20));
  const sim = new Simulation(map, undefined, { multi: true });
  for (let i = 0; i < map.size * map.size; i++) {
    map.building.set(i, 0);
    map.road.set(i, 0);
    map.owner.set(i, 0);
  }
  map.towns.length = 0;
  map.facilities.length = 0;
  sim.setOnline([1, 2]);
  return sim;
};
/** 道路・停留所2つ・路線1本・基地・車両1台を用意して、路線の ID を返す */
const setup = (sim: Simulation, who = 1) => {
  execute(sim, who, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 120, y: 100 } });
  const a = execute(sim, who, { t: 'ensureStop', x: 92, y: 100, kind: 'road' });
  const b = execute(sim, who, { t: 'ensureStop', x: 118, y: 100, kind: 'road' });
  const rt = execute(sim, who, { t: 'routeCreate', stops: [a.id!, b.id!] });
  const dp = execute(sim, who, { t: 'place', tool: 'depot', x: 95, y: 100 });
  execute(sim, who, { t: 'buyVehicle', depotId: dp.id!, routeId: rt.id!, modelId: sim.transit.routes.get(rt.id!)!.modelId, cars: 1 });
  return { route: rt.id!, a: a.id!, b: b.id! };
};

describe('セキュリティ: 信号の一括設置', () => {
  it('範囲(a・b)が無い・不正な命令は、例外ではなく失敗として返る', () => {
    const sim = world();
    for (const cmd of [
      { t: 'signalLine' },
      { t: 'signalLine', a: null, b: { x: 1, y: 1 } },
      { t: 'signalLine', a: { x: 1, y: 1 } },
      { t: 'signalLine', a: { x: 'a', y: 1 }, b: { x: 3, y: 1 } },
    ]) {
      expect(execute(sim, 1, cmd as never).ok).toBe(false);
    }
  });
});

describe('セキュリティ: tx の引数', () => {
  it('メソッドごとに、個数・整数・方向(+1/-1)・有限の数を厳密に確かめる', () => {
    expect(validTxArgs('moveOrder', [3, 0, 1])).toBe(true);
    expect(validTxArgs('moveOrder', [3, 0, -1])).toBe(true);
    for (const dir of [0, 0.5, 1.5, 2, -2, 'x', '1', null, undefined, NaN, Infinity, [], {}, true]) expect(validTxArgs('moveOrder', [3, 0, dir]), `dir=${String(dir)}`).toBe(false);
    for (const bad of [[3, 0], [3, 0, 1, 9], [], 'abc', null, {}, [3.5, 0, 1], [3, '0', 1], [3, NaN, 1], [3, 2 ** 60, 1]])
      expect(validTxArgs('moveOrder', bad), JSON.stringify(bad)).toBe(false);
    expect(validTxArgs('autoTimetable', [3, 100])).toBe(true);
    expect(validTxArgs('autoTimetable', [3, NaN])).toBe(false);
    expect(validTxArgs('autoTimetable', [3, 'x'])).toBe(false);
    expect(validTxArgs('removeRoute', [3])).toBe(true);
    expect(validTxArgs('removeRoute', [3, 4])).toBe(false);
    expect(validTxArgs('nonsense', [3])).toBe(false);
    expect(validTxArgs('__proto__', [3])).toBe(false);
  });

  it('不正な向きの moveOrder は拒否され、路線のオーダーは壊れない(以前は順序が壊れて世界が止まり続けた)', () => {
    const sim = world();
    const { route } = setup(sim);
    const r = sim.transit.routes.get(route)!;
    const before = JSON.stringify(r.orders);
    for (const dir of ['x', 0.5, 1.5, 0, 2, null]) {
      const res = execute(sim, 1, { t: 'tx', m: 'moveOrder', a: [route, 0, dir as never] });
      expect(res.ok).toBe(false);
    }
    expect(JSON.stringify(r.orders)).toBe(before);
    expect(r.orders.every((o) => o && typeof o === 'object')).toBe(true);
    for (let i = 0; i < 300; i++) sim.step(); // 世界は問題なく進む
    // 正しい向きは動く
    expect(execute(sim, 1, { t: 'tx', m: 'moveOrder', a: [route, 0, 1] }).ok).toBe(true);
    // orderShift の from が小数でも、例外にならず拒否される
    expect(execute(sim, 1, { t: 'orderShift', routeId: route, from: 0.5, delta: 10 }).ok).toBe(false);
  });

  it('moveOrder 自体も、向きが±1でなければ何も変えない(多重防御)', () => {
    const sim = world();
    const { route } = setup(sim);
    const r = sim.transit.routes.get(route)!;
    const before = JSON.stringify(r.orders);
    for (const dir of ['x', 0.5, 1.5, NaN] as unknown as (1 | -1)[]) expect(sim.transit.moveOrder(route, 0, dir).ok).toBe(false);
    expect(sim.transit.moveOrder(route, 0.5, 1).ok).toBe(false);
    expect(JSON.stringify(r.orders)).toBe(before);
  });
});

describe('セキュリティ: 壊れたデータでも世界が止まらない', () => {
  it('路線のオーダーが壊れて1台が失敗しても、その車両だけ取り除かれ、世界は進み続ける', () => {
    const sim = world();
    const { route } = setup(sim);
    const t = sim.transit;
    expect(t.vehicles).toHaveLength(1);
    // 壊れたデータを直接作る(以前の不具合で保存データに残っていた状態)
    const r = t.routes.get(route)!;
    r.orders[0] = null as never;
    r.orders[1] = undefined as never;
    const tick0 = sim.tick;
    expect(() => {
      for (let i = 0; i < 400; i++) sim.step();
    }).not.toThrow();
    expect(sim.tick).toBe(tick0 + 400);
    // 壊れた路線は直され(2つ未満なので取り除かれ)、世界は進み続ける。同じ失敗が何度も繰り返されない
    expect(t.routes.has(route)).toBe(false);
    expect(t.vehicles).toHaveLength(0);
    expect(t.stepFailures + t.vehicleFailures).toBeGreaterThan(0);
    expect(t.stepFailures + t.vehicleFailures).toBeLessThan(5);
  });

  it('壊れた路線が保存データに残っていても、読み込み時に直される(1つ壊れた項目だけ取り除き、残りで運行を続ける)', () => {
    const sim = world();
    const { route, a, b } = setup(sim);
    const t = sim.transit;
    const r = t.routes.get(route)!;
    r.orders.splice(1, 0, null as never); // [a, null, b]
    r.orders.push({ stopId: 99999 } as never); // 存在しない停留所
    expect(t.repair()).toBe(1);
    expect(r.orders.map((o) => o.stopId)).toEqual([a, b]);
    expect(t.repair()).toBe(0); // もう壊れていない
    // 2つ未満になる路線は、車両ごと取り除かれる
    r.orders = [null as never, r.orders[0]];
    expect(t.repair()).toBe(1);
    expect(t.routes.has(route)).toBe(false);
    expect(t.vehicles).toHaveLength(0);
  });
});

describe('セキュリティ: 上限', () => {
  it('路線の複製・共有・種別のコピーも、1社の路線数の上限に数えられる', () => {
    const sim = world();
    const { route } = setup(sim);
    const t = sim.transit;
    // 上限ちょうどまで、直接路線を増やす(コマンドを何百回も送らない)
    const src = t.routes.get(route)!;
    while ([...t.routes.values()].filter((r) => r.owner === 1).length < MAX_ROUTES_PER_PLAYER) {
      const id = t.nextId++;
      t.routes.set(id, { ...src, id, orders: src.orders.map((o) => ({ ...o })) });
    }
    expect(execute(sim, 1, { t: 'routeClone', routeId: route, reverse: false, shiftMin: 5 }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'tx', m: 'shareRoute', a: [route] }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'routeRank', routeId: route, rank: 1, copy: true }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'routeCreate', stops: [src.orders[0].stopId, src.orders[1].stopId] }).ok).toBe(false);
    // 他社は、自分の枠で作れる
    execute(sim, 2, { t: 'build', tool: 'road', a: { x: 90, y: 104 }, b: { x: 120, y: 104 } });
    const a2 = execute(sim, 2, { t: 'ensureStop', x: 92, y: 104, kind: 'road' });
    const b2 = execute(sim, 2, { t: 'ensureStop', x: 118, y: 104, kind: 'road' });
    expect(execute(sim, 2, { t: 'routeCreate', stops: [a2.id!, b2.id!] }).ok).toBe(true);
  });

  it('1つの路線のオーダーは上限まで', () => {
    const sim = world();
    const { route, a } = setup(sim);
    const r = sim.transit.routes.get(route)!;
    while (r.orders.length < MAX_ORDERS_PER_ROUTE) r.orders.push({ ...r.orders[0] });
    const res = execute(sim, 1, { t: 'tx', m: 'insertOrder', a: [route, 0, a] });
    expect(res.ok).toBe(false);
    expect(res.msg).toContain(String(MAX_ORDERS_PER_ROUTE));
  });
});

describe('セキュリティ: 通信の頻度制限', () => {
  it('メッセージの頻度: 上限までは処理し、超えた分は捨て、洪水は切断する。1秒たてば元に戻る', () => {
    let now = 1000;
    const lim = messageLimit(() => now);
    const verdicts = Array.from({ length: MSG_PER_SEC * 3 + 5 }, () => lim());
    expect(verdicts.slice(0, MSG_PER_SEC).every((v) => v === 'ok')).toBe(true);
    expect(verdicts[MSG_PER_SEC]).toBe('drop');
    expect(verdicts[MSG_PER_SEC * 3 - 1]).toBe('drop');
    expect(verdicts[MSG_PER_SEC * 3]).toBe('close');
    now += 1000;
    expect(lim()).toBe('ok'); // 次の1秒は、また受け付ける
  });

  it('重い操作(自動敷設)は、サーバー全体で間隔をあける。かかった時間が長いほど長く待つ', () => {
    let now = 0;
    const g = new Governor(() => now);
    expect(g.busy()).toBe(false);
    g.used(100);
    expect(g.busy()).toBe(true); // 最低 1.5秒
    now = 1499;
    expect(g.busy()).toBe(true);
    now = 1500;
    expect(g.busy()).toBe(false);
    g.used(1000); // 1秒かかった → 3秒待つ
    now += 2999;
    expect(g.busy()).toBe(true);
    now += 1;
    expect(g.busy()).toBe(false);
    expect(isHeavy({ t: 'build', tool: 'railauto' })).toBe(true);
    expect(isHeavy({ t: 'build', tool: 'road' })).toBe(false);
    expect(isHeavy({ t: 'place' })).toBe(false);
    expect(isHeavy(null)).toBe(false);
    expect(isHeavy('x')).toBe(false);
  });

  it('視界の更新: 1フレームに新しく送るチャンクは上限があり、残りは次のフレームで送る', () => {
    const sim = world();
    const repl = new Replicator(sim, new Accounts('/tmp/none-' + Math.random() + '.json'));
    const sent: { type: string }[] = [];
    const c = repl.newClient({ readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) } as never, 1, 'a');
    repl.setView(c, 0, 0, 127, 127); // 128x128 タイル(チャンクの大きさによって数が決まる)
    repl.frame([c]);
    const first = sent.filter((m) => m.type === 'chunk').length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(24);
    for (let i = 0; i < 40; i++) repl.frame([c]);
    const all = sent.filter((m) => m.type === 'chunk').length;
    expect(all).toBeGreaterThanOrEqual(first); // 残りは次のフレーム以降に送られる(重複はしない)
    const keys = sent.filter((m) => m.type === 'chunk').map((m) => `${(m as unknown as { cx: number }).cx},${(m as unknown as { cy: number }).cy}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('セキュリティ: コマンドの総当たり(型の崩れ)で例外が出ない', () => {
  it('実在する路線・停留所・車両に、小数・文字列・null・巨大な値・配列を1つずつ入れても、サーバーエラーにならず、世界が壊れない', () => {
    const sim = world();
    const { route, a, b } = setup(sim);
    const veh = sim.transit.vehicles[0].id;
    const shapes: Cmd[] = [
      { t: 'tx', m: 'moveOrder', a: [route, 0, 1] },
      { t: 'tx', m: 'insertOrder', a: [route, 0, a] },
      { t: 'tx', m: 'removeOrder', a: [route, 0] },
      { t: 'tx', m: 'autoTimetable', a: [route, 0] },
      { t: 'tx', m: 'departHeld', a: [veh] },
      { t: 'orderShift', routeId: route, from: 0, delta: 10 },
      { t: 'orderSet', routeId: route, index: 0, patch: { kind: 'dwell', pass: false, dwell: 10, maxWait: 10, departTod: 0 } },
      { t: 'routeSet', routeId: route, patch: { name: 'x', period: 1000, fareMul: 1.2 } },
      { t: 'routeBulk', routeId: route, intervalMin: 10, firstMin: 0 },
      { t: 'routeRank', routeId: route, rank: 1, copy: false },
      { t: 'vehOffset', id: veh, offset: 100 },
      { t: 'vehPlan', id: veh },
      { t: 'rename', kind: 'stop', id: a, name: 'n' },
      { t: 'develop', stopId: b },
      { t: 'signalLine', a: { x: 90, y: 100 }, b: { x: 120, y: 100 }, interval: 3 },
    ];
    const WEIRD = [null, '', 'x', -1, 0, 0.5, 1.5, 1e308, -1e308, 2 ** 53, [], [1, 2], {}, true, 'a'.repeat(60)];
    const leaves = (o: unknown, path: (string | number)[] = []): (string | number)[][] =>
      o && typeof o === 'object' ? Object.entries(o as object).flatMap(([k, v]) => leaves(v, [...path, Array.isArray(o) ? Number(k) : k])) : [path];
    const setAt = (o: unknown, path: (string | number)[], v: unknown) => {
      const c = JSON.parse(JSON.stringify(o));
      let t = c;
      for (let i = 0; i < path.length - 1; i++) t = t[path[i]];
      t[path.at(-1)!] = v;
      return c;
    };
    let exceptions = 0;
    for (const shape of shapes) {
      for (const path of leaves(shape).filter((p) => p.join('.') !== 't')) {
        for (const v of WEIRD) {
          const r = execute(sim, 1, setAt(shape, path, v) as Cmd);
          if (r.msg === 'サーバーエラー') exceptions++;
        }
      }
    }
    expect(exceptions).toBe(0);
    // 壊れた状態が残っていない: 路線のオーダーは全て正常で、世界は進む
    for (const r of sim.transit.routes.values()) expect(r.orders.every((o) => o && typeof o === 'object')).toBe(true);
    expect(() => {
      for (let i = 0; i < 300; i++) sim.step();
    }).not.toThrow();
    expect(sim.transit.vehicleFailures).toBe(0);
  });
});
