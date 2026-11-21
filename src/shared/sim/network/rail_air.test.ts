import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { placeAirport } from '../../world/airports';
import { GameMap } from '../../world/gameMap';
import { connectRail } from '../../world/rails';
import { bulldoze, connect } from '../../world/roads';
import { Transit } from './transit';

function flat(size = 96): GameMap {
  return new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
}

describe('踏切', () => {
  it('直交する直線同士なら道路と線路が交差できる', () => {
    const m = flat();
    for (let x = 5; x < 15; x++) connect(m, x, 10, 1, false);
    // 縦の線路が道路を横切る
    for (let y = 5; y < 15; y++) expect(connectRail(m, 10, y, 2)).toBe(true);
    expect(m.road.get(m.idx(10, 10))).not.toBe(0);
    expect(m.rail.get(m.idx(10, 10))).not.toBe(0);
  });
  it('平行・分岐は不可', () => {
    const m = flat();
    for (let x = 5; x < 15; x++) connect(m, x, 10, 1, false);
    expect(connectRail(m, 10, 10, 1)).toBe(false); // 道路と同じ向き
    expect(connectRail(m, 9, 10, 1)).toBe(false);
    expect(connect(m, 10, 10, 2, false)).toBe(true); // 道路から枝分かれ(線路なし)は可
  });
  it('撤去で道路と線路の両方が消える', () => {
    const m = flat();
    connect(m, 5, 5, 1, false);
    connectRail(m, 5, 5, 2);
    bulldoze(m, 5, 5);
    expect(m.road.get(m.idx(5, 5)) | m.rail.get(m.idx(5, 5))).toBe(0);
  });
});

describe('鉄道', () => {
  function railLine(m: GameMap, y = 20, x0 = 5, x1 = 60) {
    for (let x = x0; x < x1; x++) connectRail(m, x, y, 1);
  }
  it('編成が往復し、折り返しても予約が漏れない', () => {
    const m = flat();
    railLine(m);
    for (const x of [8, 9, 56, 57]) m.building.set(m.idx(x, 21), 3); // 集客
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail')!;
    const b = tr.addStop(58, 20, 'rail')!;
    const r = tr.addRoute([a.id, b.id])!;
    r.modelId = 'mirai8000';
    r.cars = 6;
    const v = tr.addVehicle(r.id, 0)!;
    expect(v.trail.length).toBeGreaterThan(1);
    for (let t = 1; t < 12000; t++) tr.step(t);
    expect(tr.delivered).toBeGreaterThan(0);
    // 編成長を超えて予約タイルが増えていない(折り返しでの漏れ検査)
    const owned = [...(tr as unknown as { reserved: Map<number, number> }).reserved.values()].filter((id) => id === v.id).length;
    expect(owned).toBeLessThanOrEqual(v.len + 60);
  });
  it('単線で2編成が正面衝突しない(経路予約)', () => {
    const m = flat();
    railLine(m);
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail')!;
    const b = tr.addStop(58, 20, 'rail')!;
    const r = tr.addRoute([a.id, b.id])!;
    const v1 = tr.addVehicle(r.id, 0)!;
    const v2 = tr.addVehicle(r.id, 0);
    // 同じ駅からの2編成目は占有のため置けない
    expect(v2).toBeNull();
    for (let t = 1; t < 3000; t++) {
      tr.step(t);
      const heads = new Set(tr.vehicles.map((v) => v.trail[0]));
      expect(heads.size).toBe(tr.vehicles.length);
    }
    expect(v1.cap).toBeGreaterThan(0);
  });
  it('線路が撤去されると編成が消える', () => {
    const m = flat();
    railLine(m);
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail')!;
    const b = tr.addStop(58, 20, 'rail')!;
    const r = tr.addRoute([a.id, b.id])!;
    tr.addVehicle(r.id, 0);
    for (let t = 1; t < 200; t++) tr.step(t);
    for (let x = 20; x < 60; x++) bulldoze(m, x, 20);
    for (let t = 200; t < 1500; t++) tr.step(t);
    expect(tr.vehicles.length).toBe(0);
  });
});

describe('航空', () => {
  it('2空港間を飛行し乗客を運ぶ', () => {
    const m = flat();
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        // 空港の周囲に建物を置く
        m.building.set(m.idx(10 + i, 15 + j), 3);
      }
    const t1 = placeAirport(m, 10, 5)!;
    const t2 = placeAirport(m, 80, 70)!;
    expect(t1).toEqual({ x: 11, y: 5 });
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) m.building.set(m.idx(8 + i, 9 + j), 3);
    const tr = new Transit(m);
    const a = tr.addStop(t1.x, t1.y, 'air')!;
    const b = tr.addStop(t2.x, t2.y, 'air')!;
    const r = tr.addRoute([a.id, b.id])!;
    expect(r.mode).toBe('air');
    const v = tr.addVehicle(r.id, 0)!;
    let flew = false;
    for (let t = 1; t < 4000; t++) {
      tr.step(t);
      if (v.flight) flew = true;
    }
    expect(flew).toBe(true);
    expect(tr.delivered).toBeGreaterThan(0);
  });
  it('空港は平坦な空き地にのみ置ける', () => {
    const m = flat();
    m.building.set(m.idx(11, 11), 1);
    expect(placeAirport(m, 10, 10)).toBeNull();
    expect(placeAirport(m, 20, 20)).not.toBeNull();
    expect(placeAirport(m, 21, 21)).toBeNull(); // 重なり
  });
  it('異なる種別の停留所は同じ路線にできない', () => {
    const m = flat();
    connect(m, 5, 5, 1, false);
    placeAirport(m, 20, 20);
    const tr = new Transit(m);
    const a = tr.addStop(5, 5, 'road')!;
    const b = tr.addStop(21, 20, 'air')!;
    expect(tr.addRoute([a.id, b.id])).toBeNull();
  });
});

describe('斜め線路', () => {
  it('斜めに敷設でき、交差する斜めと道路との共存は不可', () => {
    const m = flat();
    expect(connectRail(m, 10, 10, 5)).toBe(true); // SE
    expect(m.rail.get(m.idx(10, 10)) & 32).toBe(32);
    expect(m.rail.get(m.idx(11, 11)) & 128).toBe(128); // 対側は NW
    expect(connectRail(m, 11, 10, 6)).toBe(false); // (11,10)→(10,11) は X 交差
    expect(connectRail(m, 11, 10, 2)).toBe(true); // 直進は可
    connect(m, 20, 20, 1, false);
    expect(connectRail(m, 20, 20, 5)).toBe(false); // 道路タイルに斜め線路は不可
  });
  it('斜めを含む線路を編成が往復し、撤去で斜め接続も消える', () => {
    const m = flat();
    for (let x = 5; x < 20; x++) connectRail(m, x, 20, 1);
    for (let i = 0; i < 10; i++) expect(connectRail(m, 20 + i, 20 + i, 5)).toBe(true);
    for (let x = 30; x < 50; x++) connectRail(m, x, 30, 1);
    for (const [x, y] of [
      [8, 21],
      [9, 21],
      [45, 31],
      [46, 31],
    ])
      m.building.set(m.idx(x, y), 3);
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail')!;
    const b = tr.addStop(45, 30, 'rail')!;
    expect(tr.addStop(25, 25, 'rail')).toBeNull(); // 斜めタイルに駅は不可
    const r = tr.addRoute([a.id, b.id])!;
    expect(tr.addVehicle(r.id, 0)).not.toBeNull();
    let visited = false;
    for (let t = 0; t < 6000; t++) {
      tr.step(t);
      if (tr.vehicles[0].trail.some((k) => k === m.idx(25, 25))) visited = true;
    }
    expect(visited).toBe(true);
    bulldoze(m, 25, 25);
    expect(m.rail.get(m.idx(24, 24)) & 32).toBe(0);
  });
});

describe('信号', () => {
  function line() {
    const m = flat();
    for (let x = 5; x < 60; x++) connectRail(m, x, 20, 1);
    for (const x of [8, 9, 56, 57]) m.building.set(m.idx(x, 21), 3);
    return m;
  }
  it('信号があると前方の閉塞だけ予約し、信号がなければ終点まで予約する', () => {
    for (const withSignals of [false, true]) {
      const m = line();
      const tr = new Transit(m);
      const a = tr.addStop(7, 20, 'rail')!;
      const b = tr.addStop(58, 20, 'rail')!;
      if (withSignals) {
        expect(tr.cycleSignal(20, 20)).toBe(2); // 東向き
        expect(tr.cycleSignal(20, 20)).toBe(8); // 西向き
        expect(tr.cycleSignal(20, 20)).toBe(0); // なし
        tr.cycleSignal(20, 20);
        tr.cycleSignal(20, 20);
        tr.cycleSignal(20, 20);
        for (const x of [20, 35]) {
          tr.signals.set(m.idx(x, 20), 10); // 経路予約の確認用に両方向を直接設定
        }
        expect(tr.cycleSignal(7, 20)).toBeNull(); // 駅には置けない
      }
      const r = tr.addRoute([a.id, b.id])!;
      tr.addVehicle(r.id, 0);
      let ahead = 0;
      for (let t = 0; t < 400; t++) {
        tr.step(t);
        const v = tr.vehicles[0];
        if (v.state === 'move') ahead = Math.max(ahead, v.resTo - v.pi);
      }
      const v = tr.vehicles[0];
      if (withSignals) expect(ahead).toBeLessThan(40);
      else expect(ahead).toBeGreaterThan(45);
      expect(v.state === 'move' || v.state === 'load').toBe(true);
    }
  });
  it('複線の周回線で2編成が追従し、衝突せず両方が終点に着く', () => {
    const m = flat();
    for (let x = 5; x < 59; x++) {
      connectRail(m, x, 20, 1);
      connectRail(m, x, 22, 1);
    }
    for (const x of [5, 59]) for (const y of [20, 21]) connectRail(m, x, y, 2);
    for (const x of [8, 9, 56, 57]) m.building.set(m.idx(x, 19), 3);
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail')!;
    const c = tr.addStop(16, 20, 'rail')!;
    const b = tr.addStop(55, 20, 'rail')!;
    // 上り線(y=20)は東向き、下り線(y=22)は西向きの一方向信号
    for (const x of [24, 32, 40, 48]) {
      expect(tr.cycleSignal(x, 20)).toBe(2);
      expect(tr.cycleSignal(x, 22)).toBe(2);
      expect(tr.cycleSignal(x, 22)).toBe(8);
    }
    const r1 = tr.addRoute([a.id, b.id])!;
    const r2 = tr.addRoute([c.id, b.id])!;
    const v1 = tr.addVehicle(r1.id, 0)!;
    const v2 = tr.addVehicle(r2.id, 0)!;
    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();
    const reached = new Set<number>();
    let sawWait = false;
    for (let t = 0; t < 12000; t++) {
      tr.step(t);
      const seen = new Set<number>();
      for (const v of tr.vehicles) {
        for (const k of v.trail) {
          expect(seen.has(k)).toBe(false); // 同じタイルに2編成はいない
          seen.add(k);
        }
        if (v.state === 'load' && v.order === 1) reached.add(v.id);
        if (v.state === 'move' && v.stuck > 5) sawWait = true;
      }
    }
    expect(reached.size).toBe(2);
    expect(sawWait).toBe(true);
  });
  it('片方向の信号は逆走を禁止し、経路がなくなる', () => {
    const m = line();
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail')!;
    const b = tr.addStop(58, 20, 'rail')!;
    tr.cycleSignal(30, 20); // 東向きのみ
    const r = tr.addRoute([a.id, b.id])!;
    tr.addVehicle(r.id, 0);
    let reachedB = false;
    let noroute = false;
    for (let t = 0; t < 5000; t++) {
      tr.step(t);
      const v = tr.vehicles[0];
      if (v.state === 'load' && v.order === 1) reachedB = true;
      if (reachedB && v.state === 'noroute') noroute = true;
    }
    expect(reachedB).toBe(true);
    expect(noroute).toBe(true);
  });
});

describe('編成の分割・併合', () => {
  function setup8() {
    const m = flat();
    for (let x = 5; x < 60; x++) connectRail(m, x, 20, 1);
    for (const x of [18, 19, 22, 23]) m.building.set(m.idx(x, 21), 3);
    const tr = new Transit(m);
    const a = tr.addStop(20, 20, 'rail')!;
    const b = tr.addStop(50, 20, 'rail')!;
    const r = tr.addRoute([a.id, b.id])!;
    r.modelId = 'mirai8000';
    r.cars = 8;
    const v = tr.addVehicle(r.id, 0)!;
    return { m, tr, v };
  }
  it('分割すると両数・定員・乗客が按分され、待機編成は動かず、連結で元に戻る', () => {
    const { tr, v } = setup8();
    expect(v.cars).toBe(8);
    expect(v.cap).toBe(8 * 140);
    v.cargo.set(99, 80);
    v.load = 80;
    const b = tr.splitTrain(v.id, 4, 0)!;
    expect(b).not.toBeNull();
    expect(v.cars).toBe(4);
    expect(b.cars).toBe(4);
    expect(v.cap).toBe(4 * 140);
    expect(b.cap).toBe(4 * 140);
    expect(v.load + b.load).toBe(80);
    expect(b.hold).toBe(true);
    // 同じタイルを共有しない
    expect(new Set([...v.trail, ...b.trail]).size).toBe(v.trail.length + b.trail.length);
    for (let t = 0; t < 2000; t++) tr.step(t);
    expect(b.state).toBe('load'); // 待機のまま
    expect(b.trail[0]).toBe(b.path[0]);
    // 出発した v は動く。b は動かない
    expect(v.state === 'move' || v.order !== 0).toBe(true);
  });
  it('連結: 隣接する停車中の2編成が1編成になる。離れていると連結できない', () => {
    const { tr, v } = setup8();
    const b = tr.splitTrain(v.id, 4, 0)!;
    expect(tr.canCouple(v.id, b.id)).toBe(true);
    expect(tr.coupleTrains(v.id, b.id)).toBe(true);
    expect(v.cars).toBe(8);
    expect(v.cap).toBe(8 * 140);
    expect(tr.vehicles).toHaveLength(1);
    // 連結後の編成が走って往復できる
    let reached = false;
    for (let t = 0; t < 4000; t++) {
      tr.step(t);
      if (v.state === 'load' && v.order === 1) reached = true;
    }
    expect(reached).toBe(true);
    // 分割できない条件
    expect(tr.splitTrain(v.id, 8, 0)).toBeNull();
    expect(tr.splitTrain(v.id, 0, 0)).toBeNull();
  });
  it('待機編成を出発させられる', () => {
    const { tr, v } = setup8();
    const b = tr.splitTrain(v.id, 3, 0)!;
    expect(tr.departHeld(b.id, 10)).toBe(true);
    let moved = false;
    for (let t = 10; t < 3000; t++) {
      tr.step(t);
      if (b.state === 'move') moved = true;
    }
    expect(moved).toBe(true);
    expect(tr.departHeld(b.id, 10)).toBe(false);
  });
});

describe('駅の設置・経由点', () => {
  function mainLine() {
    const m = flat(128);
    for (let x = 5; x < 50; x++) connectRail(m, x, 20, 1);
    for (const x of [8, 9, 44, 45]) m.building.set(m.idx(x, 21), 3);
    return m;
  }
  it('番線数×ホーム長の駅を設置でき、重なり・建物・分岐は拒否される', () => {
    const m = flat(128);
    const tr = new Transit(m);
    const r = tr.addStation(30, 30, { axis: 1, len: 6, tracks: 2, design: 2 });
    expect(r.stop).toBeDefined();
    const s = r.stop!;
    expect(s.station).toMatchObject({ len: 6, tracks: 2, axis: 1 });
    // 番線 0 と 1 に線路が敷かれる
    for (let i = 0; i < 6; i++) for (const y of [30, 31]) expect(m.rail.get(m.idx(30 + i, y))).not.toBe(0);
    expect(tr.stopAtTile(33, 31)?.id).toBe(s.id);
    expect(tr.addStation(32, 31, { axis: 1, len: 3, tracks: 1, design: 0 }).reason).toBeTruthy(); // 重なり
    m.building.set(m.idx(50, 50), 3);
    expect(tr.addStation(48, 50, { axis: 1, len: 4, tracks: 1, design: 0 }).reason).toBeTruthy(); // 建物
    m.rail.set(m.idx(70, 70), 1 | 2); // 分岐のある線路
    expect(tr.addStation(68, 70, { axis: 1, len: 4, tracks: 1, design: 0 }).reason).toBeTruthy();
    expect(tr.addStation(125, 5, { axis: 1, len: 6, tracks: 1, design: 0 }).reason).toBeTruthy(); // 範囲外
  });
  it('長い駅では編成の中央がホームの中央にくる位置に停車し、往復できる', () => {
    const m = mainLine();
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail')!;
    const s = tr.addStation(20, 20, { axis: 1, len: 8, tracks: 1, design: 1 }).stop!;
    for (const x of [22, 23]) m.building.set(m.idx(x, 21), 3);
    const r = tr.addRoute([a.id, s.id])!;
    r.modelId = 'mirai8000';
    r.cars = 6;
    tr.addVehicle(r.id, 0);
    const v = tr.vehicles[0];
    let docked = false;
    let back = false;
    for (let t = 0; t < 6000; t++) {
      tr.step(t);
      if (v.state === 'load' && v.order === 1 && v.trail[0] === m.idx(25, 20)) docked = true; // ホーム x=20..27 の中央に、4タイルの編成(22..25)
      if (docked && v.state === 'load' && v.order === 0) back = true;
    }
    expect(docked).toBe(true);
    expect(back).toBe(true);
  });
  it('経由点を置いた線路(待避線)を通り、置かなければ本線を通る', () => {
    for (const useWaypoint of [false, true]) {
      const m = mainLine();
      // 待避線 y=22 (x=15..35) と斜めの分岐
      for (let x = 15; x < 35; x++) connectRail(m, x, 22, 1);
      expect(connectRail(m, 13, 20, 5)).toBe(true);
      expect(connectRail(m, 14, 21, 5)).toBe(true);
      expect(connectRail(m, 35, 22, 4)).toBe(true);
      expect(connectRail(m, 36, 21, 4)).toBe(true);
      const tr = new Transit(m);
      const a = tr.addStop(7, 20, 'rail')!;
      const b = tr.addStop(46, 20, 'rail')!;
      const ids = [a.id];
      if (useWaypoint) {
        const w = tr.addWaypoint(25, 22)!;
        expect(w.waypoint).toBe(true);
        expect(tr.addWaypoint(25, 22)).toBeNull(); // 重複
        ids.push(w.id);
      }
      ids.push(b.id);
      const r = tr.addRoute(ids)!;
      tr.addVehicle(r.id, 0);
      const v = tr.vehicles[0];
      let viaSiding = false;
      let viaMain = false;
      let reachedB = false;
      for (let t = 0; t < 6000; t++) {
        tr.step(t);
        if (v.trail.includes(m.idx(25, 22))) viaSiding = true;
        if (v.trail.includes(m.idx(25, 20))) viaMain = true;
        if (v.state === 'load' && tr.stops.get(r.orders[v.order].stopId) === b) reachedB = true;
      }
      expect(reachedB).toBe(true);
      expect(viaSiding).toBe(useWaypoint);
      if (!useWaypoint) expect(viaMain).toBe(true);
      // 経由点は乗客の目的地にならない
      for (const s of tr.stops.values()) if (s.waypoint) expect(tr.departures(s.id, 0)).toEqual([]);
    }
  });
});

describe('駅・経由点のセーブ', () => {
  it('保存→復元で駅の形・全タイルの対応・経由点が保たれる(JSON往復)', () => {
    const m = flat(128);
    const tr = new Transit(m);
    const s = tr.addStation(30, 30, { axis: 0, len: 5, tracks: 2, design: 2 }).stop!;
    for (let x = 20; x < 29; x++) connectRail(m, x, 40, 1);
    const w = tr.addWaypoint(25, 40)!;
    const json = JSON.parse(JSON.stringify(tr.save()));
    const t2 = new Transit(m);
    t2.restore(json);
    expect(t2.stops.get(s.id)?.station).toEqual(s.station);
    expect(t2.stopAtTile(31, 34)?.id).toBe(s.id); // 2番線の最後のタイル
    expect(t2.stops.get(w.id)?.waypoint).toBe(true);
    expect(t2.stopAtTile(25, 40)?.id).toBe(w.id);
  });
});

describe('駅のデザイン(従来の0〜99 + スプライトの100〜179)', () => {
  it('0〜99がすべて別の組み合わせで、範囲外は丸められる', async () => {
    const { designName, designParts, STATION_DESIGN_COUNT } = await import('../../world/stations');
    expect(STATION_DESIGN_COUNT).toBe(100);
    const names = new Set<string>();
    const combos = new Set<string>();
    for (let d = 0; d < 100; d++) {
      names.add(designName(d));
      const p = designParts(d);
      combos.add(`${p.roof}-${p.palette.name}-${p.building}`);
    }
    expect(names.size).toBe(100);
    expect(combos.size).toBe(100);
    expect(designParts(-5)).toEqual(designParts(0));
    expect(designParts(999)).toEqual(designParts(99));
    const m = flat(128);
    const tr = new Transit(m);
    expect(tr.addStation(30, 30, { axis: 1, len: 4, tracks: 1, design: 5000 }).stop!.station!.design).toBe(179);
  });
});

describe('車両300種・両数の指定', () => {
  it('車両は300種(鉄道190・バス70・航空機40)で、ID・名前は重複せず、両数の範囲が正しい', async () => {
    const { ALL_MODELS, modelOf, legacyCarsOf, modelsFor, kindsFor } = await import('../../data/models');
    expect(ALL_MODELS).toHaveLength(300);
    expect(modelsFor('rail')).toHaveLength(190);
    expect(modelsFor('road')).toHaveLength(70);
    expect(modelsFor('air')).toHaveLength(40);
    expect(new Set(ALL_MODELS.map((m) => m.id)).size).toBe(300);
    expect(new Set(ALL_MODELS.map((m) => m.name)).size).toBe(300);
    for (const m of ALL_MODELS) {
      expect(m.cap).toBeGreaterThan(0);
      expect(m.speed).toBeGreaterThan(0);
      if (m.mode === 'rail') {
        // 1両のみ(単行)か、2両以上の任意の長さ
        expect(m.minCars === 1 ? m.maxCars === 1 : m.minCars >= 2 && m.maxCars >= m.minCars).toBe(true);
        expect(m.defaultCars).toBeGreaterThanOrEqual(m.minCars);
        expect(m.defaultCars).toBeLessThanOrEqual(m.maxCars);
      } else expect(m.maxCars).toBe(1);
    }
    expect(kindsFor('rail')).toContain('単行');
    // 旧セーブの車種ID(両数入り)は系列+両数に読み替えられる
    expect(modelOf('mirai8000-8').id).toBe('mirai8000');
    expect(legacyCarsOf('mirai8000-8')).toBe(8);
    expect(legacyCarsOf('mirai8000')).toBeUndefined();
  });
  it('路線の両数指定が編成に反映され、範囲外は丸められ、単行は常に1両', async () => {
    const { modelsFor } = await import('../../data/models');
    const m = flat();
    for (let x = 5; x < 60; x++) connectRail(m, x, 20, 1);
    for (const x of [8, 9, 56, 57]) m.building.set(m.idx(x, 21), 3);
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail')!;
    const b = tr.addStop(58, 20, 'rail')!;
    const multi = modelsFor('rail').find((x) => x.minCars >= 2 && x.maxCars >= 12)!;
    const single = modelsFor('rail').find((x) => x.maxCars === 1)!;
    const r = tr.addRoute([a.id, b.id])!;
    r.modelId = multi.id;
    r.cars = 11;
    const v = tr.addVehicle(r.id, 0)!;
    expect(v.cars).toBe(11);
    expect(v.cap).toBe(multi.cap * 11);
    r.cars = 999; // 範囲外は最大両数に丸める
    r.modelId = multi.id;
    expect(tr.addVehicle(r.id, 0)).toBeNull(); // 同じ駅に2本目は置けない
    const tr2 = new Transit(m);
    const a2 = tr2.addStop(7, 20, 'rail')!;
    const b2 = tr2.addStop(58, 20, 'rail')!;
    const r2 = tr2.addRoute([a2.id, b2.id])!;
    r2.modelId = multi.id;
    r2.cars = 999;
    expect(tr2.addVehicle(r2.id, 0)!.cars).toBe(multi.maxCars);
    const tr3 = new Transit(m);
    const a3 = tr3.addStop(7, 20, 'rail')!;
    const b3 = tr3.addStop(58, 20, 'rail')!;
    const r3 = tr3.addRoute([a3.id, b3.id])!;
    r3.modelId = single.id;
    r3.cars = 5;
    const sv = tr3.addVehicle(r3.id, 0)!;
    expect(sv.cars).toBe(1);
    expect(sv.cap).toBe(single.cap);
    // 単行は分割できず、2両以上なら任意の位置で分割できる
    expect(tr3.splitTrain(sv.id, 1, 0)).toBeNull();
    const sp = tr.splitTrain(v.id, 5, 0)!;
    expect(sp.cars).toBe(5);
    expect(v.cars).toBe(6);
    expect(v.cap + sp.cap).toBe(multi.cap * 11);
  });
});

describe('車両基地(デポ)', () => {
  it('道路の基地からバスを購入して路線に配属でき、種類・到達性が検査される', async () => {
    const { connect: conn } = await import('../../world/roads');
    const m = flat();
    for (let x = 5; x < 40; x++) conn(m, x, 20, 1, false);
    for (const x of [8, 9, 36, 37]) m.building.set(m.idx(x, 21), 3);
    const tr = new Transit(m);
    const a = tr.addStop(7, 20)!;
    const b = tr.addStop(38, 20)!;
    const r = tr.addRoute([a.id, b.id])!;
    expect(tr.addDepot(30, 22).reason).toBeTruthy(); // 道路の上ではない
    const dep = tr.addDepot(20, 20).depot!;
    expect(dep.kind).toBe('road');
    expect(tr.addDepot(20, 20).reason).toBeTruthy(); // 二重
    expect(tr.addDepot(7, 20).reason).toBeTruthy(); // 停留所と同じタイル
    expect(tr.buyVehicle(dep.id, r.id, 'mirai8000', 4, 0).reason).toBeTruthy(); // 種類違い
    const res = tr.buyVehicle(dep.id, r.id, 'bus-l', 1, 0);
    expect(res.vehicle).toBeDefined();
    const v = res.vehicle!;
    expect(v.modelId).toBe('bus-l');
    expect(v.routeId).toBe(r.id);
    expect(v.cap).toBe(45);
    // 路線の既定車種と違う車種を別々に購入でき、同じオーダーを共有して走る
    const v2 = tr.buyVehicle(dep.id, r.id, 'bus-s', 1, 0).vehicle;
    expect(v2?.modelId).toBe('bus-s');
    let reached = 0;
    for (let t = 0; t < 4000; t++) {
      tr.step(t);
      for (const x of [v, v2!]) if (x.state === 'load' && x.order === 1) reached++;
    }
    expect(reached).toBeGreaterThan(0);
    // 道路が撤去されると基地も消える
    for (let x = 18; x <= 22; x++) m.road.set(m.idx(x, 20), 0);
    for (let t = 4000; t < 4300; t++) tr.step(t);
    expect(tr.depots.size).toBe(0);
  });
  it('鉄道の基地から編成を購入でき(両数は任意)、孤立した基地からは購入できない', () => {
    const m = flat();
    for (let x = 5; x < 60; x++) connectRail(m, x, 20, 1);
    for (const x of [8, 9, 56, 57]) m.building.set(m.idx(x, 21), 3);
    for (let x = 70; x < 80; x++) connectRail(m, x, 30, 1);
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail')!;
    const b = tr.addStop(58, 20, 'rail')!;
    const r = tr.addRoute([a.id, b.id])!;
    const dep = tr.addDepot(30, 20).depot!;
    expect(dep.kind).toBe('rail');
    const iso = tr.addDepot(75, 30).depot!;
    expect(tr.buyVehicle(iso.id, r.id, 'mirai8000', 6, 0).reason).toContain('到達');
    const res = tr.buyVehicle(dep.id, r.id, 'mirai8000', 7, 0);
    expect(res.vehicle?.cars).toBe(7);
    expect(res.vehicle?.cap).toBe(7 * 140);
    const v = res.vehicle!;
    let reached = false;
    for (let t = 0; t < 6000; t++) {
      tr.step(t);
      if (v.state === 'load' && v.order === 1) reached = true;
    }
    expect(reached).toBe(true);
    // セーブで基地が保たれる
    const t2 = new Transit(m);
    t2.restore(JSON.parse(JSON.stringify(tr.save())));
    expect(t2.depotAtTile(30, 20)?.id).toBe(dep.id);
  });
});

describe('バス・航空機のスプライト割り当て', () => {
  it('バスは0〜249、航空機は0〜99のデザインを持ち、鉄道は持たない。同じ種別内ではなるべく別のデザインになる', async () => {
    const { ALL_MODELS, modelsFor } = await import('../../data/models');
    for (const m of modelsFor('road')) {
      expect(m.sprite).toBeGreaterThanOrEqual(0);
      expect(m.sprite).toBeLessThan(250);
    }
    for (const m of modelsFor('air')) {
      expect(m.sprite).toBeGreaterThanOrEqual(0);
      expect(m.sprite).toBeLessThan(100);
    }
    // 鉄道: 0〜449。全車種に割り当てられ、同じデザインは重複しない(190種すべて別)
    const rail = modelsFor('rail');
    for (const m of rail) {
      expect(m.sprite).toBeGreaterThanOrEqual(0);
      expect(m.sprite).toBeLessThan(450);
    }
    expect(new Set(rail.map((m) => m.sprite)).size).toBe(rail.length);
    expect(ALL_MODELS).toHaveLength(300);
    // 種別ごとに、使われるデザインの種類が十分ある(同じ見た目ばかりにならない)
    for (const mode of ['road', 'air'] as const) {
      const ms = modelsFor(mode);
      const kinds = new Set(ms.map((m) => m.kind));
      for (const k of kinds) {
        const group = ms.filter((m) => m.kind === k);
        const distinct = new Set(group.map((m) => m.sprite)).size;
        expect(distinct).toBeGreaterThanOrEqual(Math.ceil(group.length * 0.7));
      }
    }
    // 元の8種も割り当てられる
    expect(modelsFor('road').find((m) => m.id === 'bus-s')!.sprite).toBeDefined();
    expect(modelsFor('air').find((m) => m.id === 'air-l')!.sprite).toBeDefined();
  });
});
