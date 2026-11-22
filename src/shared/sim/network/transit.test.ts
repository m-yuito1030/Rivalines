import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { GameMap } from '../../world/gameMap';
import { connect } from '../../world/roads';
import { findPath } from './pathfinding';
import { DAY_TICKS, Transit, nearestDiff, todOf } from './transit';

function setup(oneway = false) {
  const size = 64;
  const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
  for (let x = 5; x < 40; x++) connect(map, x, 10, 1, oneway);
  // 停留所の近くに建物(乗客発生源)
  for (const x of [8, 9, 36, 37]) map.building.set(map.idx(x, 11), 3);
  const tr = new Transit(map);
  return { map, tr };
}

describe('pathfinding', () => {
  it('双方向なら往復できる', () => {
    const { map } = setup();
    expect(findPath(map, map.idx(5, 10), map.idx(39, 10))!.length).toBe(35);
    expect(findPath(map, map.idx(39, 10), map.idx(5, 10))).not.toBeNull();
  });
  it('一方通行は逆向きの経路がない', () => {
    const { map } = setup(true);
    expect(findPath(map, map.idx(5, 10), map.idx(39, 10))).not.toBeNull();
    expect(findPath(map, map.idx(39, 10), map.idx(5, 10))).toBeNull();
  });
});

describe('transit', () => {
  it('バスが往復して乗客を運ぶ', () => {
    const { tr } = setup();
    const a = tr.addStop(8, 10)!;
    const b = tr.addStop(37, 10)!;
    expect(a.pop).toBeGreaterThan(0);
    const route = tr.addRoute([a.id, b.id])!;
    tr.addVehicle(route.id, 0);
    for (let t = 1; t < 6000; t++) tr.step(t);
    expect(tr.delivered).toBeGreaterThan(0);
  });
  it('一方通行で帰れない路線は noroute になる', () => {
    const { tr } = setup(true);
    const a = tr.addStop(8, 10)!;
    const b = tr.addStop(37, 10)!;
    const route = tr.addRoute([a.id, b.id])!;
    const v = tr.addVehicle(route.id, 0)!;
    for (let t = 1; t < 3000; t++) tr.step(t);
    expect(v.state).toBe('noroute');
  });
  it('時刻指定オーダーは指定時刻まで待つ(遅れたら即発車)', () => {
    const { tr } = setup();
    const a = tr.addStop(8, 10)!;
    const b = tr.addStop(37, 10)!;
    const route = tr.addRoute([a.id, b.id])!;
    route.orders[1].kind = 'timed';
    route.orders[1].departTod = 12345;
    const v = tr.addVehicle(route.id, 0)!;
    let t = 1;
    while (!(v.state === 'load' && v.order === 1) && t < 5000) tr.step(t++);
    expect(v.state).toBe('load');
    const wait = v.until - v.arrived;
    expect(wait).toBeGreaterThanOrEqual(route.orders[1].dwell);
    expect(wait).toBeLessThanOrEqual(DAY_TICKS / 2);
    expect(wait === route.orders[1].dwell || todOf(v.until) === 12345).toBe(true);
  });
  it('道路が撤去されると停留所が消える', () => {
    const { map, tr } = setup();
    const a = tr.addStop(8, 10)!;
    map.road.set(a.idx, 0);
    for (let t = 0; t < 200; t++) tr.step(t);
    expect(tr.stops.size).toBe(0);
  });
});

describe('目的地と乗り換え', () => {
  it('A→B→C: Aの乗客はBで乗り換えてCへ行ける', () => {
    const size = 96;
    const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
    for (let x = 5; x < 70; x++) connect(map, x, 10, 1, false);
    for (const x of [8, 9, 55, 56, 30, 31]) map.building.set(map.idx(x, 11), 3);
    const tr = new Transit(map);
    const a = tr.addStop(8, 10)!;
    const b = tr.addStop(30, 10)!;
    const c = tr.addStop(55, 10)!;
    const r1 = tr.addRoute([a.id, b.id])!;
    const r2 = tr.addRoute([b.id, c.id])!;
    tr.addVehicle(r1.id, 0);
    tr.addVehicle(r2.id, 0);
    const tbl = (tr as unknown as { router: { table(s: number, v: number): { next: Map<number, number> } } }).router.table(a.id, tr.version);
    expect(tbl.next.get(c.id)).toBe(r1.id); // Cへは先に路線1に乗る
    expect(tbl.next.get(b.id)).toBe(r1.id);
    for (let t = 1; t < 15000; t++) tr.step(t);
    expect(tr.transfers).toBeGreaterThan(0);
    expect(tr.delivered).toBeGreaterThan(0);
  });
  it('路線のない停留所には乗客が発生しない', () => {
    const { tr } = setup();
    const a = tr.addStop(8, 10)!;
    for (let t = 1; t < 2000; t++) tr.step(t);
    expect(a.waiting).toBe(0);
  });
  it('路線を消すと行けなくなった乗客は消える', () => {
    const { tr } = setup();
    const a = tr.addStop(8, 10)!;
    const b = tr.addStop(37, 10)!;
    const r = tr.addRoute([a.id, b.id])!;
    for (let t = 1; t < 1500; t++) tr.step(t);
    expect(a.waiting).toBeGreaterThan(0);
    tr.removeRoute(r.id);
    for (let t = 1500; t < 1700; t++) tr.step(t);
    expect(a.waiting).toBe(0);
  });
});

describe('渋滞(車線の占有)', () => {
  it('同じ車線に2台が同時にいない / 追従して動く', () => {
    const { tr } = setup();
    const a = tr.addStop(8, 10)!;
    const b = tr.addStop(37, 10)!;
    const r = tr.addRoute([a.id, b.id])!;
    for (let i = 0; i < 4; i++) expect(tr.addVehicle(r.id, 0)).not.toBeNull();
    expect(tr.addVehicle(r.id, 0)).toBeNull(); // 停留所の4車線が埋まった
    let moved = 0;
    for (let t = 1; t < 5000; t++) {
      tr.step(t);
      const keys = new Set<number>();
      for (const v of tr.vehicles) {
        const k = v.path[Math.min(v.pi, v.path.length - 1)] * 4 + v.dir;
        expect(keys.has(k)).toBe(false); // 同じ(タイル,向き)に2台いない
        keys.add(k);
        if (v.state === 'move') moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
    expect(tr.delivered).toBeGreaterThan(0);
  });
});

describe('時刻表の自動作成と車両オフセット', () => {
  it('nearestDiff は周期内で最も近い予定との差を返す', () => {
    expect(nearestDiff(100, 90, 1000)).toBe(10);
    expect(nearestDiff(100, 150, 1000)).toBe(-50);
    expect(nearestDiff(900, 100, 1000)).toBe(-200); // 前周期の予定のほうが近い
  });
  it('自動作成した時刻表どおりに運行し、遅延がほとんど出ない', () => {
    const { tr } = setup();
    const a = tr.addStop(8, 10)!;
    const b = tr.addStop(37, 10)!;
    const r = tr.addRoute([a.id, b.id])!;
    expect(tr.legTicks(r, 0)).toBeCloseTo(29 / 0.3, 0);
    expect(tr.autoTimetable(r.id, 0)).toBe(true);
    expect(r.orders.every((o) => o.kind === 'timed')).toBe(true);
    expect(r.period).toBeGreaterThanOrEqual(DAY_TICKS / 48); // 周期は往復時間以上
    tr.addVehicle(r.id, 0);
    for (let t = 1; t < DAY_TICKS / 2; t++) tr.step(t);
    expect(r.late / (DAY_TICKS / 1440)).toBeLessThan(5); // 平均遅延 5分未満
    expect(tr.delivered).toBeGreaterThan(0);
  });
  it('オフセット付きで追加した車両は、その分遅れて出発する', () => {
    const { tr } = setup();
    const a = tr.addStop(8, 10)!;
    const b = tr.addStop(37, 10)!;
    const r = tr.addRoute([a.id, b.id])!;
    tr.autoTimetable(r.id, 0);
    const P = r.period;
    const v0 = tr.addVehicle(r.id, 0, 0)!;
    const v1 = tr.addVehicle(r.id, 0, P / 2)!;
    expect(v1.until).toBeGreaterThan(v0.until);
    expect(v1.until).toBeCloseTo(P / 2, -1); // 周期の半分だけ後に出発
  });
});

describe('発車案内', () => {
  it('車両が停留所に向かう間は到着見込み、停車中は stopped になり、時刻表も返る', () => {
    const { tr } = setup();
    const a = tr.addStop(7, 10)!;
    const b = tr.addStop(37, 10)!;
    const r = tr.addRoute([a.id, b.id])!;
    expect(tr.departures(b.id, 0)).toEqual([]); // 車両なし
    tr.addVehicle(r.id, 0);
    let sawMoving = false;
    let sawStopped = false;
    let prevEta = Infinity;
    for (let t = 0; t < 4000; t++) {
      tr.step(t);
      const d = tr.departures(b.id, t)[0];
      if (!d) continue;
      if (d.stopped) sawStopped = true;
      else {
        sawMoving = true;
        expect(d.eta).toBeGreaterThanOrEqual(0);
        if (t % 50 === 0 && prevEta !== Infinity && d.eta < prevEta + 1) prevEta = d.eta; // 近づくにつれて減る
      }
      if (!d.stopped) prevEta = Math.min(prevEta, d.eta);
    }
    expect(sawMoving).toBe(true);
    expect(sawStopped).toBe(true);
    r.orders[1].kind = 'timed';
    r.orders[1].departTod = 0;
    const tt = tr.timetable(b.id, 0);
    expect(tt[0].etas).toHaveLength(3);
    expect(tt[0].etas[1] - tt[0].etas[0]).toBe(r.period);
  });
});

describe('条件付きオーダー', () => {
  function threeStops() {
    const { map, tr } = setup();
    for (const x of [18, 19, 28, 29]) map.building.set(map.idx(x, 11), 3);
    const a = tr.addStop(7, 10)!;
    const b = tr.addStop(20, 10)!;
    const c = tr.addStop(30, 10)!;
    const r = tr.addRoute([a.id, b.id, c.id])!;
    return { map, tr, a, b, c, r };
  }
  it('条件付きオーダー: 条件を満たしたときだけ次の駅を飛ばす', () => {
    for (const skip of [false, true]) {
      const { tr, b, r } = threeStops();
      // a(0)を出発するとき: 待ち人数が 0 以上(常に真)なら 2 番(c)へ直行。偽なら通常どおり b へ
      r.orders[0].cond = { kind: 'wait', op: 'ge', value: skip ? 0 : 99999, to: 2 };
      tr.addVehicle(r.id, 0);
      const v = tr.vehicles[0];
      const visited = new Set<number>();
      for (let t = 0; t < 2500; t++) {
        tr.step(t);
        if (v.state === 'load') visited.add(r.orders[v.order].stopId);
      }
      expect(visited.has(b.id)).toBe(!skip);
    }
  });
  it('条件の種類: 積載率・時刻・未満', () => {
    const { tr, r } = threeStops();
    tr.addVehicle(r.id, 0);
    const v = tr.vehicles[0];
    v.load = 0;
    const hold = (c: NonNullable<(typeof r.orders)[0]['cond']>, tick = 0) =>
      (tr as unknown as { condHolds: (v: unknown, r: unknown, c: unknown, t: number) => boolean }).condHolds(v, r, c, tick);
    expect(hold({ kind: 'load', op: 'ge', value: 50, to: 2 })).toBe(false);
    expect(hold({ kind: 'load', op: 'lt', value: 50, to: 2 })).toBe(true);
    v.load = v.cap;
    expect(hold({ kind: 'load', op: 'ge', value: 100, to: 2 })).toBe(true);
    // 時刻: tick 0 は 06:00(= 360分)
    expect(hold({ kind: 'tod', op: 'ge', value: 360, to: 2 }, 0)).toBe(true);
    expect(hold({ kind: 'tod', op: 'lt', value: 360, to: 2 }, 0)).toBe(false);
  });
  it('共有オーダー: コピーは同じオーダーを持ち、編集が全員に反映され、解除で独立する', () => {
    const { tr, r } = threeStops();
    const s = tr.shareRoute(r.id)!;
    expect(s.shared).toBe(r.shared);
    expect(s.orders).toEqual(r.orders);
    expect(s.orders[0]).not.toBe(r.orders[0]); // 別オブジェクト
    s.orders[1].dwell = 777;
    s.orders[1].cond = { kind: 'load', op: 'ge', value: 70, to: 0 };
    s.period = DAY_TICKS / 4;
    tr.syncOrders(s.id);
    expect(r.orders[1].dwell).toBe(777);
    expect(r.orders[1].cond).toEqual({ kind: 'load', op: 'ge', value: 70, to: 0 });
    expect(r.period).toBe(DAY_TICKS / 4);
    // 車種・両数は共有されない
    s.modelId = 'bus-l';
    tr.syncOrders(s.id);
    expect(r.modelId).not.toBe('bus-l');
    tr.unshareRoute(s.id);
    expect(s.shared).toBeUndefined();
    expect(r.shared).toBeUndefined(); // 残り1路線なら解除
    s.orders[1].dwell = 5;
    tr.syncOrders(s.id);
    expect(r.orders[1].dwell).toBe(777);
  });
  it('時刻表の自動作成(オートフィル): 全オーダーが時刻指定になり、周期が決まる', () => {
    const { tr, r } = threeStops();
    expect(tr.autoTimetable(r.id, 6 * 600)).toBe(true);
    expect(r.orders.every((o) => o.kind === 'timed')).toBe(true);
    const tods = r.orders.map((o) => o.departTod);
    expect(tods[1]).toBeGreaterThan(tods[0]);
    expect(tods[2]).toBeGreaterThan(tods[1]);
    expect(r.period).toBeGreaterThan(0);
  });
  it('共有オーダーはセーブで保たれる(JSON往復)', () => {
    const { tr, r } = threeStops();
    const s = tr.shareRoute(r.id)!;
    r.orders[0].cond = { kind: 'wait', op: 'lt', value: 10, to: 2 };
    tr.syncOrders(r.id);
    const json = JSON.parse(JSON.stringify(tr.save()));
    const { map } = setup();
    const t2 = new Transit(map);
    t2.restore(json);
    expect(t2.routes.get(s.id)?.shared).toBe(r.shared);
    expect(t2.routes.get(s.id)?.orders[0].cond).toEqual({ kind: 'wait', op: 'lt', value: 10, to: 2 });
  });
});

describe('オーダーの編集と実測オートフィル', () => {
  function four() {
    const { map, tr } = setup();
    for (const x of [18, 19, 28, 29]) map.building.set(map.idx(x, 11), 3);
    const a = tr.addStop(7, 10)!;
    const b = tr.addStop(20, 10)!;
    const c = tr.addStop(30, 10)!;
    const d = tr.addStop(36, 10)!;
    const r = tr.addRoute([a.id, b.id, c.id])!;
    return { tr, a, b, c, d, r };
  }
  it('挿入: 番号以降がずれ、車両のオーダー番号と条件の飛び先が付け替わる。共有路線にも反映', () => {
    const { tr, d, r, a, b, c } = four();
    const s = tr.shareRoute(r.id)!;
    r.orders[0].cond = { kind: 'wait', op: 'ge', value: 0, to: 2 };
    tr.syncOrders(r.id);
    tr.addVehicle(r.id, 0);
    const v = tr.vehicles[0];
    v.order = 2;
    expect(tr.insertOrder(r.id, 1, d.id).ok).toBe(true);
    expect(r.orders.map((o) => o.stopId)).toEqual([a.id, d.id, b.id, c.id]);
    expect(s.orders.map((o) => o.stopId)).toEqual([a.id, d.id, b.id, c.id]);
    expect(v.order).toBe(3); // 同じ停留所 c を指したまま
    expect(r.orders[0].cond!.to).toBe(3);
  });
  it('並べ替えと削除: 移動で番号が入れ替わり、車両がいるオーダーは削除不可、2駅未満にはできない', () => {
    const { tr, r, a, b, c } = four();
    tr.addVehicle(r.id, 0);
    const v = tr.vehicles[0];
    v.order = 1;
    expect(tr.moveOrder(r.id, 1, 1).ok).toBe(true);
    expect(r.orders.map((o) => o.stopId)).toEqual([a.id, c.id, b.id]);
    expect(v.order).toBe(2); // b を指したまま
    expect(tr.moveOrder(r.id, 0, -1).ok).toBe(false);
    expect(tr.removeOrder(r.id, 2).ok).toBe(false); // 車両が向かっている
    v.order = 0;
    expect(tr.removeOrder(r.id, 2).ok).toBe(true);
    expect(r.orders).toHaveLength(2);
    expect(tr.removeOrder(r.id, 0).ok).toBe(false); // 2駅未満
  });
  it('実測: 走行した区間が記録され、時刻表の自動作成に使われる', () => {
    const { tr, r } = four();
    tr.addVehicle(r.id, 0);
    for (let t = 0; t < 4000; t++) tr.step(t);
    expect(r.legMeasured && r.legMeasured[0] > 0).toBe(true);
    const measured = r.legMeasured![0];
    r.legMeasured![0] = 3000; // 実測値を差し替えると、時刻表の間隔に反映される
    expect(tr.autoTimetable(r.id, 0)).toBe(true);
    expect(r.orders[1].departTod - r.orders[0].departTod).toBeGreaterThan(3000);
    expect(measured).toBeLessThan(3000);
  });
});
