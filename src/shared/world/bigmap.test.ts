import { describe, expect, it } from 'vitest';
import { generateMapAsync } from './generate';
import { Simulation } from '../sim/simulation';
import { findPath } from '../sim/network/pathfinding';
import { connect } from './roads';
import { applyLayers, decodeSave, encodeSave } from '../save/serialize';

describe('巨大マップ(65535²)', () => {
  it('地形は遅延生成・同一シードで同一、街は区画ごとに生まれる', async () => {
    // generateMapAsync は IndexedDB/Worker を使うので巨大マップ経路だけ直接使う
    const map = await generateMapAsync(65535, 7, () => {});
    expect(map.chunked).toBe(true);
    const h = map.heightAt(40000, 50000);
    const map2 = await generateMapAsync(65535, 7, () => {});
    expect(map2.heightAt(40000, 50000)).toBe(h);
    const sim = new Simulation(map);
    expect(map.towns.length).toBeGreaterThanOrEqual(2);
    const t = map.towns[0];
    for (let i = 0; i < 500; i++) sim.step();
    expect(map.towns.reduce((s, x) => s + x.pop, 0)).toBeGreaterThan(0);
    // 区画が増えれば街が増える
    const n0 = map.towns.length;
    sim.discoverNear(t.x + 2048, t.y + 2048, 1);
    expect(map.towns.length).toBeGreaterThanOrEqual(n0);
  }, 60000);

  it('最遠端(index > 2^31)でも道路・経路探索・セーブが壊れない', async () => {
    const map = await generateMapAsync(65535, 3, () => {});
    const S = 65535;
    const x = S - 40;
    const y = S - 20;
    // 平らでなくても道路は引ける(高低差は connect が判定)ので、通れる所を探す
    let n = 0;
    while (n < 20 && connect(map, x + n, y, 1, false)) n++;
    expect(n).toBeGreaterThan(0);
    const p = findPath(map, map.idx(x, y), map.idx(x + n, y));
    expect(p && p[p.length - 1]).toBe(map.idx(x + n, y));
    const sim = new Simulation(map);
    const d = await decodeSave((await encodeSave(map, sim.state())) as Uint8Array<ArrayBuffer>);
    const m2 = await generateMapAsync(65535, 3, () => {});
    applyLayers(m2, d);
    expect(m2.road.get(map.idx(x, y))).toBe(map.road.get(map.idx(x, y)));
    expect(m2.road.get(map.idx(x, y))).not.toBe(0);
  }, 60000);
});

import { bigHeight } from './bigTerrain';
import { SEA_LEVEL } from './constants';
describe('巨大マップの地形(海の量と川)', () => {
  it('陸が6〜8割で、川(海ではない低地に掘られた水路)がある。同じシードで同一', () => {
    for (const seed of [3, 20260401]) {
      let land = 0, n = 0;
      for (let y = 0; y < 65535; y += 700) for (let x = 0; x < 65535; x += 700) {
        n++;
        if (bigHeight(x, y, seed, 5) > SEA_LEVEL) land++;
      }
      expect(land / n).toBeGreaterThan(0.6);
      expect(land / n).toBeLessThan(0.82);
      let river = 0;
      for (let y = 30000; y < 32000; y += 2) for (let x = 30000; x < 32000; x += 2) if (bigHeight(x, y, seed, 5) > SEA_LEVEL && bigHeight(x, y, seed) <= SEA_LEVEL) river++;
      expect(river).toBeGreaterThan(50);
      expect(bigHeight(31234, 30567, seed)).toBe(bigHeight(31234, 30567, seed));
    }
  });
});
