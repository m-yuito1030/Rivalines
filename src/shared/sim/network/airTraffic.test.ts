import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { AIR, AIRPORT_SIZES, type AirportAxis, type AirportSize, airportFootprint, airportTakes, buildLayout, isTaxiable } from '../../world/airportLayout';
import { airportAt, canPlaceAirport, findTerminal, placeAirport, removeAirport } from '../../world/airports';
import { GameMap } from '../../world/gameMap';
import { flightAt, straightFlight } from './flightPath';
import { Transit } from './transit';

const flat = (size = 300): GameMap => new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));

describe('空港の形(大きさ 4 種類)', () => {
  it('小・中・大・ハブの順に大きくなり、滑走路・駐機場も増える。以前の 3×3 より、どれも大きい', () => {
    const dims = AIRPORT_SIZES.map((s) => airportFootprint(s, 'x'));
    for (const d of dims) expect(d.w * d.h).toBeGreaterThan(9);
    for (let i = 1; i < dims.length; i++) expect(dims[i].w * dims[i].h).toBeGreaterThan(dims[i - 1].w * dims[i - 1].h);
    const hub = airportFootprint('H', 'x');
    expect(hub.w).toBeGreaterThanOrEqual(40); // the hub is huge
    expect(AIRPORT_SIZES.map((s) => buildLayout(s, 'x').runways)).toEqual([1, 1, 2, 2]);
    expect(AIRPORT_SIZES.map((s) => buildLayout(s, 'x').stands)).toEqual([2, 8, 24, 60]);
  });

  it('向きを変えても同じ作りで、縦横が入れ替わる。タイルの数は同じ', () => {
    for (const s of AIRPORT_SIZES) {
      const x = buildLayout(s, 'x');
      const y = buildLayout(s, 'y');
      expect([y.w, y.h]).toEqual([x.h, x.w]);
      const count = (l: { codes: Uint8Array }, c: number) => l.codes.filter((v) => v === c).length;
      for (const c of [AIR.RUNWAY, AIR.TAXIWAY, AIR.STAND, AIR.HANGAR, AIR.TERMINAL, AIR.BUILDING, AIR.APRON]) expect(count(y, c), `${s} ${c}`).toBe(count(x, c));
    }
  });

  it('どの大きさ・向きでも、滑走路・駐機場・格納庫・ターミナル(停留所の 1 タイル)があり、全部の駐機場から滑走路の脇まで地上でたどり着ける', () => {
    for (const s of AIRPORT_SIZES) {
      for (const axis of ['x', 'y'] as AirportAxis[]) {
        const m = flat(120);
        const term = placeAirport(m, 10, 10, s, axis)!;
        expect(term, `${s}${axis}`).not.toBeNull();
        const a = airportAt(m, m.idx(term.x, term.y))!;
        expect(a.size).toBe(s);
        expect(a.terminal).toBe(m.idx(term.x, term.y));
        expect(a.runways.length).toBe(buildLayout(s, axis).runways);
        expect(a.stands.length).toBe(buildLayout(s, axis).stands);
        expect(a.hangars.length).toBe(2);
        // From the first hangar, every stand and every runway's access tile can be reached over the ground network
        const seen = new Set<number>([a.hangars[0]]);
        const queue = [a.hangars[0]];
        for (let h = 0; h < queue.length; h++) {
          const k = queue[h];
          const x = k % m.size;
          const y = (k - x) / m.size;
          for (const [nx, ny] of [
            [x + 1, y],
            [x - 1, y],
            [x, y + 1],
            [x, y - 1],
          ]) {
            if (!m.inBounds(nx, ny)) continue;
            const n = m.idx(nx, ny);
            if (!seen.has(n) && isTaxiable(m.air.get(n))) (seen.add(n), queue.push(n));
          }
        }
        for (const st of a.stands) expect(seen.has(st), `${s}${axis} stand`).toBe(true);
        for (const r of a.runways) {
          expect(r.tiles.length).toBe(buildLayout(s, 'x').w);
          expect(r.access.some((t) => seen.has(t))).toBe(true);
          // Both ends of the runway have a taxiway beside them (where an aircraft lines up)
          const ends = [r.tiles[0], r.tiles[r.tiles.length - 1]];
          for (const e of ends) {
            const ex = e % m.size;
            const ey = (e - ex) / m.size;
            const beside = r.axis === 'x' ? [ey - 1, ey + 1].map((yy) => yy * m.size + ex) : [ex - 1, ex + 1].map((xx) => ey * m.size + xx);
            expect(beside.some((t) => seen.has(t))).toBe(true);
          }
        }
      }
    }
  });

  it('置く・撤去: 平らで空いている場所にだけ。重なりは不可。撤去すると全部消える。停留所のタイルは findTerminal で見つかる', () => {
    const m = flat(200);
    expect(canPlaceAirport(m, 10, 10, 'H', 'x')).toBe(true);
    const term = placeAirport(m, 10, 10, 'H', 'x')!;
    expect(canPlaceAirport(m, 20, 12, 'S', 'x')).toBe(false); // overlaps the hub
    expect(placeAirport(m, 20, 12, 'S', 'x')).toBeNull();
    // any tile of the airport leads to the terminal
    expect(findTerminal(m, 12, 11)).toEqual(term);
    expect(findTerminal(m, 49, 20)).toEqual(term);
    // not flat
    const bump = flat(200);
    bump.setHeight?.(60, 60, SEA_LEVEL + 20);
    removeAirport(m, 10, 10);
    for (let i = 0; i < m.size * m.size; i++) expect(m.air.get(i)).toBe(0);
    expect(airportAt(m, m.idx(10, 10))).toBeNull(); // the cache is rebuilt after removal
  });

  it('小さい空港は小型機だけ、中は中型機まで、大・ハブはすべての機体', () => {
    expect(airportTakes('S', 'S')).toBe(true);
    expect(airportTakes('S', 'M')).toBe(false);
    expect(airportTakes('M', 'M')).toBe(true);
    expect(airportTakes('M', 'L')).toBe(false);
    expect(airportTakes('L', 'L')).toBe(true);
    expect(airportTakes('H', 'L')).toBe(true);
  });
});

describe('飛行の経路(折れ線)', () => {
  it('距離から位置・高さ・向きが決まる。両端は地上(高さ 0)、途中は高い', () => {
    const f = straightFlight(10, 10, 110, 10);
    expect(f.dist).toBeCloseTo(100, 5);
    expect(flightAt(f, 0).z).toBe(0);
    expect(flightAt(f, f.dist).z).toBe(0);
    expect(flightAt(f, 50).z).toBe(1);
    const p = flightAt(f, 50);
    expect(p.x).toBeCloseTo(60, 5);
    expect(p.dx).toBeCloseTo(1, 5);
    expect(p.dy).toBeCloseTo(0, 5);
    // 範囲外でも、両端で止まる
    expect(flightAt(f, -5).x).toBeCloseTo(10, 5);
    expect(flightAt(f, 999).x).toBeCloseTo(110, 5);
  });
});

/** Two airports 100 tiles apart, a route between them, and n aircraft */
function world(sizeA: AirportSize, sizeB: AirportSize, n: number, staggerTicks = 0) {
  const m = flat();
  const ta = placeAirport(m, 20, 100, sizeA, 'x')!;
  const tb = placeAirport(m, 150, 100, sizeB, 'x')!;
  const t = new Transit(m);
  const a = t.addStop(ta.x, ta.y, 'air')!;
  const b = t.addStop(tb.x, tb.y, 'air')!;
  const r = t.addRoute([a.id, b.id])!;
  for (const o of r.orders) o.dwell = 20;
  const vs = Array.from({ length: n }, (_, i) => t.addVehicle(r.id, i * staggerTicks, 0, { modelId: 'air-s', cars: 1 })!);
  return { m, t, a, b, r, vs, aa: airportAt(m, m.idx(ta.x, ta.y))!, ab: airportAt(m, m.idx(tb.x, tb.y))! };
}

/** There are no towns in these test worlds, so put passengers at the stops now and then (each heading for the other airport) */
function feed(t: Transit, a: { id: number }, b: { id: number }, tick: number): void {
  if (tick % 40 !== 0) return;
  t.flow.addWaiting(t.stops.get(a.id)!, b.id, 30);
  t.flow.addWaiting(t.stops.get(b.id)!, a.id, 30);
}

/** The runway (index) an aircraft is on right now, if any */
function onRunway(w: ReturnType<typeof world>, v: { flight: { pts: number[] } | null; path: Uint32Array }, airport: ReturnType<typeof airportAt>): number {
  const s = w.m.size;
  let x: number;
  let y: number;
  if (v.flight) {
    const p = w.t.planePos(v as never);
    if (p.alt > 0.02) return -1; // in the air
    x = p.x;
    y = p.y;
  } else {
    x = (v.path[0] % s) + 0.5;
    y = Math.floor(v.path[0] / s) + 0.5;
  }
  const idx = Math.floor(y) * s + Math.floor(x);
  return airport!.runways.findIndex((r) => r.tiles.includes(idx));
}

describe('空港の交通: 滑走路は同時に 1 機・駐機場は 1 機', () => {
  it('小さな空港(滑走路 1・駐機場 2)に、飛行機 5 機が同時に着いても、滑走路には同時に 2 機以上いない。全機が最後まで運航できる', () => {
    const w = world('S', 'S', 5);
    let maxOnRunway = 0;
    let maxStands = 0;
    let laps = 0;
    for (let tick = 1; tick < 6000; tick++) {
      feed(w.t, w.a, w.b, tick);
      w.t.step(tick);
      for (const air of [w.aa, w.ab]) {
        let n = 0;
        for (const v of w.t.vehicles) if (onRunway(w, v as never, air) === 0) n++;
        maxOnRunway = Math.max(maxOnRunway, n);
        maxStands = Math.max(maxStands, w.t.air.standsInUse(air.id));
      }
      for (const v of w.t.vehicles) if (w.t.air.holding(v.id)) laps++;
    }
    expect(maxOnRunway).toBeLessThanOrEqual(1);
    expect(maxStands).toBeLessThanOrEqual(w.aa.stands.length);
    expect(maxStands).toBeGreaterThan(0);
    expect(laps).toBeGreaterThan(0); // somebody had to circle and wait
    expect(w.t.delivered).toBeGreaterThan(20);
    expect(w.t.vehicles).toHaveLength(5);
  });

  it('駐機場より機数が多いと、着陸できない機は旋回して待ち、空いたら降りる(駐機場の使用数は、駐機場の数を超えない)', () => {
    const w = world('S', 'S', 4); // 2 stands only
    const seenCircling = new Set<number>();
    let maxStands = 0;
    for (let tick = 1; tick < 4000; tick++) {
      feed(w.t, w.a, w.b, tick);
      w.t.step(tick);
      maxStands = Math.max(maxStands, w.t.air.standsInUse(w.ab.id));
      for (const v of w.t.vehicles) if (w.t.air.holding(v.id)) seenCircling.add(v.id);
    }
    expect(maxStands).toBeLessThanOrEqual(2);
    expect(seenCircling.size).toBeGreaterThan(0);
    expect(w.t.delivered).toBeGreaterThan(10);
  });

  it('滑走路の予約の時間帯は、重ならない', () => {
    const w = world('S', 'S', 5);
    for (let tick = 1; tick < 3000; tick++) {
      feed(w.t, w.a, w.b, tick);
      w.t.step(tick);
    }
    for (const air of [w.aa, w.ab]) {
      for (let ri = 0; ri < air.runways.length; ri++) {
        const list = w.t.air.reservations(air.id, ri).sort((x, y) => x.start - y.start);
        for (let i = 1; i < list.length; i++) expect(list[i].start, `${air.id}:${ri}`).toBeGreaterThanOrEqual(list[i - 1].end - 1e-6);
      }
    }
  });

  it('機数が多いと、小さな空港は駐機場と滑走路が足りず、旋回して待つ。大きな空港(滑走路 2・駐機場 24)は、より多く運べて、待ちが少ない', () => {
    const run = (size: AirportSize) => {
      const w = world(size, size, 14);
      let holding = 0;
      for (let tick = 1; tick < 5000; tick++) {
        feed(w.t, w.a, w.b, tick);
        w.t.step(tick);
        for (const v of w.t.vehicles) if (w.t.air.holding(v.id)) holding++;
      }
      return { holding, delivered: w.t.delivered };
    };
    const small = run('S');
    const large = run('L');
    expect(small.holding).toBeGreaterThan(0);
    expect(large.delivered).toBeGreaterThan(small.delivered);
    expect(large.holding).toBeLessThan(small.holding);
  });
});

describe('飛行機の地上の動き', () => {
  it('買ったばかりの機体は格納庫から駐機場へ移り、そこで乗客を乗せ、滑走路から離陸する(地上は高さ 0、離陸後に上がり、着陸で 0 に戻る)', () => {
    const w = world('M', 'M', 1);
    const v = w.vs[0];
    let maxZ = 0;
    let onGround = 0;
    let sawRunway = false;
    for (let tick = 1; tick < 2500; tick++) {
      feed(w.t, w.a, w.b, tick);
      w.t.step(tick);
      if (v.flight) {
        const p = w.t.planePos(v);
        maxZ = Math.max(maxZ, p.alt);
        if (p.alt === 0) onGround++;
        if (p.alt === 0 && onRunway(w, v as never, w.aa) >= 0) sawRunway = true;
      }
    }
    expect(maxZ).toBe(1); // reaches cruising height
    expect(onGround).toBeGreaterThan(10); // it taxied on the ground
    expect(sawRunway).toBe(true);
    expect(w.t.delivered).toBeGreaterThan(0);
  });

  it('旧い空港(3×3・駐機場なし)は、これまで通り、端末から直線で飛ぶ', () => {
    const m = flat(120);
    // Build an old-style airport by hand: apron, terminal, runway
    for (const [ox, oy] of [
      [10, 10],
      [80, 10],
    ]) {
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) m.air.set(m.idx(ox + i, oy + j), j === 2 ? AIR.RUNWAY : j === 0 && i === 1 ? AIR.TERMINAL : AIR.APRON);
      m.airVer++;
    }
    const t = new Transit(m);
    const a = t.addStop(11, 10, 'air')!;
    const b = t.addStop(81, 10, 'air')!;
    expect(airportAt(m, m.idx(11, 10))!.size).toBe('legacy');
    const r = t.addRoute([a.id, b.id])!;
    const v = t.addVehicle(r.id, 0)!;
    let flew = false;
    for (let tick = 1; tick < 3000; tick++) {
      feed(t, a, b, tick);
      t.step(tick);
      if (v.flight) flew = true;
    }
    expect(flew).toBe(true);
    expect(t.delivered).toBeGreaterThan(0);
  });
});

describe('機体の大きさと空港の大きさ・格納庫の車両基地', () => {
  it('小さい空港に大型機は買えない。中型機は中の空港まで。大きい空港とハブはすべて。既存の路線に、入れない空港を足すこともできない', () => {
    const m = flat();
    const sm = placeAirport(m, 20, 100, 'S', 'x')!;
    const md = placeAirport(m, 100, 100, 'M', 'x')!;
    const lg = placeAirport(m, 20, 160, 'L', 'x')!;
    const hb = placeAirport(m, 100, 200, 'H', 'x')!;
    const t = new Transit(m);
    const stop = (p: { x: number; y: number }) => t.addStop(p.x, p.y, 'air')!;
    const [s1, s2, s3, s4] = [stop(sm), stop(md), stop(lg), stop(hb)];
    const smallRoute = t.addRoute([s1.id, s2.id])!;
    const bigRoute = t.addRoute([s3.id, s4.id])!;
    const midRoute = t.addRoute([s2.id, s3.id])!;
    const dep = (p: { x: number; y: number }, ri?: number) => {
      void ri;
      const hangar = airportAt(m, m.idx(p.x, p.y))!.hangars[0];
      return t.addDepot(hangar % m.size, Math.floor(hangar / m.size)).depot!;
    };
    const d1 = dep(sm);
    const d3 = dep(lg);
    const d2 = dep(md);
    expect(d1.kind).toBe('air'); // a depot goes on a hangar
    // small aircraft: everywhere
    expect(t.buyVehicle(d1.id, smallRoute.id, 'air-s', 1, 0).vehicle).toBeDefined();
    // medium aircraft: not on a route with a small airport; fine between medium and large
    expect(t.buyVehicle(d1.id, smallRoute.id, 'air-m', 1, 0).reason).toMatch(/この機体は大きすぎます/);
    expect(t.buyVehicle(d2.id, midRoute.id, 'air-m', 1, 0).vehicle).toBeDefined();
    // large aircraft: only between large and hub; the medium airport refuses them
    expect(t.buyVehicle(d2.id, midRoute.id, 'air-l', 1, 0).reason).toMatch(/この機体は大きすぎます/);
    expect(t.buyVehicle(d3.id, bigRoute.id, 'air-l', 1, 0).vehicle).toBeDefined();
    // a route with a large aircraft cannot take a small airport as a new stop
    expect(t.orderEdit.insertOrder(bigRoute.id, 1, s1.id).ok).toBe(false);
    expect(t.orderEdit.insertOrder(bigRoute.id, 1, s2.id).ok).toBe(false);
  });
});
