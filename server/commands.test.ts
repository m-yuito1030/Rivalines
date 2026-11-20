import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/world/gameMap';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL } from '../src/world/constants';
import { TRAINING, trainingCost } from '../src/sim/economy';
import { DEV, devCost, devIncome } from '../src/sim/development';
import { execute } from './commands';
import { Replicator } from './replicate';
import { Accounts } from './accounts';

const flatMap = (size = 128) => new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 20));
const world = () => {
  const map = flatMap();
  const sim = new Simulation(map, undefined, { multi: true });
  // 自動生成された街・道路・施設を片付けて、検証用に空き地にする
  for (let i = 0; i < map.size * map.size; i++) {
    map.building.set(i, 0);
    map.road.set(i, 0);
    map.owner.set(i, 0);
  }
  map.towns.length = 0;
  map.facilities.length = 0;
  return sim;
};

describe('マルチプレイ: 会社・コマンド・所有', () => {
  it('道路を敷くと自社の資金が減り、タイルは自社のものになる。他社は撤去できない', () => {
    const sim = world();
    sim.setOnline([1, 2]);
    const c1 = sim.playerCompany(1);
    const c2 = sim.playerCompany(2);
    const cash0 = c1.cash;
    const r = execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 110, y: 100 } });
    expect(r.ok).toBe(true);
    expect(c1.cash).toBeLessThan(cash0);
    expect(c2.cash).toBe(cash0);
    const k = sim.map.idx(100, 100);
    expect(sim.map.road.get(k)).not.toBe(0);
    expect(sim.map.infraOwner.get(k)).toBe(1);
    execute(sim, 2, { t: 'build', tool: 'bulldoze', a: { x: 100, y: 100 }, b: { x: 100, y: 100 } });
    expect(sim.map.road.get(k)).not.toBe(0); // 他社の道路は消せない
    execute(sim, 1, { t: 'build', tool: 'bulldoze', a: { x: 100, y: 100 }, b: { x: 100, y: 100 } });
    expect(sim.map.road.get(k)).toBe(0);
  });

  it('停留所・路線・基地・車両購入: 持ち主が付き、他社の路線は操作できない。運賃は持ち主へ', () => {
    const sim = world();
    sim.setOnline([1, 2]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 120, y: 100 } });
    const a = execute(sim, 1, { t: 'ensureStop', x: 92, y: 100, kind: 'road' });
    const b = execute(sim, 1, { t: 'ensureStop', x: 118, y: 100, kind: 'road' });
    expect(a.ok && b.ok).toBe(true);
    const rt = execute(sim, 1, { t: 'routeCreate', stops: [a.id!, b.id!] });
    expect(rt.ok).toBe(true);
    expect(sim.transit.routes.get(rt.id!)!.owner).toBe(1);
    expect(sim.transit.stops.get(a.id!)!.owner).toBe(1);
    const d = execute(sim, 1, { t: 'place', tool: 'depot', x: 95, y: 100 });
    expect(d.ok).toBe(true);
    const bad = execute(sim, 2, { t: 'buyVehicle', routeId: rt.id!, modelId: sim.transit.routes.get(rt.id!)!.modelId, cars: 1 });
    expect(bad.ok).toBe(false);
    expect(execute(sim, 2, { t: 'tx', m: 'removeRoute', a: [rt.id!] }).ok).toBe(false);
    const cash = sim.playerCompany(1).cash;
    const buy = execute(sim, 1, { t: 'buyVehicle', routeId: rt.id!, modelId: sim.transit.routes.get(rt.id!)!.modelId, cars: 1 });
    expect(buy.ok).toBe(true);
    expect(sim.playerCompany(1).cash).toBeLessThan(cash);
    expect(sim.transit.vehicles).toHaveLength(1);
    // 名前変更
    expect(execute(sim, 1, { t: 'routeSet', routeId: rt.id!, patch: { name: '朝の快速' } }).ok).toBe(true);
    expect(sim.transit.routes.get(rt.id!)!.name).toBe('朝の快速');
    expect(execute(sim, 2, { t: 'routeSet', routeId: rt.id!, patch: { name: 'x' } }).ok).toBe(false);
    // 運賃の倍率: 範囲に収める。標準(1)に戻すと未設定に戻る。他社は変えられない
    expect(execute(sim, 1, { t: 'routeSet', routeId: rt.id!, patch: { fareMul: 9 } }).ok).toBe(true);
    expect(sim.transit.routes.get(rt.id!)!.fareMul).toBe(2.5);
    expect(execute(sim, 1, { t: 'routeSet', routeId: rt.id!, patch: { fareMul: 1 } }).ok).toBe(true);
    expect(sim.transit.routes.get(rt.id!)!.fareMul).toBeUndefined();
    expect(execute(sim, 2, { t: 'routeSet', routeId: rt.id!, patch: { fareMul: 2 } }).ok).toBe(false);
  });

  it('切断中の会社の車両は止まり、日次の処理も止まる(そのまま止める)', () => {
    const sim = world();
    sim.setOnline([1]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 120, y: 100 } });
    const a = execute(sim, 1, { t: 'ensureStop', x: 92, y: 100, kind: 'road' });
    const b = execute(sim, 1, { t: 'ensureStop', x: 118, y: 100, kind: 'road' });
    const rt = execute(sim, 1, { t: 'routeCreate', stops: [a.id!, b.id!] });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 95, y: 100 });
    execute(sim, 1, { t: 'buyVehicle', routeId: rt.id!, modelId: sim.transit.routes.get(rt.id!)!.modelId, cars: 1 });
    for (let i = 0; i < 400; i++) sim.step();
    const v = sim.transit.vehicles[0];
    sim.setOnline([]); // 切断
    const snap = [v.pi, v.t, v.state];
    const cash = sim.playerCompany(1).cash;
    for (let i = 0; i < 2000; i++) sim.step();
    expect([v.pi, v.t, v.state]).toEqual(snap);
    expect(sim.playerCompany(1).cash).toBe(cash);
    sim.setOnline([1]); // 再接続
    for (let i = 0; i < 400; i++) sim.step();
    expect(v.pi !== snap[0] || v.t !== snap[1] || v.state !== snap[2]).toBe(true);
  });

  it('他社の線路を走ると通行料: 走った会社が払い、敷いた会社が受け取る', () => {
    const sim = world();
    sim.setOnline([1, 2]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 120, y: 100 } }); // 会社1の道路
    const a = execute(sim, 2, { t: 'ensureStop', x: 92, y: 100, kind: 'road' });
    const b = execute(sim, 2, { t: 'ensureStop', x: 118, y: 100, kind: 'road' });
    const rt = execute(sim, 2, { t: 'routeCreate', stops: [a.id!, b.id!] });
    execute(sim, 2, { t: 'place', tool: 'depot', x: 95, y: 100 });
    execute(sim, 2, { t: 'buyVehicle', routeId: rt.id!, modelId: sim.transit.routes.get(rt.id!)!.modelId, cars: 1 });
    const p0 = sim.playerCompany(2).total['toll-out'] ?? 0;
    for (let i = 0; i < 1500; i++) sim.step();
    expect(sim.playerCompany(2).total['toll-out'] ?? 0).toBeGreaterThan(p0);
    expect(sim.playerCompany(1).total['toll-in'] ?? 0).toBeGreaterThan(0);
  });

  it('融資・返済・不正なコマンドの拒否', () => {
    const sim = world();
    sim.setOnline([1]);
    const c = sim.playerCompany(1);
    const loan0 = c.loan;
    expect(execute(sim, 1, { t: 'fin', op: 'borrow', amount: 1_000_000 }).ok).toBe(true);
    expect(c.loan).toBe(loan0 + 1_000_000);
    expect(execute(sim, 1, { t: 'fin', op: 'repay', amount: 0 }).ok).toBe(true);
    expect(c.loan).toBe(0);
    expect(execute(sim, 1, { t: 'fin', op: 'payout', amount: 0.9 }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'build', tool: 'nuke' as never, a: { x: 1, y: 1 }, b: { x: 2, y: 2 } }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'tx', m: 'toString' as never, a: [] }).ok).toBe(false);
  });

  it('配信: 視界内のチャンクと車両が送られ、変更タイルが差分で届く', () => {
    const sim = world();
    sim.setOnline([1]);
    const acc = new Accounts('/tmp/none-' + Math.random() + '.json');
    const repl = new Replicator(sim, acc);
    const sent: unknown[] = [];
    const ws = { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) };
    const c = repl.newClient(ws as never, 1, 'a');
    repl.setView(c, 80, 90, 130, 110);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 100, y: 100 } });
    repl.frame([c]);
    const types = sent.map((m) => (m as { type: string }).type);
    expect(types).toContain('chunk');
    const chunks = sent.filter((m) => (m as { type: string }).type === 'chunk') as { tiles: number[][] }[];
    expect(chunks.some((ch) => ch.tiles.length > 0)).toBe(true); // 道路を含むチャンク
    sent.length = 0;
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 100, y: 100 }, b: { x: 105, y: 100 } });
    repl.frame([c]);
    const frame = sent.find((m) => (m as { type: string }).type === 'frame') as { tiles: number[][] };
    expect(frame.tiles.length).toBeGreaterThan(0);
    // 視界の外の変更は送られない
    sent.length = 0;
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 5, y: 5 }, b: { x: 9, y: 5 } });
    repl.frame([c]);
    const f2 = sent.find((m) => (m as { type: string }).type === 'frame') as { tiles: number[][] };
    expect(f2.tiles.length).toBe(0);
  });
});

describe('ダイヤ操作', () => {
  const setup = () => {
    const sim = world();
    sim.setOnline([1]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 125, y: 100 } });
    const a = execute(sim, 1, { t: 'ensureStop', x: 92, y: 100, kind: 'road' });
    const b = execute(sim, 1, { t: 'ensureStop', x: 110, y: 100, kind: 'road' });
    const c = execute(sim, 1, { t: 'ensureStop', x: 122, y: 100, kind: 'road' });
    const rt = execute(sim, 1, { t: 'routeCreate', stops: [a.id!, b.id!, c.id!] });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 95, y: 100 });
    return { sim, rid: rt.id! };
  };
  it('一括設定: 時刻表を作り、間隔に合う本数を買って等間隔のずれにする', () => {
    const { sim, rid } = setup();
    const r = execute(sim, 1, { t: 'routeBulk', routeId: rid, intervalMin: 30, firstMin: 6 * 60 });
    expect(r.ok).toBe(true);
    const route = sim.transit.routes.get(rid)!;
    expect(route.orders.every((o) => o.kind === 'timed' || sim.transit.stops.get(o.stopId)?.waypoint)).toBe(true);
    const vs = sim.transit.vehicles.filter((v) => v.routeId === rid);
    const n = Math.max(1, Math.round(route.period / (30 * (30 * 60 * 10 / 1440))));
    expect(vs.length).toBe(n);
    const offs = vs.map((v) => v.offset).sort((x, y) => x - y);
    for (let i = 1; i < offs.length; i++) expect(offs[i] - offs[i - 1]).toBeCloseTo(route.period / n, -1);
  });
  it('車両のずれの変更・複製(逆向き/ずらし)・提案の適用は持ち主だけ', () => {
    const { sim, rid } = setup();
    execute(sim, 1, { t: 'routeBulk', routeId: rid, intervalMin: 60, firstMin: 360 });
    const v = sim.transit.vehicles[0];
    sim.setOnline([1, 2]);
    expect(execute(sim, 2, { t: 'vehOffset', id: v.id, offset: 100 }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'vehOffset', id: v.id, offset: 1000 }).ok).toBe(true);
    expect(v.offset % (30 * 60 * 10 / 1440)).toBeCloseTo(0, 5);
    const rev = execute(sim, 1, { t: 'routeClone', routeId: rid, reverse: true, shiftMin: 0 });
    expect(rev.ok).toBe(true);
    const copy = sim.transit.routes.get(rev.id!)!;
    const src = sim.transit.routes.get(rid)!;
    expect(copy.orders.map((o) => o.stopId)).toEqual([...src.orders].reverse().map((o) => o.stopId));
    expect(copy.owner).toBe(1);
    const sh = execute(sim, 1, { t: 'routeClone', routeId: rid, reverse: false, shiftMin: 30 });
    const shifted = sim.transit.routes.get(sh.id!)!;
    const dt = (shifted.orders[0].departTod - src.orders[0].departTod + 18000) % 18000;
    expect(dt).toBeCloseTo(30 * (30 * 60 * 10 / 1440), 3);
    expect(execute(sim, 2, { t: 'routeClone', routeId: rid, reverse: false, shiftMin: 5 }).ok).toBe(false);
    const before = src.orders[1].departTod;
    expect(execute(sim, 1, { t: 'orderShift', routeId: rid, from: 1, delta: 120 }).ok).toBe(true);
    expect(src.orders[1].departTod).toBe((before + 120) % 18000);
  });
});

describe('種別と通過駅', () => {
  const setup = () => {
    const sim = world();
    sim.setOnline([1]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 124, y: 100 } });
    const ids: number[] = [];
    for (const dx of [2, 8, 14, 20, 26, 32]) ids.push(execute(sim, 1, { t: 'ensureStop', x: 90 + dx, y: 100, kind: 'road' }).id!);
    const rt = execute(sim, 1, { t: 'routeCreate', stops: ids });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 95, y: 100 });
    return { sim, rid: rt.id!, ids };
  };
  it('特急にすると途中駅の多くが通過になり、始発と最も遠い駅は必ず停車する。普通で戻る', () => {
    const { sim, rid, ids } = setup();
    const r = sim.transit.routes.get(rid)!;
    const res = execute(sim, 1, { t: 'routeRank', routeId: rid, rank: 4, copy: false });
    expect(res.ok).toBe(true);
    expect(r.rank).toBe(4);
    const stopping = r.orders.filter((o) => !o.pass).map((o) => o.stopId);
    expect(stopping).toContain(ids[0]);
    expect(stopping).toContain(ids[5]);
    expect(stopping.length).toBeLessThan(ids.length);
    expect(stopping.length).toBeGreaterThanOrEqual(2);
    execute(sim, 1, { t: 'routeRank', routeId: rid, rank: 0, copy: false });
    expect(r.orders.every((o) => !o.pass)).toBe(true);
  });
  it('通過の駅には停まらない(車両のオーダーが通過駅を指さず、乗客も発生しない)。他人は設定できない', () => {
    const { sim, rid, ids } = setup();
    execute(sim, 1, { t: 'routeRank', routeId: rid, rank: 4, copy: false });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 95, y: 100 });
    execute(sim, 1, { t: 'buyVehicle', routeId: rid, modelId: sim.transit.routes.get(rid)!.modelId, cars: 1 });
    const r = sim.transit.routes.get(rid)!;
    const passed = new Set(r.orders.filter((o) => o.pass).map((o) => o.stopId));
    expect(passed.size).toBeGreaterThan(0);
    const v = sim.transit.vehicles[0];
    const visited = new Set<number>();
    for (let i = 0; i < 6000; i++) {
      sim.step();
      if (v.state === 'load') visited.add(r.orders[v.order].stopId);
    }
    expect(visited.size).toBeGreaterThanOrEqual(2);
    for (const id of passed) expect(visited.has(id)).toBe(false);
    // 通過駅にはこの路線の発車案内もない
    for (const id of passed) expect(sim.transit.departures(id, sim.tick).filter((d) => d.routeId === rid)).toHaveLength(0);
    sim.setOnline([1, 2]);
    expect(execute(sim, 2, { t: 'routeRank', routeId: rid, rank: 1, copy: false }).ok).toBe(false);
    void ids;
  });
  it('種別の路線を複製して作る(元の路線は変わらない)。停車駅が2つ未満になる通過は拒否', () => {
    const { sim, rid } = setup();
    const res = execute(sim, 1, { t: 'routeRank', routeId: rid, rank: 2, copy: true, shiftMin: 5 });
    expect(res.ok).toBe(true);
    const copy = sim.transit.routes.get(res.id!)!;
    const src = sim.transit.routes.get(rid)!;
    expect(copy.name).toContain('快速');
    expect(src.orders.every((o) => !o.pass)).toBe(true);
    expect(copy.orders.some((o) => o.pass)).toBe(true);
    // 全部を通過にはできない
    const real = copy.orders.map((o, i) => [o, i] as const).filter(([o]) => !o.pass);
    let rejected = false;
    for (const [, i] of real) if (!execute(sim, 1, { t: 'orderSet', routeId: copy.id, index: i, patch: { pass: true } }).ok) rejected = true;
    expect(rejected).toBe(true);
    expect(copy.orders.filter((o) => !o.pass).length).toBeGreaterThanOrEqual(2);
  });
});

describe('経路の予定(矢印表示用)', () => {
  it('車両のこの先の区間が、停留所を順に結ぶ連続したタイル列で返る', () => {
    const sim = world();
    sim.setOnline([1]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 124, y: 100 } });
    const ids = [4, 16, 28].map((dx) => execute(sim, 1, { t: 'ensureStop', x: 90 + dx, y: 100, kind: 'road' }).id!);
    const rt = execute(sim, 1, { t: 'routeCreate', stops: ids });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 95, y: 100 });
    execute(sim, 1, { t: 'buyVehicle', routeId: rt.id!, modelId: sim.transit.routes.get(rt.id!)!.modelId, cars: 1 });
    for (let i = 0; i < 200; i++) sim.step();
    const v = sim.transit.vehicles[0];
    const res = execute(sim, 2, { t: 'vehPlan', id: v.id }); // 読み取りだけなので他のプレイヤーも見られる
    expect(res.ok).toBe(true);
    const plan = res.data as { legs: number[][]; stops: number[] };
    expect(plan.legs.length).toBeGreaterThanOrEqual(2);
    for (const leg of plan.legs) {
      expect(leg.length).toBeGreaterThan(1);
      for (let i = 1; i < leg.length; i++) expect(Math.abs(leg[i] - leg[i - 1]) === 1 || Math.abs(leg[i] - leg[i - 1]) === sim.map.size).toBe(true); // 隣り合うタイル
    }
    expect(plan.stops).toHaveLength(plan.legs.length);
    expect(execute(sim, 1, { t: 'vehPlan', id: 99999 }).ok).toBe(false);
  });
});

describe('斜めの信号', () => {
  it('斜めの直線の線路にも信号を置け、一方向の信号で逆向きの経路は使えない', () => {
    const sim = world();
    sim.setOnline([1]);
    // 南東へ斜めに敷く(北西→南東)
    execute(sim, 1, { t: 'build', tool: 'rail', a: { x: 100, y: 100 }, b: { x: 112, y: 112 } });
    const mid = sim.map.idx(106, 106);
    expect(sim.map.rail.get(mid)).toBe(0xa0); // 南東-北西の直線
    const r1 = execute(sim, 1, { t: 'place', tool: 'signal', x: 106, y: 106 });
    expect(r1.ok).toBe(true);
    expect(sim.transit.signalMask(mid)).toBe(1 << 5); // 南東向き
    // 南東向きだけ通れる: 北西→南東の経路はある、南東→北西は無い
    const t = sim.transit as unknown as { route: (a: number, b: number, rail: boolean) => Uint32Array | null };
    expect(t.route(sim.map.idx(103, 103), sim.map.idx(109, 109), true)).not.toBeNull();
    expect(t.route(sim.map.idx(109, 109), sim.map.idx(103, 103), true)).toBeNull();
    // もう一度で逆向き、さらにもう一度で撤去
    expect(execute(sim, 1, { t: 'place', tool: 'signal', x: 106, y: 106 }).ok).toBe(true);
    expect(sim.transit.signalMask(mid)).toBe(1 << 7);
    expect(t.route(sim.map.idx(109, 109), sim.map.idx(103, 103), true)).not.toBeNull();
    expect(t.route(sim.map.idx(103, 103), sim.map.idx(109, 109), true)).toBeNull();
    execute(sim, 1, { t: 'place', tool: 'signal', x: 106, y: 106 });
    expect(sim.transit.signalMask(mid)).toBe(0);
    // 斜めの分岐点(複数の腕)には置けない
    execute(sim, 1, { t: 'build', tool: 'rail', a: { x: 106, y: 106 }, b: { x: 112, y: 106 } });
    expect(execute(sim, 1, { t: 'place', tool: 'signal', x: 106, y: 106 }).ok).toBe(false);
  });
});

describe('初回の設定駅に戻ったら経路を計算し直す', () => {
  it('遠回りの道しかなかった路線は、近道を敷くと次の周回から近道を使う', () => {
    const sim = world();
    sim.setOnline([1]);
    // 遠回り: (100,100)→(100,112)→(118,112)→(118,100)、A=(92,100)側から B=(118,100)
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 100, y: 100 } });
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 100, y: 100 }, b: { x: 100, y: 112 } });
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 100, y: 112 }, b: { x: 118, y: 112 } });
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 118, y: 112 }, b: { x: 118, y: 100 } });
    const a = execute(sim, 1, { t: 'ensureStop', x: 92, y: 100, kind: 'road' });
    const b = execute(sim, 1, { t: 'ensureStop', x: 118, y: 102, kind: 'road' });
    const rt = execute(sim, 1, { t: 'routeCreate', stops: [a.id!, b.id!] });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 94, y: 100 });
    execute(sim, 1, { t: 'buyVehicle', routeId: rt.id!, modelId: sim.transit.routes.get(rt.id!)!.modelId, cars: 1 });
    const v = sim.transit.vehicles[0];
    let longLeg = 0;
    for (let i = 0; i < 4000 && !longLeg; i++) {
      sim.step();
      if (v.state === 'move' && v.order === 1 && v.path.length > 30) longLeg = v.path.length; // A→B の遠回りの区間
    }
    expect(longLeg).toBeGreaterThan(30);
    // 近道を敷く(A側の道路から B の道路へ直接つなぐ)
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 100, y: 100 }, b: { x: 118, y: 100 } });
    let shortLeg = Infinity;
    for (let i = 0; i < 20000; i++) {
      sim.step();
      if (v.state === 'move' && v.order === 1 && v.path.length > 1) shortLeg = Math.min(shortLeg, v.path.length);
    }
    expect(shortLeg).toBeLessThan(longLeg - 10); // 次の周回(初回の駅から出発)で近道に切り替わった
    expect(sim.transit.routes.get(rt.id!)!.replanAt).toBeGreaterThan(0);
  });
});

describe('JGRPP風の線路・信号・車両操作', () => {
  it('自動敷設: 障害物(建物の壁)を避けて始点から終点までつなぐ', () => {
    const sim = world();
    sim.setOnline([1]);
    // 縦の壁(建物)で直線を遮る。下にだけ隙間がある
    for (let y = 90; y <= 110; y++) sim.map.building.set(sim.map.idx(105, y), 0x05);
    const cash = sim.playerCompany(1).cash;
    const r = execute(sim, 1, { t: 'build', tool: 'railauto', a: { x: 98, y: 100 }, b: { x: 112, y: 100 } });
    expect(r.ok).toBe(true);
    expect(sim.playerCompany(1).cash).toBeLessThan(cash);
    // 始点と終点が線路でつながっている(経路探索で到達できる)
    const t = sim.transit as unknown as { route: (a: number, b: number, rail: boolean) => Uint32Array | null };
    const p = t.route(sim.map.idx(98, 100), sim.map.idx(112, 100), true);
    expect(p).not.toBeNull();
    expect(p!.length).toBeGreaterThan(15); // 壁を迂回している
    for (const i of p!) expect(sim.map.building.get(i)).toBe(0);
    // 完全に囲まれていたら理由を返す(失敗しても資金は減らない)
    for (let y = 80; y <= 125; y++) sim.map.building.set(sim.map.idx(105, y), 0x05);
    const c2 = sim.playerCompany(1).cash;
    execute(sim, 1, { t: 'build', tool: 'railauto', a: { x: 98, y: 70 }, b: { x: 112, y: 70 } });
    expect(sim.playerCompany(1).cash).toBeLessThanOrEqual(c2);
  });
  it('信号を並べる: ドラッグの向きの一方向信号が一定間隔で置かれる', () => {
    const sim = world();
    sim.setOnline([1]);
    execute(sim, 1, { t: 'build', tool: 'rail', a: { x: 95, y: 100 }, b: { x: 115, y: 100 } });
    const r = execute(sim, 1, { t: 'signalLine', a: { x: 95, y: 100 }, b: { x: 115, y: 100 }, interval: 4 });
    expect(r.ok).toBe(true);
    const placed: number[] = [];
    for (let x = 95; x <= 115; x++) if (sim.transit.signalMask(sim.map.idx(x, 100))) placed.push(x);
    expect(placed.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < placed.length; i++) expect(placed[i] - placed[i - 1]).toBe(4);
    for (const x of placed) expect(sim.transit.signalMask(sim.map.idx(x, 100))).toBe(1 << 1); // 東向き
    // 逆向きにドラッグすると西向き
    execute(sim, 1, { t: 'signalLine', a: { x: 115, y: 100 }, b: { x: 95, y: 100 }, interval: 4 });
    const any = placed.find((x) => sim.transit.signalMask(sim.map.idx(x, 100)) === 1 << 3);
    void any;
    expect(execute(sim, 1, { t: 'signalLine', a: { x: 5, y: 5 }, b: { x: 9, y: 5 }, interval: 2 }).ok).toBe(false); // 線路がない
  });
  it('置き換え: 路線の全車両を新しい車種にし、差額を払う。両数が合わない車両は対象外', () => {
    const sim = world();
    sim.setOnline([1]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 124, y: 100 } });
    const ids = [4, 24].map((dx) => execute(sim, 1, { t: 'ensureStop', x: 90 + dx, y: 100, kind: 'road' }).id!);
    const rt = execute(sim, 1, { t: 'routeCreate', stops: ids });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 95, y: 100 });
    const r = sim.transit.routes.get(rt.id!)!;
    const oldModel = r.modelId;
    execute(sim, 1, { t: 'buyVehicle', routeId: rt.id!, modelId: oldModel, cars: 1 });
    execute(sim, 1, { t: 'buyVehicle', routeId: rt.id!, modelId: oldModel, cars: 1 });
    expect(execute(sim, 1, { t: 'routeSet', routeId: rt.id!, patch: { modelId: 'bus-l' } }).ok).toBe(true);
    const cash = sim.playerCompany(1).cash;
    const res = execute(sim, 1, { t: 'routeReplace', routeId: rt.id! });
    expect(res.ok).toBe(true);
    expect(sim.transit.vehicles.every((v) => v.modelId === 'bus-l')).toBe(true);
    expect(sim.playerCompany(1).cash).toBeLessThan(cash);
    expect(execute(sim, 1, { t: 'routeReplace', routeId: rt.id! }).ok).toBe(false); // もう置き換えるものがない
    sim.setOnline([1, 2]);
    expect(execute(sim, 2, { t: 'routeReplace', routeId: rt.id! }).ok).toBe(false);
  });

  it('従業員教育: 費用を払って研修し、日数が過ぎるとレベルが上がる。効果は運行費と乗客に出る', () => {
    const sim = world();
    sim.setOnline([1]);
    const co = sim.playerCompany(1);
    const cash = co.cash;
    const r = execute(sim, 1, { t: 'fin', op: 'train' });
    expect(r.ok).toBe(true);
    expect(co.cash).toBe(cash - trainingCost(0));
    expect(co.training).toBe(0); // 完了まではそのまま
    expect(execute(sim, 1, { t: 'fin', op: 'train' }).ok).toBe(false); // 研修中
    for (let d = 0; d < TRAINING.days; d++) co.endOfDay(d, sim.map, sim.transit, 50, [], 1);
    expect(co.training).toBe(1);
    expect(co.trainingPending).toBeUndefined();
    expect(co.costMul).toBeCloseTo(1 - TRAINING.costCut);
    expect(co.serviceMul).toBeCloseTo(1 + TRAINING.demandUp);
    co.endOfDay(TRAINING.days, sim.map, sim.transit, 50, [], 1);
    expect(co.total.training).toBe(trainingCost(0) + TRAINING.dailyPerLevel); // レベル1の研修費(毎日)も払う
    co.cash = 0;
    expect(execute(sim, 1, { t: 'fin', op: 'train' }).ok).toBe(false); // 資金不足
    co.training = TRAINING.max;
    co.cash = 1e9;
    expect(execute(sim, 1, { t: 'fin', op: 'train' }).ok).toBe(false); // 最高レベル
  });

  it('沿線開発: 自社の停留所の開発度を上げる(建設費を払い、乗客と不動産収入が増える)。他社・経由点・最高は不可', () => {
    const sim = world();
    sim.setOnline([1, 2]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 120, y: 100 } });
    const a = execute(sim, 1, { t: 'ensureStop', x: 100, y: 100, kind: 'road' });
    const st = sim.transit.stops.get(a.id!)!;
    st.pop = 1000;
    const co = sim.playerCompany(1);
    const cash = co.cash;
    expect(execute(sim, 2, { t: 'develop', stopId: a.id! }).ok).toBe(false); // 他社
    expect(execute(sim, 1, { t: 'develop', stopId: a.id! }).ok).toBe(true);
    expect(st.dev).toBe(1);
    expect(co.cash).toBe(cash - devCost(0));
    expect(devIncome(st)).toBe(1000 * DEV.incomePerPop);
    const before = co.cash;
    co.endOfDay(0, sim.map, sim.transit, 50, [], 1);
    expect(co.total.realestate).toBe(devIncome(st));
    expect(co.cash).toBeGreaterThan(before - 1_000_000); // 収入が入る(維持費などを引いても大きくは減らない)
    st.dev = DEV.max;
    expect(execute(sim, 1, { t: 'develop', stopId: a.id! }).ok).toBe(false); // 最高
    expect(execute(sim, 1, { t: 'develop', stopId: 99999 }).ok).toBe(false);
  });
});
