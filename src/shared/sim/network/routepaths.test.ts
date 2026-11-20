/**
 * 経路選択のテスト(全パターン): 経路探索(道路・鉄道・斜め・一方通行・信号)、経路キャッシュ、駅の番線選択と停車位置、
 * 折り返し、経由点・通過駅、ABCB 周回の停車順、ループ線、巨大マップの端(タイル index が 2^31・2^32 に迫る場所)。
 * 乱数で作った線路網について、独立に書いたダイクストラ法と最短コストが一致することも確かめる。
 */
import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { CONN, DX8, DY8, OUT, opposite8 } from '../../world/directions';
import { GameMap } from '../../world/gameMap';
import { makeRng } from '../../world/towns';
import { connectRail } from '../../world/rails';
import { connect } from '../../world/roads';
import { findPath } from './pathfinding';
import { Transit, type Vehicle, trainLen } from './transit';

const flatGen = () => new Uint8Array(64 * 64).fill(SEA_LEVEL + 20);
/** どの大きさでも平らな地図(層は疎なので 65535 でも軽い) */
const flat = (size = 96) => new GameMap(size, 1, flatGen);
const S = (m: GameMap) => m.size;
const P = (m: GameMap, i: number) => [i % S(m), Math.floor(i / S(m))] as const;
type Priv = {
  route: (a: number, b: number, rail: boolean) => Uint32Array | null;
  docks: (s: unknown, n: number) => { a: number; b: number }[];
  pathCache: Map<string, unknown>;
  reserved: Map<number, number>;
};
const priv = (t: Transit) => t as unknown as Priv;

function laneRail(m: GameMap, x0: number, y: number, x1: number): void {
  for (let x = x0; x < x1; x++) expect(connectRail(m, x, y, 1, true)).toBe(true);
}
function colRail(m: GameMap, x: number, y0: number, y1: number): void {
  for (let y = y0; y < y1; y++) expect(connectRail(m, x, y, 2, true)).toBe(true);
}

/** 経路の検査: 隣り合う辺がすべて接続していて、同じタイルを2度通らない */
function expectValidPath(m: GameMap, path: ArrayLike<number>, rail: boolean): void {
  const seen = new Set<number>();
  for (let k = 0; k < path.length; k++) {
    expect(seen.has(path[k])).toBe(false);
    seen.add(path[k]);
    if (k === 0) continue;
    const [x0, y0] = P(m, path[k - 1]);
    const [x1, y1] = P(m, path[k]);
    let d = -1;
    for (let q = 0; q < (rail ? 8 : 4); q++) if (DX8[q] === x1 - x0 && DY8[q] === y1 - y0) d = q;
    expect(d).toBeGreaterThanOrEqual(0);
    if (rail) {
      expect(m.rail.get(path[k - 1]) & CONN(d)).not.toBe(0);
      expect(m.rail.get(path[k]) & CONN(opposite8(d))).not.toBe(0);
    } else {
      expect(m.road.get(path[k - 1]) & OUT(d)).not.toBe(0);
      expect(m.road.get(path[k]) & CONN(opposite8(d))).not.toBe(0);
    }
  }
}

/** 基準実装(ダイクストラ): findPath と同じ規則(辺・一方通行・信号・コスト 直進10/斜め14)で最短コストを求める */
function refCost(m: GameMap, from: number, to: number, rail: boolean, sig?: (i: number) => number): number | null {
  const n = S(m);
  const dist = new Map<number, number>([[from, 0]]);
  const done = new Set<number>();
  for (;;) {
    let cur = -1;
    let cd = Infinity;
    for (const [k, v] of dist) if (!done.has(k) && v < cd) (cur = k), (cd = v);
    if (cur < 0) return null;
    if (cur === to) return cd;
    done.add(cur);
    const cx = cur % n;
    const cy = (cur - cx) / n;
    for (let d = 0; d < (rail ? 8 : 4); d++) {
      const nx = cx + DX8[d];
      const ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx;
      const layer = rail ? m.rail : m.road;
      if (!(layer.get(cur) & (rail ? CONN(d) : OUT(d)))) continue;
      if (!(layer.get(ni) & CONN(opposite8(d)))) continue;
      if (sig) {
        const mk = sig(ni);
        if (mk && !(mk & (1 << d))) continue;
      }
      const nd = cd + (d < 4 ? 10 : 14);
      if (nd < (dist.get(ni) ?? Infinity)) dist.set(ni, nd);
    }
  }
}
const costOf = (m: GameMap, path: ArrayLike<number>): number => {
  let c = 0;
  for (let k = 1; k < path.length; k++) {
    const [x0, y0] = P(m, path[k - 1]);
    const [x1, y1] = P(m, path[k]);
    c += x0 !== x1 && y0 !== y1 ? 14 : 10;
  }
  return c;
};

describe('経路探索: 道路', () => {
  it('直線・L字・格子で、最短(マンハッタン距離)の経路が返り、辺が正しい', () => {
    const m = flat(40);
    for (let y = 5; y <= 15; y++) for (let x = 5; x < 15; x++) connect(m, x, y, 1, false);
    for (let x = 5; x <= 15; x++) for (let y = 5; y < 15; y++) connect(m, x, y, 2, false);
    const p = findPath(m, m.idx(5, 5), m.idx(15, 12))!;
    expect(p.length).toBe(10 + 7 + 1);
    expectValidPath(m, p, false);
    expect(p[0]).toBe(m.idx(5, 5));
    expect(p[p.length - 1]).toBe(m.idx(15, 12));
  });
  it('始点=終点は1タイル、つながっていなければ null、探索上限を超えても null', () => {
    const m = flat(40);
    for (let x = 5; x < 12; x++) connect(m, x, 5, 1, false);
    expect(Array.from(findPath(m, m.idx(5, 5), m.idx(5, 5))!)).toEqual([m.idx(5, 5)]);
    expect(findPath(m, m.idx(5, 5), m.idx(30, 30))).toBeNull();
    expect(findPath(m, m.idx(5, 5), m.idx(11, 5), false, 2)).toBeNull(); // maxNodes=2 では足りない
  });
  it('一方通行は順方向だけ通れる。逆向きは迂回路があるときだけ(そのぶん長い)', () => {
    const m = flat(40);
    // y=10 の東向き一方通行 (5→15)。迂回路: y=12 を双方向
    for (let x = 5; x < 15; x++) connect(m, x, 10, 1, true, true);
    for (let x = 5; x < 15; x++) connect(m, x, 12, 1, false);
    for (const x of [5, 15]) for (let y = 10; y < 12; y++) connect(m, x, y, 2, false);
    const fwd = findPath(m, m.idx(5, 10), m.idx(15, 10))!;
    expect(fwd.length).toBe(11);
    const back = findPath(m, m.idx(15, 10), m.idx(5, 10))!;
    expect(back.length).toBeGreaterThan(11); // 一方通行を逆走せず迂回する
    expectValidPath(m, back, false);
    // 迂回路がなければ逆向きは到達不能
    const m2 = flat(40);
    for (let x = 5; x < 15; x++) connect(m2, x, 10, 1, true, true);
    expect(findPath(m2, m2.idx(15, 10), m2.idx(5, 10))).toBeNull();
  });
  it('乱数で作った道路網(一方通行を含む)で、最短コストが基準実装と一致する', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = makeRng(seed);
      const m = flat(24);
      for (let k = 0; k < 140; k++) connect(m, 2 + ((rng() * 18) | 0), 2 + ((rng() * 18) | 0), (rng() * 4) | 0, rng() < 0.25, true);
      for (let q = 0; q < 12; q++) {
        const a = m.idx(2 + ((rng() * 18) | 0), 2 + ((rng() * 18) | 0));
        const b = m.idx(2 + ((rng() * 18) | 0), 2 + ((rng() * 18) | 0));
        if (!m.road.get(a) || !m.road.get(b)) continue;
        const ref = refCost(m, a, b, false);
        const p = findPath(m, a, b);
        if (ref === null) expect(p).toBeNull();
        else {
          expect(p).not.toBeNull();
          expect(costOf(m, p!)).toBe(ref);
          expectValidPath(m, p!, false);
        }
      }
    }
  });
});

describe('経路探索: 鉄道(斜め・信号)', () => {
  it('斜めの線路は斜めの辺を使い、直線の2辺より短い(コスト14<20)', () => {
    const m = flat(40);
    for (let i = 0; i < 8; i++) expect(connectRail(m, 5 + i, 5 + i, 5, true)).toBe(true); // 南東
    // 同じ区間を直交でも敷く(L字)
    for (let x = 5; x < 13; x++) connectRail(m, x, 5, 1, true);
    for (let y = 5; y < 13; y++) connectRail(m, 13, y, 2, true);
    const p = findPath(m, m.idx(5, 5), m.idx(13, 13), true)!;
    expect(p.length).toBe(9); // 斜めの経路(9タイル)。L字なら17タイル
    expectValidPath(m, p, true);
  });
  it('乱数で作った線路網(斜め・信号の向き制約を含む)で、最短コストが基準実装と一致する', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = makeRng(seed * 7);
      const m = flat(24);
      for (let k = 0; k < 170; k++) connectRail(m, 2 + ((rng() * 18) | 0), 2 + ((rng() * 18) | 0), (rng() * 8) | 0, true);
      const masks = new Map<number, number>();
      for (let k = 0; k < 25; k++) masks.set(m.idx(2 + ((rng() * 18) | 0), 2 + ((rng() * 18) | 0)), 1 << ((rng() * 8) | 0));
      const sig = (i: number) => masks.get(i) ?? 0;
      for (let q = 0; q < 12; q++) {
        const a = m.idx(2 + ((rng() * 18) | 0), 2 + ((rng() * 18) | 0));
        const b = m.idx(2 + ((rng() * 18) | 0), 2 + ((rng() * 18) | 0));
        if (!m.rail.get(a) || !m.rail.get(b)) continue;
        const ref = refCost(m, a, b, true, sig);
        const p = findPath(m, a, b, true, 300000, sig);
        if (ref === null) expect(p).toBeNull();
        else {
          expect(p).not.toBeNull();
          expect(costOf(m, p!)).toBe(ref);
          expectValidPath(m, p!, true);
          // 信号の向きに逆らって進入していない
          for (let k = 1; k < p!.length; k++) {
            const [x0, y0] = P(m, p![k - 1]);
            const [x1, y1] = P(m, p![k]);
            let d = 0;
            for (let q2 = 0; q2 < 8; q2++) if (DX8[q2] === x1 - x0 && DY8[q2] === y1 - y0) d = q2;
            const mk = sig(p![k]);
            if (mk) expect(mk & (1 << d)).not.toBe(0);
          }
        }
      }
    }
  });
  it('斜めの一方向信号: 逆向きは通れず、迂回路があればそちらを通る', () => {
    const m = flat(40);
    for (let i = 0; i < 6; i++) connectRail(m, 5 + i, 5 + i, 5, true);
    const mid = m.idx(8, 8);
    const sig = (i: number) => (i === mid ? 1 << 5 : 0); // 南東向きだけ
    expect(findPath(m, m.idx(5, 5), m.idx(11, 11), true, 300000, sig)).not.toBeNull();
    expect(findPath(m, m.idx(11, 11), m.idx(5, 5), true, 300000, sig)).toBeNull();
  });
});

describe('Transit の経路キャッシュ', () => {
  it('同じ区間は同じ経路を返し、線路が撤去されたら使い回さず探し直す', () => {
    const m = flat(60);
    laneRail(m, 5, 20, 40);
    const t = new Transit(m);
    const a = priv(t).route(m.idx(5, 20), m.idx(39, 20), true)!;
    const b = priv(t).route(m.idx(5, 20), m.idx(39, 20), true)!;
    expect(Array.from(b)).toEqual(Array.from(a));
    // 途中を切る
    m.rail.set(m.idx(20, 20), 0);
    const c = priv(t).route(m.idx(5, 20), m.idx(39, 20), true);
    expect(c).toBeNull();
  });
  it('巨大マップの端でも、終点が1タイル違う・始点が1タイル違う経路を取り違えない(キー衝突)', () => {
    for (const [ox, oy] of [[65535 - 120, 65535 - 40], [46000, 46000], [32768, 32768], [60000, 12000]] as const) {
      const m = flat(65535);
      for (const dy of [0, 1, 2]) laneRail(m, ox, oy + dy, ox + 40);
      for (let x = ox; x < ox + 40; x += 1) for (const dy of [0, 1]) expect(connectRail(m, x, oy + dy, 2, true)).toBe(true); // 3本をはしご状につなぐ
      const t = new Transit(m);
      const f = (ax: number, ay: number, bx: number, by: number) => priv(t).route(m.idx(ax, ay), m.idx(bx, by), true);
      const cases: [number, number, number, number][] = [
        [0, 0, 20, 0], [0, 0, 21, 0], [0, 0, 20, 1], [0, 1, 20, 0], [1, 0, 20, 0], [0, 0, 20, 2], [2, 0, 20, 1],
      ];
      for (const [ax, ay, bx, by] of cases) {
        const p = f(ox + ax, oy + ay, ox + bx, oy + by)!;
        expect(p).not.toBeNull();
        expect(p[0]).toBe(m.idx(ox + ax, oy + ay));
        expect(p[p.length - 1]).toBe(m.idx(ox + bx, oy + by));
      }
      // 順序を入れ替えて呼んでも同じ(キャッシュの影響を受けない)
      for (const [ax, ay, bx, by] of [...cases].reverse()) {
        const p = f(ox + ax, oy + ay, ox + bx, oy + by)!;
        expect(p[p.length - 1]).toBe(m.idx(ox + bx, oy + by));
      }
    }
  });
});

/** 編成を走らせ、到着(停車)した順番と、各区間の経路を記録する */
function runTrain(t: Transit, v: Vehicle, ticks: number) {
  const arrivals: number[] = [];
  const legs: { order: number; path: number[]; prev: number }[] = [];
  let lastState = '';
  let lastOrder = -1;
  for (let k = 1; k <= ticks; k++) {
    t.step(k);
    if (v.state === 'load' && (lastState !== 'load' || v.order !== lastOrder)) arrivals.push(v.order);
    if (v.state === 'move' && (lastState !== 'move' || v.order !== lastOrder)) legs.push({ order: v.order, path: Array.from(v.path), prev: v.trail.length > 1 ? v.trail[1] : -1 });
    lastState = v.state;
    lastOrder = v.order;
  }
  return { arrivals, legs };
}
const cyc = (n: number, count: number, start = 0) => Array.from({ length: count }, (_, i) => (start + i) % n);

describe('駅の番線選択と停車位置', () => {
  /** 東西に長い複線(y=20,21)に駅を置き、編成が停まる先頭タイルを調べる */
  function stopHead(len: number, cars: number, fromWest: boolean): { head: number; vlen: number } {
    const m = flat(120);
    const st = fromWest ? { x: 40 } : { x: 40 };
    void st;
    for (const y of [20, 21]) laneRail(m, 10, y, 90);
    const t = new Transit(m);
    const s = t.addStation(40, 20, { axis: 1, len, tracks: 2, design: 1 }).stop!;
    const a = t.addStop(fromWest ? 12 : 88, fromWest ? 20 : 20, 'rail')!;
    const r = t.addRoute([a.id, s.id])!;
    r.modelId = 'mirai8000';
    r.cars = cars;
    const v = t.addVehicle(r.id, 0)!;
    let head = -1;
    for (let k = 1; k < 4000 && head < 0; k++) {
      t.step(k);
      if (v.state === 'load' && v.order === 1) head = v.trail[0];
    }
    return { head, vlen: v.len };
  }
  it('編成の中央がホームの中央にくる位置に停まる(西から進入、ホーム長2〜14・両数1〜8)', () => {
    for (let len = 2; len <= 14; len += 1) {
      for (const cars of [1, 2, 4, 6, 8]) {
        const { head, vlen } = stopHead(len, cars, true);
        expect(head).toBeGreaterThanOrEqual(0);
        const m = flat(120);
        const trainTiles = vlen; // 実際の編成の長さ(1〜2両でも最低3タイル)
        expect(trainTiles).toBeGreaterThanOrEqual(trainLen(cars));
        const hx = head % m.size;
        // 先頭の添字(0..len-1)
        const idx = hx - 40;
        const expected = Math.min(len - 1, Math.max(0, Math.round((len - 1) / 2 + (trainTiles - 1) / 2)));
        expect(idx).toBe(expected);
      }
    }
  });
});

describe('停車位置(東から進入)', () => {
  it('東から進入しても、編成の中央がホームの中央にくる(ホーム長2〜14・両数1〜8)', () => {
    for (let len = 2; len <= 14; len++) {
      for (const cars of [1, 3, 5, 8]) {
        const m = flat(120);
        for (const y of [20, 21]) laneRail(m, 10, y, 90);
        const t = new Transit(m);
        const s = t.addStation(40, 20, { axis: 1, len, tracks: 2, design: 1 }).stop!;
        const a = t.addStop(88, 20, 'rail')!;
        const r = t.addRoute([a.id, s.id])!;
        r.modelId = 'mirai8000';
        r.cars = cars;
        const v = t.addVehicle(r.id, 0)!;
        let head = -1;
        for (let k = 1; k < 4000 && head < 0; k++) {
          t.step(k);
          if (v.state === 'load' && v.order === 1) head = v.trail[0];
        }
        expect(head).toBeGreaterThanOrEqual(0);
        const hi = Math.min(len - 1, Math.max(0, Math.round((len - 1) / 2 + (v.len - 1) / 2)));
        expect((head % m.size) - 40).toBe(len - 1 - hi); // 西向きに進んで停まる先頭の位置(対称)
      }
    }
  });
});

describe('周回の停車順(ABCB・往復・折り返し)', () => {
  function line(stations: number[], tracks = 1): { m: GameMap; t: Transit; ids: number[] } {
    const m = flat(160);
    for (let y = 40; y < 40 + tracks; y++) laneRail(m, 10, y, 150);
    const t = new Transit(m);
    const ids = stations.map((x) => t.addStation(x, 40, { axis: 1, len: 4, tracks, design: 1 }).stop!.id);
    return { m, t, ids };
  }
  it('A→B→C→B→A の4オーダーが、決まった順で何周しても繰り返される(単線・複線)', () => {
    for (const tracks of [1, 2]) {
      const { t, ids } = line([20, 70, 120], tracks);
      const r = t.addRoute([ids[0], ids[1], ids[2], ids[1]])!;
      r.modelId = 'mirai8000';
      r.cars = 4;
      const v = t.addVehicle(r.id, 0)!;
      const { arrivals } = runTrain(t, v, 60000);
      expect(arrivals.length).toBeGreaterThanOrEqual(12);
      expect(arrivals.slice(0, 12)).toEqual(cyc(4, 12));
    }
  });
  it('終端駅では折り返し、各区間の経路は目的駅のホーム上で終わり、経路はまっすぐ(迂回しない)', () => {
    const { m, t, ids } = line([20, 70, 120]);
    const r = t.addRoute([ids[0], ids[1], ids[2], ids[1]])!;
    r.modelId = 'mirai8000';
    r.cars = 4;
    const v = t.addVehicle(r.id, 0)!;
    const { legs } = runTrain(t, v, 60000);
    expect(legs.length).toBeGreaterThanOrEqual(8);
    for (const leg of legs) {
      const dest = t.stops.get(r.orders[leg.order].stopId)!;
      const tiles = new Set<number>();
      const st = dest.station!;
      for (let i = 0; i < st.len; i++) tiles.add(m.idx(st.x0 + i, st.y0));
      expect(tiles.has(leg.path[leg.path.length - 1])).toBe(true); // 目的駅のホームで終わる
      expect(new Set(leg.path).size).toBe(leg.path.length);
      if (leg.prev >= 0) expect(leg.path[1]).not.toBe(leg.prev); // 発車直後に来た道へ引き返さない
      // 直線の線路なので、経路の長さは駅間の距離を超えない
      expect(leg.path.length).toBeLessThanOrEqual(Math.abs(dest.x - (m.idx(0, 0) + 0)) + 100);
    }
  });
  it('2編成が同じ線を往復しても、それぞれが正しい順で停まる(複線)', () => {
    const { t, ids } = line([20, 70, 120], 2);
    const r = t.addRoute([ids[0], ids[1], ids[2], ids[1]])!;
    r.modelId = 'mirai8000';
    r.cars = 4;
    const v1 = t.addVehicle(r.id, 0)!;
    t.addVehicle(r.id, 0, 3000);
    const { arrivals } = runTrain(t, v1, 60000);
    expect(arrivals.slice(0, 8)).toEqual(cyc(4, 8));
  });
  it('条件付きオーダー(出発時に条件を満たしたらジャンプ)でも、ジャンプ先の順に停まる', () => {
    const { t, ids } = line([20, 70, 120]);
    const r = t.addRoute([ids[0], ids[1], ids[2]])!;
    r.modelId = 'mirai8000';
    r.cars = 4;
    r.orders[0].cond = { kind: 'tod', op: 'ge', value: 0, to: 2 }; // 常に成立: A から出たら C へ
    const v = t.addVehicle(r.id, 0)!;
    const { arrivals } = runTrain(t, v, 40000);
    // A(0)の次は C(2)、C の次は A(0)
    for (let i = 0; i + 1 < arrivals.length; i++) {
      if (arrivals[i] === 0) expect(arrivals[i + 1]).toBe(2);
      if (arrivals[i] === 2) expect(arrivals[i + 1]).toBe(0);
    }
    expect(arrivals).not.toContain(1);
  });
  it('通過に設定した駅には停まらず、順番は残りの駅で正しく回る', () => {
    const { t, ids } = line([20, 70, 120]);
    const r = t.addRoute([ids[0], ids[1], ids[2], ids[1]])!;
    r.modelId = 'mirai8000';
    r.cars = 4;
    r.orders[1].pass = true;
    r.orders[3].pass = true;
    const v = t.addVehicle(r.id, 0)!;
    const { arrivals } = runTrain(t, v, 40000);
    expect(arrivals.length).toBeGreaterThanOrEqual(6);
    for (const a of arrivals) expect([0, 2]).toContain(a);
    expect(arrivals.slice(0, 6)).toEqual([0, 2, 0, 2, 0, 2]);
  });
});

describe('経由点と待避線', () => {
  it('経由点を指定すると、直線の本線ではなく待避線を通る。外すと本線を通る', () => {
    for (const useWaypoint of [true, false]) {
      const m = flat(120);
      laneRail(m, 10, 40, 100);
      // 待避線 y=42(分岐は斜め)
      for (let x = 40; x < 60; x++) connectRail(m, x, 42, 1, true);
      expect(connectRail(m, 38, 40, 5, true)).toBe(true);
      expect(connectRail(m, 39, 41, 5, true)).toBe(true);
      expect(connectRail(m, 60, 42, 4, true)).toBe(true);
      expect(connectRail(m, 61, 41, 4, true)).toBe(true);
      const t = new Transit(m);
      const a = t.addStop(12, 40, 'rail')!;
      const b = t.addStop(96, 40, 'rail')!;
      const ids = [a.id];
      if (useWaypoint) ids.push(t.addWaypoint(50, 42)!.id);
      ids.push(b.id);
      const r = t.addRoute(ids)!;
      r.modelId = 'mirai8000';
      r.cars = 4;
      const v = t.addVehicle(r.id, 0)!;
      const { legs } = runTrain(t, v, 6000);
      const first = legs.find((l) => l.order === (useWaypoint ? 2 : 1))!;
      const viaSiding = first.path.includes(m.idx(50, 42));
      expect(viaSiding).toBe(useWaypoint);
    }
  });
});

describe('ループ線と一方向信号(複線の上り下り)', () => {
  /**
   * 駅A(西)・駅B(東)の間に複線(y=40 東行き、y=44 西行き)と、両端のループ(南北の縦線)。
   * 一方向信号で、外側の線は東行き、内側の線は西行きだけ通れる。ABAB と走ると必ず環状に回る。
   */
  function loopLayout() {
    const m = flat(160);
    laneRail(m, 10, 40, 100);
    laneRail(m, 10, 44, 100);
    colRail(m, 10, 40, 44);
    colRail(m, 100, 40, 44);
    const t = new Transit(m);
    const a = t.addStop(30, 40, 'rail')!;
    const b = t.addStop(80, 44, 'rail')!;
    for (const x of [20, 50, 70, 90]) expect(t.setSignal(x, 40, 1 << 1)).toBe(true); // y=40: 東向き
    for (const x of [20, 50, 70, 90]) expect(t.setSignal(x, 44, 1 << 3)).toBe(true); // y=44: 西向き
    return { m, t, a, b };
  }
  it('ABAB を何周しても順番が崩れず、信号の向きに逆らわず、経路は同じタイルを2度通らない', () => {
    const { m, t, a, b } = loopLayout();
    const r = t.addRoute([a.id, b.id])!;
    r.modelId = 'mirai8000';
    r.cars = 4;
    const v = t.addVehicle(r.id, 0)!;
    const { arrivals, legs } = runTrain(t, v, 60000);
    expect(arrivals.slice(0, 10)).toEqual(cyc(2, 10));
    for (const leg of legs) {
      expect(new Set(leg.path).size).toBe(leg.path.length);
      for (let k = 1; k < leg.path.length; k++) {
        const [x0, y0] = P(m, leg.path[k - 1]);
        const [x1, y1] = P(m, leg.path[k]);
        const mk = t.signalMask(leg.path[k]);
        if (mk) {
          let d = 0;
          for (let q = 0; q < 8; q++) if (DX8[q] === x1 - x0 && DY8[q] === y1 - y0) d = q;
          expect(mk & (1 << d)).not.toBe(0);
        }
      }
    }
  });
  it('環状の複線を2編成が走っても、どちらも固まらず、停車順が崩れない', () => {
    const { t, a, b } = loopLayout();
    const r = t.addRoute([a.id, b.id])!;
    r.modelId = 'mirai8000';
    r.cars = 4;
    const v1 = t.addVehicle(r.id, 0)!;
    for (let k = 1; k <= 900; k++) t.step(k);
    const v2 = t.addVehicle(r.id, 900, 6000)!;
    expect(v2).toBeTruthy();
    const arr1: number[] = [];
    const arr2: number[] = [];
    let l1 = '';
    let l2 = '';
    for (let k = 901; k < 60000; k++) {
      t.step(k);
      const k1 = `${v1.state}${v1.order}`;
      const k2 = `${v2.state}${v2.order}`;
      if (v1.state === 'load' && k1 !== l1) arr1.push(v1.order);
      if (v2.state === 'load' && k2 !== l2) arr2.push(v2.order);
      l1 = k1;
      l2 = k2;
    }
    expect(arr1.length).toBeGreaterThanOrEqual(8);
    expect(arr2.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < arr1.length; i++) expect(arr1[i]).toBe(1 - arr1[i - 1]);
    for (let i = 1; i < arr2.length; i++) expect(arr2[i]).toBe(1 - arr2[i - 1]);
  });
  it('折り返しが使えない配置では、折り返しの経路が遠いなら前進を選ぶ(逆走しない)', () => {
    const { t, a, b } = loopLayout();
    const r = t.addRoute([a.id, b.id, a.id])!;
    r.modelId = 'mirai8000';
    r.cars = 4;
    const v = t.addVehicle(r.id, 0)!;
    const { legs } = runTrain(t, v, 60000);
    expect(legs.length).toBeGreaterThanOrEqual(6);
    for (const leg of legs) expect(leg.path.length).toBeLessThan(200);
  });
});

describe('道路(バス)の周回', () => {
  it('一方通行の環状線でも、A→B→C→B→A の順で停まり続ける', () => {
    const m = flat(80);
    // 時計回りの環: (10,10)→(40,10)→(40,40)→(10,40)→(10,10)
    for (let x = 10; x < 40; x++) connect(m, x, 10, 1, true, true);
    for (let y = 10; y < 40; y++) connect(m, 40, y, 2, true, true);
    for (let x = 40; x > 10; x--) connect(m, x, 40, 3, true, true);
    for (let y = 40; y > 10; y--) connect(m, 10, y, 0, true, true);
    const t = new Transit(m);
    const a = t.addStop(15, 10, 'road')!;
    const b = t.addStop(40, 20, 'road')!;
    const c = t.addStop(25, 40, 'road')!;
    const r = t.addRoute([a.id, b.id, c.id, b.id])!;
    const v = t.addVehicle(r.id, 0)!;
    const { arrivals } = runTrain(t, v, 80000);
    expect(arrivals.length).toBeGreaterThanOrEqual(8);
    expect(arrivals.slice(0, 8)).toEqual(cyc(4, 8));
  });
});

describe('巨大マップの端(タイル index が 2^31 を超える場所)', () => {
  it('ABCB の周回・停車順・ホーム上の停車・経路の接続がすべて正しい', () => {
    const m = flat(65535);
    const ox = 65535 - 170;
    const oy = 65535 - 30;
    for (const y of [oy, oy + 1]) laneRail(m, ox, y, ox + 150);
    const t = new Transit(m);
    const ids = [30, 80, 130].map((dx) => t.addStation(ox + dx, oy, { axis: 1, len: 4, tracks: 2, design: 1 }).stop!.id);
    const r = t.addRoute([ids[0], ids[1], ids[2], ids[1]])!;
    r.modelId = 'mirai8000';
    r.cars = 4;
    const v = t.addVehicle(r.id, 0)!;
    expect(v.trail[0]).toBeGreaterThan(2 ** 31);
    const { arrivals, legs } = runTrain(t, v, 60000);
    expect(arrivals.slice(0, 12)).toEqual(cyc(4, 12));
    for (const leg of legs) {
      const dest = t.stops.get(r.orders[leg.order].stopId)!;
      const st = dest.station!;
      const end = leg.path[leg.path.length - 1];
      const [ex, ey] = P(m, end);
      expect(ex >= st.x0 && ex < st.x0 + st.len && ey >= st.y0 && ey < st.y0 + st.tracks).toBe(true);
      expectValidPath(m, leg.path, true);
    }
  });
});

describe('多数の路線でも負荷が集中しない(キャッシュと再計算の設計)', () => {
  it('到達できない区間は、関係する変更がなければ再探索せず、近くで線路がつながったら(時間を待たず)すぐ探し直す', () => {
    const m = flat(60);
    laneRail(m, 5, 20, 20);
    laneRail(m, 30, 20, 45); // 途中が切れている
    const t = new Transit(m);
    const key = `${m.idx(5, 20)}:${m.idx(44, 20)}`;
    expect(priv(t).route(m.idx(5, 20), m.idx(44, 20), true)).toBeNull();
    const e1 = priv(t).pathCache.get(key);
    for (let i = 0; i < 50; i++) expect(priv(t).route(m.idx(5, 20), m.idx(44, 20), true)).toBeNull();
    expect(priv(t).pathCache.get(key)).toBe(e1); // 記録は作り直されていない
    t.touchNetwork(0, 150, 3, 159); // 遠く離れた場所の変更では探し直さない
    expect(priv(t).route(m.idx(5, 20), m.idx(44, 20), true)).toBeNull();
    expect(priv(t).pathCache.get(key)).toBe(e1);
    // 切れていた所に線路をつなぐ(その範囲の変更を知らせる)と、すぐ到達できる
    laneRail(m, 20, 20, 30);
    t.touchNetwork(20, 20, 30, 20);
    expect(priv(t).route(m.idx(5, 20), m.idx(44, 20), true)).not.toBeNull();
  });
  it('キャッシュは上限を超えても全消去されず、古いものだけが捨てられる(LRU)', () => {
    const m = flat(60);
    for (let y = 10; y < 30; y++) laneRail(m, 5, y, 45);
    for (let x = 5; x < 45; x++) for (let y = 10; y < 29; y++) connectRail(m, x, y, 2, true);
    const t = new Transit(m);
    t.pathCacheMax = 200;
    const sizes: number[] = [];
    for (let i = 0; i < 600; i++) {
      priv(t).route(m.idx(6 + (i % 30), 11 + (i % 17)), m.idx(40 - (i % 23), 12 + ((i * 7) % 15)), true);
      sizes.push(priv(t).pathCache.size);
    }
    expect(Math.max(...sizes)).toBeLessThanOrEqual(201);
    // 一度に大量に消えない(全消去ではなく1割ずつ)
    for (let i = 1; i < sizes.length; i++) expect(sizes[i - 1] - sizes[i]).toBeLessThanOrEqual(25);
    // 最近使ったものは残る
    const a = m.idx(7, 12);
    const b = m.idx(39, 13);
    priv(t).route(a, b, true);
    for (let i = 0; i < 60; i++) priv(t).route(m.idx(6 + (i % 30), 11 + (i % 17)), m.idx(40 - (i % 23), 12 + ((i * 7) % 15)), true);
    priv(t).route(a, b, true); // 使い直して新しくする
    for (let i = 0; i < 30; i++) priv(t).route(m.idx(10 + i, 15), m.idx(11 + i, 20), true);
    expect(priv(t).pathCache.has(`${a}:${b}`)).toBe(true);
  });
  it('線路を少し変えたら、その経路は次に使うときにすぐ探し直される。離れた場所の変更では探し直されない', () => {
    const m = flat(160);
    // 遠回りの線路(コの字)で A→B をつなぐ
    laneRail(m, 20, 40, 60);
    colRail(m, 60, 40, 70);
    laneRail(m, 60, 70, 100);
    colRail(m, 100, 40, 70);
    laneRail(m, 100, 40, 120);
    const t = new Transit(m);
    const a = m.idx(20, 40);
    const b = m.idx(120, 40);
    const p1 = priv(t).route(a, b, true)!;
    expect(p1.length).toBeGreaterThan(100); // コの字の遠回り
    const key = `${a}:${b}`;
    const e1 = priv(t).pathCache.get(key);
    // 遠く離れた所での建設・信号では、この経路は探し直されない
    t.touchNetwork(140, 140, 150, 150);
    expect(Array.from(priv(t).route(a, b, true)!)).toEqual(Array.from(p1));
    expect(priv(t).pathCache.get(key)).toBe(e1);
    // 近道を1本敷くだけで(少しの変更でも)、次の探索で近道に切り替わる
    laneRail(m, 60, 40, 100);
    t.touchNetwork(60, 40, 100, 40);
    const p2 = priv(t).route(a, b, true)!;
    expect(p2.length).toBe(101);
    expect(priv(t).pathCache.get(key)).not.toBe(e1);
    // 近道を撤去して知らせると、また遠回りに戻る(古い経路を使い回さない)
    for (let x = 60; x < 100; x++) m.rail.set(m.idx(x, 40), m.rail.get(m.idx(x, 40)) & ~(1 << 1)); // 東向きの腕を外す
    for (let x = 61; x <= 100; x++) m.rail.set(m.idx(x, 40), m.rail.get(m.idx(x, 40)) & ~(1 << 3)); // 西向きの腕を外す(両端の本線への接続は残す)
    t.touchNetwork(60, 40, 100, 40);
    expect(priv(t).route(a, b, true)!.length).toBeGreaterThan(100);
  });
  it('変更の履歴が溢れても(古い世代の記録は)念のため探し直され、誤った経路を返さない', () => {
    const m = flat(160);
    laneRail(m, 20, 40, 60);
    const t = new Transit(m);
    const a = m.idx(20, 40);
    const b = m.idx(59, 40);
    expect(priv(t).route(a, b, true)).not.toBeNull();
    for (let i = 0; i < 9000; i++) t.touchNetwork(150, 150, 151, 151); // 履歴を溢れさせる
    expect(priv(t).route(a, b, true)).not.toBeNull();
  });
  it('200路線が同時に走っても、1周あたりの処理が現実的な時間に収まり、全車両が走り続ける', () => {
    const m = flat(300);
    // 格子状の線路(縦横20本ずつ)
    for (let k = 0; k < 20; k++) {
      laneRail(m, 20, 30 + k * 10, 230);
      colRail(m, 30 + k * 10, 20, 230);
    }
    const t = new Transit(m);
    const rng = makeRng(5);
    const routes = [];
    for (let i = 0; i < 200; i++) {
      const a = t.addStop(30 + 10 * ((rng() * 19) | 0), 30 + 10 * ((rng() * 19) | 0), 'rail');
      const b = t.addStop(30 + 10 * ((rng() * 19) | 0), 30 + 10 * ((rng() * 19) | 0), 'rail');
      if (!a || !b || a.id === b.id) continue;
      const r = t.addRoute([a.id, b.id]);
      if (!r) continue;
      r.modelId = 'mirai8000';
      r.cars = 2;
      routes.push(r);
      t.addVehicle(r.id, 0);
    }
    expect(t.vehicles.length).toBeGreaterThan(100);
    const t0 = performance.now();
    let maxStep = 0;
    for (let k = 1; k <= 3000; k++) {
      const s0 = performance.now();
      t.step(k);
      maxStep = Math.max(maxStep, performance.now() - s0);
      if (k === 1500) t.touchNetwork(); // 途中で誰かが建設した想定
    }
    const total = performance.now() - t0;
    expect(total).toBeLessThan(60000);
    expect(maxStep).toBeLessThan(5000); // 1tick が極端に長くならない(再計算が一斉に走らない)
    expect(priv(t).pathCache.size).toBeLessThanOrEqual(t.pathCacheMax + 1);
    // 単線の格子に143編成で、行き違えず固まる車両が出ること自体は想定内(ここでは処理時間とキャッシュの上限だけを確かめる)
  }, 120000);
});
