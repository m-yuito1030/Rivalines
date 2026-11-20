import { describe, expect, it } from 'vitest';
import { GameMap } from './gameMap';
import { SEA_LEVEL } from './constants';
import { bulldoze, connect } from './roads';
import { connectRail } from './rails';
import { buildSpan } from './spans';
import { carveRivers } from './terrain';
import { Transit } from '../sim/network/transit';

const H = SEA_LEVEL + 10; // 段1
/** 段1の平地に、x=10..12 だけ川(段0)/丘(段3)を作る */
function world(mid: 'river' | 'hill') {
  const size = 64;
  const h = new Uint8Array(size * size).fill(H);
  for (let y = 0; y < size; y++) for (let x = 10; x <= 12; x++) h[y * size + x] = mid === 'river' ? SEA_LEVEL : H + 32;
  return new GameMap(size, 1, h);
}

describe('高低差1段の接続', () => {
  it('スロープは道路・線路の直線で可、2段差や斜めは不可', () => {
    const m = world('river');
    m.height[20 * 64 + 21] = H + 16; // 段2
    expect(connect(m, 20, 20, 1, false)).toBe(false);
    expect(connect(m, 20, 20, 1, false, true)).toBe(true);
    m.height[30 * 64 + 31] = H + 32; // 段3
    expect(connect(m, 30, 30, 1, false, true)).toBe(false);
    m.height[40 * 64 + 41] = H + 16;
    expect(connectRail(m, 40, 40, 1, true)).toBe(true);
    // 斜めは同じ高さのみ(40,40)→(41,41) は段差あり
    m.height[41 * 64 + 41] = H + 16;
    expect(connectRail(m, 40, 40, 5, true)).toBe(false);
  });
});

describe('橋・トンネル', () => {
  it('川には橋、丘にはトンネルをかけられ、車両が通れる', () => {
    for (const [mid, kind] of [
      ['river', 'bridge'],
      ['hill', 'tunnel'],
    ] as const) {
      const m = world(mid);
      const p = buildSpan(m, 9, 20, 13, 20, 'road');
      expect(p.ok).toBe(true);
      expect(p.kind).toBe(kind);
      expect(m.span.get(m.idx(11, 20))).not.toBe(0);
      for (let x = 13; x < 20; x++) connect(m, x, 20, 1, false);
      for (let x = 3; x < 9; x++) connect(m, x, 20, 1, false);
      for (const x of [14, 15, 5, 6]) m.building.set(m.idx(x, 21), 3);
      const tr = new Transit(m);
      const a = tr.addStop(5, 20)!;
      const b = tr.addStop(18, 20)!;
      expect(tr.addStop(11, 20)).toBeNull(); // 橋の上に停留所は不可
      const r = tr.addRoute([a.id, b.id])!;
      expect(tr.addVehicle(r.id, 0)).not.toBeNull();
      for (let t = 0; t < 3000; t++) tr.step(t);
      expect(tr.delivered + tr.transfers + [...tr.stops.values()].reduce((s, st) => s + st.waiting, 0)).toBeGreaterThanOrEqual(0);
      expect(tr.vehicles.length).toBe(1);
      // 撤去で全体が消える
      bulldoze(m, 11, 20);
      expect(m.span.get(m.idx(10, 20)) | m.span.get(m.idx(12, 20)) | m.road.get(m.idx(10, 20))).toBe(0);
      expect(m.road.get(m.idx(9, 20)) & 2).toBe(0);
    }
  });
  it('混在・同じ高さ・既存道路は不可。線路の橋も可', () => {
    const m = world('river');
    m.height[20 * 64 + 11] = H + 32;
    expect(buildSpan(m, 9, 20, 13, 20, 'road').ok).toBe(false);
    expect(buildSpan(m, 9, 22, 13, 22, 'rail').ok).toBe(true);
    expect(buildSpan(m, 9, 22, 13, 22, 'road').ok).toBe(false); // 既に橋がある
  });
});

describe('川', () => {
  it('決定論的で、川タイルは海面以下・岸は段1以下', () => {
    const size = 256;
    const mk = () => {
      const h = new Uint8Array(size * size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = Math.max(0, SEA_LEVEL + 90 - Math.floor(y * 0.5) - (x % 7));
      return h;
    };
    const a = mk();
    const b = mk();
    carveRivers(a, size, 7);
    carveRivers(b, size, 7);
    expect(a).toEqual(b);
    const base = mk();
    let carved = 0;
    for (let i = 0; i < a.length; i++) if (a[i] <= SEA_LEVEL && base[i] > SEA_LEVEL) carved++;
    expect(carved).toBeGreaterThan(20);
  });
});
