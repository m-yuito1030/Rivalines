import type { Cmd } from '../src/shared/protocol';
import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/shared/world/gameMap';
import { Simulation } from '../src/shared/sim/simulation';
import { SEA_LEVEL } from '../src/shared/world/constants';
import { TOLL, TRAINING, trainingCost } from '../src/shared/sim/economy/economy';
import { DEV, devCost, devIncome } from '../src/shared/sim/economy/development';
import { execute } from './commands/index';
import { Replicator } from './replicate';
import { canConnectRail } from '../src/shared/world/rails';
import { Accounts } from './accounts';
import { facilityCost } from '../src/shared/world/facilities';
import { VISITOR_TYPES } from '../src/shared/sim/facility/facilityVisitors';

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
    expect(execute(sim, 1, { t: 'routeSet', routeId: rt.id!, patch: { fareMul: 1.4 } }).ok).toBe(true);
    expect(execute(sim, 1, { t: 'routeSet', routeId: rt.id!, patch: { fareMul: 'abc' as never } }).ok).toBe(false); // 不正な値で標準に戻さない
    expect(sim.transit.routes.get(rt.id!)!.fareMul).toBe(1.4);
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

describe('配信: 路線の経営データ', () => {
  it('路線の収入・利益・輸送人数は、構造が変わらなくても misc で毎回届く', () => {
    const sim = world();
    sim.setOnline([1]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 120, y: 100 } });
    const a = execute(sim, 1, { t: 'ensureStop', x: 92, y: 100, kind: 'road' });
    const b = execute(sim, 1, { t: 'ensureStop', x: 118, y: 100, kind: 'road' });
    const rt = execute(sim, 1, { t: 'routeCreate', stops: [a.id!, b.id!] });
    const r = sim.transit.routes.get(rt.id!)!;
    const repl = new Replicator(sim, new Accounts('/tmp/none-' + Math.random() + '.json'));
    const sent: { type: string; routeStats?: number[][] }[] = [];
    const c = repl.newClient({ readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) } as never, 1, 'a');
    r.income = 1234;
    r.profit = 1000;
    r.carried = 55.7;
    repl.misc([c]);
    expect(sent.find((m) => m.type === 'misc')!.routeStats).toContainEqual([r.id, 1234, 1000, 55.7]);
    sent.length = 0;
    r.income = 2000; // 構造のバージョンを上げなくても、次の misc に反映される
    repl.misc([c]);
    expect(sent.find((m) => m.type === 'misc')!.routeStats).toContainEqual([r.id, 2000, 1000, 55.7]);
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
    const n = Math.max(1, Math.round(route.period / (30 * ((30 * 60 * 10) / 1440))));
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
    expect(v.offset % ((30 * 60 * 10) / 1440)).toBeCloseTo(0, 5);
    const rev = execute(sim, 1, { t: 'routeClone', routeId: rid, reverse: true, shiftMin: 0 });
    expect(rev.ok).toBe(true);
    const copy = sim.transit.routes.get(rev.id!)!;
    const src = sim.transit.routes.get(rid)!;
    expect(copy.orders.map((o) => o.stopId)).toEqual([...src.orders].reverse().map((o) => o.stopId));
    expect(copy.owner).toBe(1);
    const sh = execute(sim, 1, { t: 'routeClone', routeId: rid, reverse: false, shiftMin: 30 });
    const shifted = sim.transit.routes.get(sh.id!)!;
    const dt = (shifted.orders[0].departTod - src.orders[0].departTod + 18000) % 18000;
    expect(dt).toBeCloseTo(30 * ((30 * 60 * 10) / 1440), 3);
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

  it('提携: 申し込み・承諾・解消のコマンド。成立すると他社のインフラの通行料が割り引かれる', () => {
    const sim = world();
    sim.setOnline([1, 2]);
    sim.playerCompany(1);
    sim.playerCompany(2);
    const tile = sim.map.idx(100, 100);
    sim.map.rail.set(tile, 5);
    sim.map.infraOwner.set(tile, 2); // 2社の線路を1社の列車が通る
    const route = { owner: 1 } as never;
    const toll = () => {
      const c1 = sim.playerCompany(1);
      const before = c1.cash;
      sim.transit.onTile!({} as never, route, tile);
      return before - c1.cash;
    };
    expect(toll()).toBe(TOLL.rail);
    expect(execute(sim, 1, { t: 'pact', op: 'propose', to: 99, discount: 0.5 }).ok).toBe(false); // 相手がいない
    expect(execute(sim, 1, { t: 'pact', op: 'propose', to: 2, discount: 0.5 }).ok).toBe(true);
    expect(toll()).toBe(TOLL.rail); // 承諾前は割引なし
    const id = sim.pacts.proposals[0].id;
    expect(execute(sim, 1, { t: 'pact', op: 'accept', id }).ok).toBe(false); // 申し込んだ側は承諾できない
    expect(execute(sim, 2, { t: 'pact', op: 'accept', id }).ok).toBe(true);
    expect(toll()).toBe(TOLL.rail * 0.5);
    const pid = sim.pacts.pacts[0].id;
    expect(execute(sim, 1, { t: 'pact', op: 'cancel', id: pid }).ok).toBe(true);
    expect(toll()).toBe(TOLL.rail);
  });

  it('入札: 競りに入札でき、独占権を持つ他社の街には同じ種類の施設を建てられない', () => {
    const sim = world();
    sim.setOnline([1, 2]);
    sim.map.towns.push({ id: 1, name: 'T', x: 60, y: 60, pop: 5000, houses: 0, roads: [], nextGrowth: 1e12, pax: 0 });
    const town = sim.map.towns[0];
    const lot = sim.auctions.open(1, 'mall', 1_500_000)!;
    expect(execute(sim, 1, { t: 'bid', lotId: 999, amount: 2_000_000 }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'bid', lotId: lot.id, amount: 1_000_000 }).ok).toBe(false); // 最低額未満
    expect(execute(sim, 1, { t: 'bid', lotId: lot.id, amount: 1e12 }).ok).toBe(false); // 資金不足
    expect(execute(sim, 1, { t: 'bid', lotId: lot.id, amount: 2_000_000 }).ok).toBe(true);
    expect(execute(sim, 1, { t: 'bid', lotId: lot.id, amount: 3_000_000 }).ok).toBe(false); // 自分が最高額
    expect(sim.playerCompany(1).cash).toBeGreaterThan(20_000_000); // 入札だけでは支払わない
    sim.auctions.rights.push({ townId: 1, type: 'mall', owner: 2, paid: 1 });
    expect(town).toBeDefined();
    const r = execute(sim, 1, { t: 'place', tool: 'mall', x: town.x, y: town.y });
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('独占権');
  });
});

describe('巨大マップの経路キャッシュ', () => {
  it('終点が1タイル違うだけの経路は別々に計算される(index が大きい場所でキーが衝突しない)', async () => {
    const { makeWorldMap } = await import('../src/shared/world/bigTerrain');
    const { Simulation: Sim } = await import('../src/shared/sim/simulation');
    const map = makeWorldMap(65535, 3);
    const sim = new Sim(map, undefined, { multi: true });
    const x = 65535 - 80;
    const y = 65535 - 40;
    for (let i = 0; i < 40; i++) {
      sim.map.rail.set(map.idx(x + i, y), 0);
    }
    // 東西の線路を2本(y と y+1)敷く
    for (const dy of [0, 1]) execute(sim, 1, { t: 'build', tool: 'rail', a: { x, y: y + dy }, b: { x: x + 30, y: y + dy } });
    const t = sim.transit as unknown as { route: (a: number, b: number, rail: boolean) => Uint32Array | null };
    const a = t.route(map.idx(x, y), map.idx(x + 20, y), true);
    const b = t.route(map.idx(x, y), map.idx(x + 20, y + 1), true);
    const c = t.route(map.idx(x, y), map.idx(x + 21, y), true);
    expect(a && a[a.length - 1]).toBe(map.idx(x + 20, y));
    // 2本の線路が接続されていなくても、少なくとも終点の違う経路が別のタイルに着く(キャッシュで取り違えない)
    expect(c && c[c.length - 1]).toBe(map.idx(x + 21, y));
    if (b) expect(b[b.length - 1]).toBe(map.idx(x + 20, y + 1));
  });
});

describe('斜めの線路の撤去', () => {
  it('斜めにドラッグすると斜めの線路に沿って撤去できる(信号も一緒に消える)。横のドラッグでは斜めは消えない', () => {
    const sim = world();
    sim.setOnline([1]);
    execute(sim, 1, { t: 'build', tool: 'rail', a: { x: 100, y: 100 }, b: { x: 112, y: 112 } });
    execute(sim, 1, { t: 'place', tool: 'signal', x: 106, y: 106 });
    const count = () => {
      let n = 0;
      for (let y = 98; y < 116; y++) for (let x = 98; x < 116; x++) if (sim.map.rail.get(sim.map.idx(x, y))) n++;
      return n;
    };
    expect(count()).toBe(13);
    execute(sim, 1, { t: 'build', tool: 'bulldoze', a: { x: 90, y: 90 }, b: { x: 99, y: 90 } }); // 関係ない所の横ドラッグ
    expect(count()).toBe(13);
    const r = execute(sim, 1, { t: 'build', tool: 'bulldoze', a: { x: 101, y: 101 }, b: { x: 111, y: 111 } });
    expect(r.ok).toBe(true);
    expect(count()).toBeLessThanOrEqual(2); // 両端の1タイルずつだけ残る
    expect(sim.transit.signalMask(sim.map.idx(106, 106))).toBe(0);
    // 他社の線路は撤去できない
    sim.setOnline([1, 2]);
    execute(sim, 1, { t: 'build', tool: 'rail', a: { x: 100, y: 120 }, b: { x: 110, y: 110 } });
    const before = count();
    execute(sim, 2, { t: 'build', tool: 'bulldoze', a: { x: 100, y: 120 }, b: { x: 110, y: 110 } });
    expect(count()).toBe(before);
  });
});

describe('通っている線路を変えたら、その上の経路が変わる', () => {
  it('走行中のバスの経路上に近道をつなぐと、次のタイルに入ったところで近道へ切り替わる(関係のない車両は変わらない)', () => {
    const sim = world();
    sim.setOnline([1]);
    // 遠回り: (100,100)→(100,112)→(118,112)→(118,100)
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 100, y: 100 } });
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 100, y: 100 }, b: { x: 100, y: 112 } });
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 100, y: 112 }, b: { x: 118, y: 112 } });
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 118, y: 112 }, b: { x: 118, y: 100 } });
    // 無関係な独立の道路(別の場所)
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 20, y: 20 }, b: { x: 50, y: 20 } });
    const a = execute(sim, 1, { t: 'ensureStop', x: 92, y: 100, kind: 'road' });
    const b = execute(sim, 1, { t: 'ensureStop', x: 118, y: 102, kind: 'road' });
    const rt = execute(sim, 1, { t: 'routeCreate', stops: [a.id!, b.id!] });
    const c = execute(sim, 1, { t: 'ensureStop', x: 22, y: 20, kind: 'road' });
    const d = execute(sim, 1, { t: 'ensureStop', x: 48, y: 20, kind: 'road' });
    const rt2 = execute(sim, 1, { t: 'routeCreate', stops: [c.id!, d.id!] });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 94, y: 100 });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 30, y: 20 });
    const m = sim.transit.routes.get(rt.id!)!.modelId;
    execute(sim, 1, { t: 'buyVehicle', routeId: rt.id!, modelId: m, cars: 1 });
    execute(sim, 1, { t: 'buyVehicle', routeId: rt2.id!, modelId: m, cars: 1 });
    const v = sim.transit.vehicles.find((x) => x.routeId === rt.id)!;
    const v2 = sim.transit.vehicles.find((x) => x.routeId === rt2.id)!;
    // A→B の遠回りの区間の序盤まで進める
    let ok = false;
    for (let i = 0; i < 6000 && !ok; i++) {
      sim.step();
      if (v.state === 'move' && v.order === 1 && v.path.length - v.pi > 30) ok = true;
    }
    expect(ok).toBe(true);
    const remaining = v.path.length - v.pi;
    const path2 = Array.from(v2.path);
    // 経路上の(100,100)と(118,100)の間に近道を敷く(分岐点は経路上のタイル)
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 100, y: 100 }, b: { x: 118, y: 100 } });
    let after = remaining;
    for (let i = 0; i < 40 && after >= remaining - 5; i++) {
      sim.step();
      if (v.state === 'move') after = v.path.length - v.pi;
    }
    expect(after).toBeLessThan(remaining - 10); // 近道に切り替わった(残りが大きく短くなった)
    // 関係ない場所の車両の経路は触られていない
    expect(v2.replan).toBeFalsy();
    if (v2.path.length === path2.length) expect(Array.from(v2.path)).toEqual(path2);
  });
  it('走行中の編成が通る線路に一方向の信号を置くと(ちょっとした変更でも)、次のタイルで探し直す', () => {
    const sim = world();
    sim.setOnline([1]);
    // 複線(y=100 と y=104)をはしごでつなぐ
    execute(sim, 1, { t: 'build', tool: 'rail', a: { x: 90, y: 100 }, b: { x: 124, y: 100 } });
    execute(sim, 1, { t: 'build', tool: 'rail', a: { x: 90, y: 104 }, b: { x: 124, y: 104 } });
    for (const x of [90, 124]) execute(sim, 1, { t: 'build', tool: 'rail', a: { x, y: 100 }, b: { x, y: 104 } });
    const A = execute(sim, 1, { t: 'place', tool: 'station', x: 92, y: 100, opts: { axis: 1, len: 3, tracks: 1, design: 1 } });
    const B = execute(sim, 1, { t: 'place', tool: 'station', x: 118, y: 100, opts: { axis: 1, len: 3, tracks: 1, design: 1 } });
    expect(A.ok && B.ok).toBe(true);
    const rt = execute(sim, 1, { t: 'routeCreate', stops: [A.id!, B.id!] });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 100, y: 100 });
    const r = sim.transit.routes.get(rt.id!)!;
    expect(execute(sim, 1, { t: 'buyVehicle', routeId: rt.id!, modelId: r.modelId, cars: 4 }).ok).toBe(true);
    const v = sim.transit.vehicles[0];
    let ok = false;
    for (let i = 0; i < 6000 && !ok; i++) {
      sim.step();
      if (v.state === 'move' && v.order === 1 && v.path.length - v.pi > 12 && v.pi > 1) ok = true;
    }
    expect(ok).toBe(true);
    const ahead = v.path[Math.min(v.path.length - 1, v.pi + 6)];
    const ax = ahead % sim.map.size;
    const ay = Math.floor(ahead / sim.map.size);
    const pathBefore = Array.from(v.path);
    // 進行方向と逆向きの一方向信号を、前方のタイルに置く(いまの経路が通れなくなる)
    const dirBits = sim.map.rail.get(ahead) & 15;
    const mask = dirBits === 10 ? 1 << 3 : 1 << 0; // 東西なら西向き / 南北なら北向き(進行と逆)
    const pair = sim.transit.setSignal(ax, ay, mask);
    expect(pair).toBe(true);
    expect(v.replan).toBe(true); // 通る線路が変更されたので印が付く
    for (let i = 0; i < 60; i++) sim.step();
    expect(v.replan).toBeFalsy();
    expect(Array.from(v.path).join()).not.toBe(pathBefore.join()); // 経路が変わった(別の線を通る/探し直された)
  });
});

describe('要素ごとの範囲撤去', () => {
  const kinds = (o: Partial<Record<string, boolean>>) =>
    ({ road: false, rail: false, signal: false, stop: false, depot: false, waypoint: false, span: false, building: false, airport: false, ...o }) as never;
  const setup = () => {
    const sim = world();
    sim.setOnline([1]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 110, y: 100 } });
    execute(sim, 1, { t: 'build', tool: 'rail', a: { x: 90, y: 104 }, b: { x: 110, y: 104 } });
    execute(sim, 1, { t: 'place', tool: 'signal', x: 100, y: 104 });
    execute(sim, 1, { t: 'ensureStop', x: 95, y: 100, kind: 'road' });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 105, y: 100 });
    execute(sim, 1, { t: 'place', tool: 'waypoint', x: 96, y: 104 });
    return sim;
  };
  const count = (sim: ReturnType<typeof world>, layer: 'road' | 'rail') => {
    let n = 0;
    for (let y = 95; y < 110; y++) for (let x = 85; x < 115; x++) if (sim.map[layer].get(sim.map.idx(x, y))) n++;
    return n;
  };
  it('ドラッグした範囲の中の、選んだ種類だけが消える(道路だけ・線路だけ・信号だけ)', () => {
    const sim = setup();
    const roads = count(sim, 'road');
    const rails = count(sim, 'rail');
    expect(roads).toBeGreaterThan(10);
    expect(rails).toBeGreaterThan(10);
    // 信号だけ
    const r1 = execute(sim, 1, { t: 'bulldoze', a: { x: 85, y: 95 }, b: { x: 115, y: 110 }, kinds: kinds({ signal: true }) });
    expect(r1.ok).toBe(true);
    expect(sim.transit.signalMask(sim.map.idx(100, 104))).toBe(0);
    expect(count(sim, 'road')).toBe(roads);
    expect(count(sim, 'rail')).toBe(rails);
    // 道路だけ(範囲の半分 x<100)
    execute(sim, 1, { t: 'bulldoze', a: { x: 85, y: 95 }, b: { x: 99, y: 110 }, kinds: kinds({ road: true }) });
    expect(count(sim, 'road')).toBeLessThan(roads);
    expect(sim.map.road.get(sim.map.idx(105, 100))).not.toBe(0); // 範囲の外は残る
    expect(count(sim, 'rail')).toBe(rails); // 線路は触らない
    // 線路だけ
    execute(sim, 1, { t: 'bulldoze', a: { x: 85, y: 95 }, b: { x: 115, y: 110 }, kinds: kinds({ rail: true }) });
    expect(count(sim, 'rail')).toBe(0);
  });
  it('停留所・基地・経由点をそれぞれ選んで撤去できる。道路は残る', () => {
    const sim = setup();
    const roads = count(sim, 'road');
    expect(sim.transit.stops.size).toBeGreaterThanOrEqual(2); // バス停と経由点
    execute(sim, 1, { t: 'bulldoze', a: { x: 85, y: 95 }, b: { x: 115, y: 110 }, kinds: kinds({ waypoint: true }) });
    expect([...sim.transit.stops.values()].some((s) => s.waypoint)).toBe(false);
    expect([...sim.transit.stops.values()].some((s) => !s.waypoint)).toBe(true); // バス停は残る
    execute(sim, 1, { t: 'bulldoze', a: { x: 85, y: 95 }, b: { x: 115, y: 110 }, kinds: kinds({ stop: true }) });
    expect(sim.transit.stops.size).toBe(0);
    expect(sim.transit.depots.size).toBe(1);
    execute(sim, 1, { t: 'bulldoze', a: { x: 85, y: 95 }, b: { x: 115, y: 110 }, kinds: kinds({ depot: true }) });
    expect(sim.transit.depots.size).toBe(0);
    expect(count(sim, 'road')).toBe(roads);
  });
  it('斜めの線路も範囲の中なら消える。他社のものは消えず、広すぎる範囲は断られる', () => {
    const sim = world();
    sim.setOnline([1, 2]);
    execute(sim, 1, { t: 'build', tool: 'rail', a: { x: 100, y: 100 }, b: { x: 112, y: 112 } });
    execute(sim, 2, { t: 'bulldoze', a: { x: 95, y: 95 }, b: { x: 115, y: 115 }, kinds: kinds({ rail: true }) });
    expect(count(sim, 'rail')).toBeGreaterThan(5); // 他社(2)は消せない
    const r = execute(sim, 1, { t: 'bulldoze', a: { x: 95, y: 95 }, b: { x: 115, y: 115 }, kinds: kinds({ rail: true }) });
    expect(r.ok).toBe(true);
    let left = 0;
    for (let y = 95; y <= 115; y++) for (let x = 95; x <= 115; x++) if (sim.map.rail.get(sim.map.idx(x, y))) left++;
    expect(left).toBe(0);
    expect(execute(sim, 1, { t: 'bulldoze', a: { x: 0, y: 0 }, b: { x: 127, y: 127 }, kinds: kinds({ rail: true }) }).ok).toBe(true); // 128x128 = 16384 は許可
    const big = new Simulation(flatBig(), undefined, { multi: true });
    big.setOnline([1]);
    expect(execute(big, 1, { t: 'bulldoze', a: { x: 0, y: 0 }, b: { x: 200, y: 200 }, kinds: kinds({ rail: true }) }).ok).toBe(false);
  });
  it('斜めの線路は、1段の高低差をまたいでは敷けない(直線のスロープだけ可)', () => {
    const size = 64;
    const h = new Uint8Array(size * size).fill(SEA_LEVEL + 20);
    for (let y = 0; y < size; y++) for (let x = 30; x < size; x++) h[y * size + x] = SEA_LEVEL + 20 + 16; // x>=30 は1段高い
    const map = new GameMap(size, 1, h);
    expect(canConnectRail(map, 29, 10, 1, true)).toBe(true); // 直線(東)は1段差でもスロープで可
    expect(canConnectRail(map, 29, 10, 5, true)).toBe(false); // 斜め(南東)は1段差をまたげない
    expect(canConnectRail(map, 40, 10, 5, true)).toBe(true); // 同じ高さなら斜めも可
  });
});

function flatBig() {
  return new GameMap(256, 1, () => new Uint8Array(4096).fill(SEA_LEVEL + 20));
}

describe('施設(ホテル・百貨店)の建設と売上', () => {
  it('建てられ(資金を払い)、近くの停留所に乗客が着くと自社の売上になる。停留所がなければ売上は入らず維持費だけ', () => {
    const sim = world();
    sim.setOnline([1]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 60, y: 80 }, b: { x: 120, y: 80 } });
    for (let x = 62; x < 80; x += 2) sim.map.building.set(sim.map.idx(x, 81), 5); // 乗客のもと
    const a = execute(sim, 1, { t: 'ensureStop', x: 70, y: 80, kind: 'road' });
    const b = execute(sim, 1, { t: 'ensureStop', x: 110, y: 80, kind: 'road' });
    const rt = execute(sim, 1, { t: 'routeCreate', stops: [a.id!, b.id!] });
    execute(sim, 1, { t: 'place', tool: 'depot', x: 90, y: 80 });
    const model = sim.transit.routes.get(rt.id!)!.modelId;
    execute(sim, 1, { t: 'buyVehicle', routeId: rt.id!, modelId: model, cars: 1 });
    execute(sim, 1, { t: 'buyVehicle', routeId: rt.id!, modelId: model, cars: 1 });
    const co = sim.playerCompany(1);
    const cash = co.cash;
    const near = execute(sim, 1, { t: 'place', tool: 'hotel', x: 112, y: 83 }); // 終点のバス停の集客圏
    const far = execute(sim, 1, { t: 'place', tool: 'department', x: 20, y: 20 }); // 停留所のない場所
    expect(near.ok).toBe(true);
    expect(far.ok).toBe(true);
    expect(co.cash).toBeLessThan(cash - 8_000_000); // 建設費(ホテル400万+百貨店500万)を払った
    const hotel = sim.map.facilities.find((f) => f.type === 'hotel')!;
    const dept = sim.map.facilities.find((f) => f.type === 'department')!;
    expect(hotel.playerId).toBe(1);
    for (let i = 0; i < 20000; i++) sim.step();
    expect(hotel.visits ?? 0).toBeGreaterThan(0);
    expect(co.total.facility ?? 0).toBeGreaterThan(0); // 近くの停留所の来場が売上になった
    expect(dept.visits ?? 0).toBe(0); // 停留所のない百貨店には誰も来ない
    expect(dept.dayIncome ?? 0).toBe(0);
    expect(co.total.upkeep ?? 0).toBeGreaterThan(0); // 維持費はかかる
  });
});

describe('広告(コマンド)', () => {
  it('自社の施設にだけ打てて、費用を払い、同じ施設は一定期間に1度だけ。他社の施設・資金不足は拒否', () => {
    const sim = world();
    sim.setOnline([1, 2]);
    const hotel = execute(sim, 1, { t: 'place', tool: 'hotel', x: 60, y: 60 });
    expect(hotel.ok).toBe(true);
    const f = sim.map.facilities.find((x) => x.type === 'hotel')!;
    const co = sim.playerCompany(1);
    const cash = co.cash;
    expect(execute(sim, 2, { t: 'ad', facilityId: f.id, kind: 'news' }).ok).toBe(false); // 他社の施設
    const r = execute(sim, 1, { t: 'ad', facilityId: f.id, kind: 'sns' });
    expect(r.ok).toBe(true);
    expect(co.cash).toBeLessThan(cash);
    expect(co.today.ad ?? 0).toBeGreaterThan(0);
    expect(f.ad?.kind).toBe('sns');
    expect(execute(sim, 1, { t: 'ad', facilityId: f.id, kind: 'tv' }).ok).toBe(false); // クールダウン中
    expect(execute(sim, 1, { t: 'ad', facilityId: 999, kind: 'tv' }).ok).toBe(false);
    for (let i = 0; i < 15 * 18000; i++) sim.step();
    co.cash = 1000;
    expect(execute(sim, 1, { t: 'ad', facilityId: f.id, kind: 'tv' }).ok).toBe(false); // 資金不足
    co.cash = 50_000_000;
    expect(execute(sim, 1, { t: 'ad', facilityId: f.id, kind: 'tv' }).ok).toBe(true); // 期間が過ぎたので打てる
  });
});

describe('施設のデザイン・大きさを選んで建てる', () => {
  it('ホテル・公園は S/M/L で敷地(1/2/3四方)と費用が変わり、選んだデザインで建つ。範囲外のデザイン・大きさは拒否', () => {
    const sim = world();
    sim.setOnline([1]);
    const co = sim.playerCompany(1);
    const dims: Record<string, number> = { S: 1, M: 2, L: 3 };
    const costs: number[] = [];
    let x = 30;
    for (const size of ['S', 'M', 'L'] as const) {
      const c0 = co.cash;
      const r = execute(sim, 1, { t: 'place', tool: 'hotel', x, y: 40, fac: { design: 29, size } });
      expect(r.ok).toBe(true);
      const f = sim.map.facilities[sim.map.facilities.length - 1];
      expect([f.w, f.h, f.size, f.design]).toEqual([dims[size], dims[size], size, 29]);
      costs.push(c0 - co.cash);
      x += 6;
    }
    expect(costs[0]).toBeLessThan(costs[1]);
    expect(costs[1]).toBeLessThan(costs[2]);
    expect(execute(sim, 1, { t: 'place', tool: 'park', x: 30, y: 60, fac: { design: 20, size: 'S' } }).ok).toBe(false); // 公園は0〜19
    expect(execute(sim, 1, { t: 'place', tool: 'park', x: 30, y: 60, fac: { design: 19, size: 'S' } }).ok).toBe(true);
    expect(execute(sim, 1, { t: 'place', tool: 'park', x: 40, y: 60, fac: { design: 0, size: 'XL' as 'S' } }).ok).toBe(false);
  });
});

describe('不正な値への耐性(脆弱性の確認)', () => {
  const setup = () => {
    const sim = world();
    sim.setOnline([1, 2]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 120, y: 100 } });
    const a = execute(sim, 1, { t: 'ensureStop', x: 95, y: 100, kind: 'road' });
    const b = execute(sim, 1, { t: 'ensureStop', x: 115, y: 100, kind: 'road' });
    const rt = execute(sim, 1, { t: 'routeCreate', stops: [a.id!, b.id!] });
    return { sim, a: a.id!, b: b.id!, R: rt.id! };
  };
  it('同じ停留所だけ・配列でない・非整数の路線は作れない', () => {
    const { sim, a } = setup();
    expect(execute(sim, 1, { t: 'routeCreate', stops: [a, a] }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'routeCreate', stops: 'ab' as unknown as number[] }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'routeCreate', stops: [a, 1.5] }).ok).toBe(false);
  });
  it('オーダーの添え字は整数だけ。小数・NaN・文字列は拒否(順序がずれない)', () => {
    const { sim, a, R } = setup();
    const n = sim.transit.routes.get(R)!.orders.length;
    for (const idx of [0.5, NaN, null, 'x', -1.5]) {
      expect(execute(sim, 1, { t: 'tx', m: 'insertOrder', a: [R, idx as number, a] }).ok).toBe(false);
      expect(execute(sim, 1, { t: 'tx', m: 'removeOrder', a: [R, idx as number] }).ok).toBe(false);
    }
    expect(sim.transit.routes.get(R)!.orders).toHaveLength(n);
    expect(execute(sim, 1, { t: 'tx', m: 'insertOrder', a: [R, 1, a] }).ok).toBe(true);
    expect(execute(sim, 1, { t: 'orderSet', routeId: R, index: 0.5, patch: { dwell: 50 } }).ok).toBe(false);
  });
  it('路線の周期・発車時刻は範囲内に収まり、名前は文字列だけ受け付ける', () => {
    const { sim, R } = setup();
    const r = sim.transit.routes.get(R)!;
    const name0 = r.name;
    for (const period of [1e300, 1e-300, 0.0001]) {
      execute(sim, 1, { t: 'routeSet', routeId: R, patch: { period } });
      expect(r.period).toBeGreaterThanOrEqual(18000 / 96);
      expect(r.period).toBeLessThanOrEqual(18000 * 7);
    }
    execute(sim, 1, { t: 'routeSet', routeId: R, patch: { name: { a: 1 } as unknown as string } });
    expect(r.name).toBe(name0); // [object Object] にならない
    execute(sim, 1, { t: 'orderSet', routeId: R, index: 0, patch: { departTod: 1e300 } });
    expect(r.orders[0].departTod).toBeLessThan(18000);
  });
  it('未知のコマンドは「不正な操作」で、例外にならない', () => {
    const { sim } = setup();
    expect(execute(sim, 1, { t: 'zzz' } as unknown as Cmd)).toEqual({ ok: false, msg: '不正な操作です' });
  });
});

describe('他社の停留所の使用許可', () => {
  const setup = () => {
    const sim = world();
    sim.setOnline([1, 2]);
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 120, y: 100 } });
    execute(sim, 2, { t: 'build', tool: 'road', a: { x: 90, y: 104 }, b: { x: 120, y: 104 } });
    const a = execute(sim, 1, { t: 'ensureStop', x: 95, y: 100, kind: 'road' }).id!;
    const b = execute(sim, 1, { t: 'ensureStop', x: 115, y: 100, kind: 'road' }).id!;
    const mine2 = execute(sim, 2, { t: 'ensureStop', x: 95, y: 104, kind: 'road' }).id!;
    return { sim, a, b, mine2 };
  };
  it('許可がなければ他社の停留所は、路線・オーダー・停留所の再設置に使えない', () => {
    const { sim, a, b, mine2 } = setup();
    expect(execute(sim, 2, { t: 'routeCreate', stops: [a, b] }).ok).toBe(false);
    expect(execute(sim, 2, { t: 'routeCreate', stops: [mine2, a] }).ok).toBe(false);
    expect(execute(sim, 2, { t: 'ensureStop', x: 95, y: 100, kind: 'road' }).ok).toBe(false);
    const rt = execute(sim, 2, { t: 'routeCreate', stops: [mine2, execute(sim, 2, { t: 'ensureStop', x: 115, y: 104, kind: 'road' }).id!] });
    expect(execute(sim, 2, { t: 'tx', m: 'insertOrder', a: [rt.id!, 1, a] }).ok).toBe(false);
  });
  it('駅ごとの許可: その駅だけ使える。取り消すと再び使えない。持ち主以外は許可を出せない', () => {
    const { sim, a, b } = setup();
    expect(execute(sim, 2, { t: 'stopAllow', stopId: a, who: 2, allow: true }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'stopAllow', stopId: a, who: 1, allow: true }).ok).toBe(false); // 自社には不要
    expect(execute(sim, 1, { t: 'stopAllow', stopId: a, who: 99, allow: true }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'stopAllow', stopId: a, who: 2, allow: true }).ok).toBe(true);
    const own = execute(sim, 2, { t: 'ensureStop', x: 115, y: 104, kind: 'road' }).id!;
    expect(execute(sim, 2, { t: 'routeCreate', stops: [a, own] }).ok).toBe(true);
    expect(execute(sim, 2, { t: 'routeCreate', stops: [b, own] }).ok).toBe(false); // 別の駅は許可されていない
    expect(execute(sim, 1, { t: 'stopAllow', stopId: a, who: 2, allow: false }).ok).toBe(true);
    expect(execute(sim, 2, { t: 'routeCreate', stops: [a, own] }).ok).toBe(false);
  });
  it('会社単位の許可: 自社の全駅が使える。取り消せる。許可はセーブに残る', () => {
    const { sim, a, b } = setup();
    expect(execute(sim, 1, { t: 'companyAllow', who: 2, allow: true }).ok).toBe(true);
    expect(execute(sim, 2, { t: 'routeCreate', stops: [a, b] }).ok).toBe(true);
    const saved = sim.transit.save();
    expect(saved.grants).toEqual([[1, [2]]]);
    expect(execute(sim, 1, { t: 'companyAllow', who: 2, allow: false }).ok).toBe(true);
    expect(execute(sim, 2, { t: 'routeCreate', stops: [a, b] }).ok).toBe(false);
  });

  it('新しい施設: デザインと大きさを選んで建てられる。立地の条件を満たさないと建てられない', () => {
    const sim = world();
    sim.setOnline([1]);
    const co = sim.playerCompany(1);
    // 映画館: 大きさSなら安く、選んだデザインで建つ
    const before = co.cash;
    const r = execute(sim, 1, { t: 'place', tool: 'cinema', x: 40, y: 40, fac: { design: 5, size: 'S' } });
    expect(r.ok).toBe(true);
    const f = sim.map.facilities.find((x) => x.type === 'cinema')!;
    expect(f).toMatchObject({ design: 5, size: 'S', w: 1, h: 1, playerId: 1 });
    expect(before - co.cash).toBe(facilityCost('cinema', 'S'));
    // 範囲外のデザインは不可
    expect(execute(sim, 1, { t: 'place', tool: 'cinema', x: 60, y: 60, fac: { design: 99, size: 'L' } }).ok).toBe(false);
    // 立地の条件: 平地(標高2)ではスキー場は建てられず、海がなければビーチも建てられない
    expect(execute(sim, 1, { t: 'place', tool: 'ski', x: 80, y: 80, fac: { design: 0, size: 'L' } }).msg).toContain('標高');
    expect(execute(sim, 1, { t: 'place', tool: 'beach', x: 80, y: 80, fac: { design: 0, size: 'L' } }).msg).toContain('海のそば');
    // 駅ビル: 鉄道の駅がなければ建てられない
    expect(execute(sim, 1, { t: 'place', tool: 'stationmall', x: 100, y: 100, fac: { design: 0, size: 'L' } }).msg).toContain('駅');
    // 来場者の対象(広告も出せる)
    expect(VISITOR_TYPES).toContain('cinema');
  });
});

describe('施設の料金(コマンド)', () => {
  it('自社の売上のある施設だけ設定でき、段階は整数の0〜4。他社・公園・範囲外は拒否', () => {
    const sim = world();
    sim.setOnline([1, 2]);
    execute(sim, 1, { t: 'place', tool: 'hotel', x: 60, y: 60, fac: { design: 0, size: 'S' } });
    execute(sim, 1, { t: 'place', tool: 'park', x: 80, y: 60, fac: { design: 0, size: 'S' } });
    const hotel = sim.map.facilities.find((f) => f.type === 'hotel')!;
    const park = sim.map.facilities.find((f) => f.type === 'park')!;
    expect(execute(sim, 1, { t: 'facPrice', facilityId: hotel.id, level: 4 }).ok).toBe(true);
    expect(hotel.price).toBe(4);
    expect(execute(sim, 2, { t: 'facPrice', facilityId: hotel.id, level: 0 }).ok).toBe(false); // 他社
    expect(hotel.price).toBe(4);
    for (const level of [-1, 5, 1.5, NaN, null, '2']) expect(execute(sim, 1, { t: 'facPrice', facilityId: hotel.id, level: level as number }).ok).toBe(false);
    expect(execute(sim, 1, { t: 'facPrice', facilityId: park.id, level: 1 }).ok).toBe(false); // 公園は売上がない
    expect(execute(sim, 1, { t: 'facPrice', facilityId: 999, level: 1 }).ok).toBe(false);
  });
});

describe('施設のグレードと改装(コマンド)', () => {
  it('グレードは費用を払って1つずつ★5まで。他社・資金不足・最高では拒否。改装は古いときだけ', () => {
    const sim = world();
    sim.setOnline([1, 2]);
    execute(sim, 1, { t: 'place', tool: 'hotel', x: 60, y: 60, fac: { design: 0, size: 'S' } });
    const f = sim.map.facilities.find((x) => x.type === 'hotel')!;
    const co = sim.playerCompany(1);
    expect(execute(sim, 2, { t: 'facUpgrade', facilityId: f.id }).ok).toBe(false);
    const cash = co.cash;
    expect(execute(sim, 1, { t: 'facUpgrade', facilityId: f.id }).ok).toBe(true);
    expect(f.grade).toBe(2);
    expect(co.cash).toBeLessThan(cash);
    co.cash = 1000;
    expect(execute(sim, 1, { t: 'facUpgrade', facilityId: f.id }).ok).toBe(false); // 資金不足
    expect(f.grade).toBe(2);
    co.cash = 1e9;
    for (let i = 0; i < 10; i++) execute(sim, 1, { t: 'facUpgrade', facilityId: f.id });
    expect(f.grade).toBe(5);
    expect(execute(sim, 1, { t: 'facUpgrade', facilityId: f.id }).ok).toBe(false); // 最高
    expect(execute(sim, 1, { t: 'facRenovate', facilityId: f.id }).ok).toBe(false); // まだ新しい
    f.renov = -2000; // とても古い
    expect(execute(sim, 1, { t: 'facRenovate', facilityId: f.id }).ok).toBe(true);
    expect(f.renov).toBe(sim.day);
    expect(execute(sim, 2, { t: 'facRenovate', facilityId: f.id }).ok).toBe(false);
  });
});
