import { describe, expect, it } from 'vitest';
import kit from '../data/stationKit.json';
import { GameMap } from './gameMap';
import { SEA_LEVEL } from './constants';
import { STATION_DESIGN_MAX, STATION_KIT_BASE, STATION_KIT_COUNT, designName, isKitDesign, planStation } from './stations';

describe('駅のデザイン(スプライト 100〜179)', () => {
  it('80種あり、名前が重複せず、番号の範囲で新旧が分かれる', () => {
    expect(STATION_KIT_COUNT).toBe(80);
    expect(STATION_DESIGN_MAX).toBe(STATION_KIT_BASE + 80);
    expect(isKitDesign(99)).toBe(false);
    expect(isKitDesign(100)).toBe(true);
    const names = new Set<string>();
    for (let d = STATION_KIT_BASE; d < STATION_DESIGN_MAX; d++) names.add(designName(d));
    expect(names.size).toBe(80);
    expect(designName(STATION_KIT_BASE)).toBe(kit.styles[0].name);
  });
  it('描画に使うピース(屋根・ガラス屋根・待合・跨線橋の左右)がアトラスにある', () => {
    for (const name of ['can', 'cang', 'shel', 'brg']) for (const side of ['R', 'L']) expect(kit.pieces).toContain(`${name}_${side}`);
  });
  it('置けるデザイン番号は 0〜179。範囲外は端に丸める', () => {
    const size = 64;
    const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 20));
    expect(planStation(map, 10, 10, { axis: 1, len: 4, tracks: 2, design: 150 }, () => false).info.design).toBe(150);
    expect(planStation(map, 10, 10, { axis: 1, len: 4, tracks: 2, design: 99999 }, () => false).info.design).toBe(STATION_DESIGN_MAX - 1);
    expect(planStation(map, 10, 10, { axis: 1, len: 4, tracks: 2, design: -3 }, () => false).info.design).toBe(0);
  });
});
