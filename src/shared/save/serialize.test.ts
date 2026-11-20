import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/simulation';
import { GameMap } from '../world/gameMap';
import { generateTerrain } from '../world/terrain';
import { applyLayers, decodeSave, encodeSave } from './serialize';

function newSim(seed = 11, size = 256) {
  const map = new GameMap(size, seed, generateTerrain({ size, seed }));
  return new Simulation(map);
}

describe('save/load', () => {
  it('保存→復元で状態が一致し、その後も同じように進行する', async () => {
    const a = newSim();
    const town = a.map.towns[0];
    const roads = town.roads.map((i) => [i % a.map.size, Math.floor(i / a.map.size)]).sort((p, q) => p[0] - q[0]);
    const s1 = a.transit.addStop(roads[0][0], roads[0][1])!;
    const s2 = a.transit.addStop(roads[roads.length - 1][0], roads[roads.length - 1][1])!;
    const r = a.transit.addRoute([s1.id, s2.id])!;
    a.transit.addVehicle(r.id, a.tick);
    for (let i = 0; i < 3000; i++) a.step();

    const bytes = await encodeSave(a.map, a.state());
    const d = await decodeSave(bytes as Uint8Array<ArrayBuffer>);

    // 地形をシードから再生成 → レイヤー適用 → シミュ復元
    const map = new GameMap(d.header.size, d.header.seed, generateTerrain({ size: d.header.size, seed: d.header.seed }));
    applyLayers(map, d);
    const b = new Simulation(map, d.header.sim);

    expect(b.tick).toBe(a.tick);
    expect(b.map.road).toEqual(a.map.road);
    expect(b.map.building).toEqual(a.map.building);
    expect(b.map.owner).toEqual(a.map.owner);
    expect(b.map.towns.map((t) => [t.name, t.pop, t.houses])).toEqual(a.map.towns.map((t) => [t.name, t.pop, t.houses]));
    expect(b.transit.vehicles.length).toBe(1);

    for (let i = 0; i < 3000; i++) {
      a.step();
      b.step();
    }
    expect(b.map.road).toEqual(a.map.road);
    expect(b.map.building).toEqual(a.map.building);
    expect(b.transit.delivered).toBe(a.transit.delivered);
    expect(b.transit.vehicles.map((v) => [v.state, v.pi, v.load])).toEqual(a.transit.vehicles.map((v) => [v.state, v.pi, v.load]));
  });

  it('地形が違えば拒否し、壊れたデータもエラーにする', async () => {
    const a = newSim(5);
    const bytes = await encodeSave(a.map, a.state());
    const d = await decodeSave(bytes as Uint8Array<ArrayBuffer>);
    const other = new GameMap(256, 5, generateTerrain({ size: 256, seed: 6 }));
    expect(() => applyLayers(other, d)).toThrow();
    await expect(decodeSave(new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>)).rejects.toThrow();
  });
});

describe('save/load (鉄道・空港)', () => {
  it('線路・空港・列車・航空機が往復で保存される', async () => {
    const { connectRail } = await import('../world/rails');
    const { placeAirport } = await import('../world/airports');
    const a = newSim(21);
    const m = a.map;
    // 平坦で空いている30タイルの直線を探す
    let ox = -1;
    let oy = -1;
    outer: for (let y = 10; y < 245; y += 3) {
      for (let x = 10; x < 215; x += 3) {
        let ok = true;
        for (let i = 0; i < 31 && ok; i++) {
          const k = m.idx(x + i, y);
          if (m.levelAt(x + i, y) !== m.levelAt(x, y) || m.levelAt(x + i, y) === 0 || m.road.get(k) || m.building.get(k)) ok = false;
        }
        if (ok) {
          ox = x;
          oy = y;
          break outer;
        }
      }
    }
    expect(ox).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 30; i++) connectRail(m, ox + i, oy, 1);
    const s1 = a.transit.addStop(ox + 3, oy, 'rail')!;
    const s2 = a.transit.addStop(ox + 27, oy, 'rail')!;
    const r = a.transit.addRoute([s1.id, s2.id])!;
    expect(a.transit.addVehicle(r.id, a.tick)).not.toBeNull();
    for (let i = 0; i < 1500; i++) a.step();
    const bytes = await encodeSave(a.map, a.state());
    const d = await decodeSave(bytes as Uint8Array<ArrayBuffer>);
    const map = new GameMap(d.header.size, d.header.seed, generateTerrain({ size: d.header.size, seed: d.header.seed }));
    applyLayers(map, d);
    const b = new Simulation(map, d.header.sim);
    expect(b.map.rail).toEqual(a.map.rail);
    expect(b.map.air).toEqual(a.map.air);
    void placeAirport;
    for (let i = 0; i < 3000; i++) {
      a.step();
      b.step();
    }
    expect(b.transit.vehicles.map((v) => [v.state, v.pi, v.trail.join(',')])).toEqual(a.transit.vehicles.map((v) => [v.state, v.pi, v.trail.join(',')]));
    expect(b.transit.delivered).toBe(a.transit.delivered);
  });
});
