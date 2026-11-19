import { describe, expect, it } from 'vitest';
import { SEA_LEVEL, levelOf } from './constants';
import { GameMap } from './gameMap';
import { connect } from './roads';
import { lower, raise, setLevel } from './terraform';
import { Simulation } from '../sim/simulation';
import { applyLayers, decodeSave, encodeSave } from '../save/serialize';
import { generateTerrain } from './terrain';

const flat = (size = 32) => new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 20));

describe('terraform', () => {
  it('上げ下げで段数が1ずつ変わり、海まで下げられる', () => {
    const m = flat();
    const l0 = m.levelAt(5, 5);
    expect(raise(m, 5, 5)).toBe(true);
    expect(m.levelAt(5, 5)).toBe(l0 + 1);
    for (let i = 0; i < 10; i++) lower(m, 5, 5);
    expect(m.levelAt(5, 5)).toBe(0);
    expect(lower(m, 5, 5)).toBe(false);
  });
  it('構造物のあるタイルは整地できない', () => {
    const m = flat();
    connect(m, 5, 5, 1, false);
    expect(raise(m, 5, 5)).toBe(false);
    m.building.set(m.idx(8, 8), 1);
    expect(setLevel(m, 8, 8, 2)).toBe(false);
  });
  it('整地した隣接タイルも再描画対象になる', () => {
    const m = flat();
    const touched: string[] = [];
    m.onTouch = (x, y) => touched.push(`${x},${y}`);
    raise(m, 5, 5);
    expect(touched).toEqual(expect.arrayContaining(['5,5', '4,5', '5,4']));
  });
  it('整地の差分がセーブで復元される(地形はシードから再生成)', async () => {
    const size = 256;
    const map = new GameMap(size, 9, generateTerrain({ size, seed: 9 }));
    const sim = new Simulation(map);
    const before = map.heightAt(100, 100);
    setLevel(map, 100, 100, (levelOf(before) + 3) % 10);
    const edited = map.heightAt(100, 100);
    expect(edited).not.toBe(before);
    const d = await decodeSave((await encodeSave(map, sim.state())) as Uint8Array<ArrayBuffer>);
    const m2 = new GameMap(size, 9, generateTerrain({ size, seed: 9 }));
    applyLayers(m2, d);
    expect(m2.heightAt(100, 100)).toBe(edited);
    expect(m2.height).toEqual(map.height);
  });
});
