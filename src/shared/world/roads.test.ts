import { describe, expect, it } from 'vitest';
import { CONN, OUT } from './directions';
import { GameMap } from './gameMap';
import { bulldoze, connect, lineTiles, makeTwoWay } from './roads';
import { SEA_LEVEL } from './constants';

/** 全面が同じ高さの陸地マップ */
function flatMap(size = 32, h = SEA_LEVEL + 10): GameMap {
  return new GameMap(size, 1, new Uint8Array(size * size).fill(h));
}

describe('roads', () => {
  it('双方向の辺は両側の接続と通行ビットが立つ', () => {
    const m = flatMap();
    expect(connect(m, 5, 5, 1, false)).toBe(true); // 5,5 → 6,5 (E)
    expect(m.road.get(m.idx(5, 5))).toBe(CONN(1) | OUT(1));
    expect(m.road.get(m.idx(6, 5))).toBe(CONN(3) | OUT(3));
  });
  it('一方通行は進行方向の出口だけ通行可', () => {
    const m = flatMap();
    connect(m, 5, 5, 1, true);
    expect(m.road.get(m.idx(5, 5)) & OUT(1)).toBeTruthy();
    expect(m.road.get(m.idx(6, 5)) & OUT(3)).toBe(0);
    expect(m.road.get(m.idx(6, 5)) & CONN(3)).toBeTruthy();
  });
  it('逆向きに敷き直すと向きが反転し、双方向化で戻る', () => {
    const m = flatMap();
    connect(m, 5, 5, 1, true);
    connect(m, 6, 5, 3, true);
    expect(m.road.get(m.idx(5, 5)) & OUT(1)).toBe(0);
    expect(m.road.get(m.idx(6, 5)) & OUT(3)).toBeTruthy();
    makeTwoWay(m, 5, 5, 1);
    expect(m.road.get(m.idx(5, 5)) & OUT(1)).toBeTruthy();
    expect(m.road.get(m.idx(6, 5)) & OUT(3)).toBeTruthy();
  });
  it('海・段差・範囲外・建物には敷設できない', () => {
    const m = flatMap();
    m.height[m.idx(6, 5)] = 10; // 海
    expect(connect(m, 5, 5, 1, false)).toBe(false);
    m.height[m.idx(5, 6)] = SEA_LEVEL + 40; // 段差
    expect(connect(m, 5, 5, 2, false)).toBe(false);
    expect(connect(m, 0, 0, 0, false)).toBe(false);
    m.building.set(m.idx(4, 5), 1);
    expect(connect(m, 5, 5, 3, false)).toBe(false);
  });
  it('撤去で隣の接続ビットも消える', () => {
    const m = flatMap();
    connect(m, 5, 5, 1, false);
    bulldoze(m, 5, 5);
    expect(m.road.get(m.idx(5, 5))).toBe(0);
    expect(m.road.get(m.idx(6, 5))).toBe(0);
  });
  it('lineTiles は軸に揃う', () => {
    const t = lineTiles(2, 2, 6, 3);
    expect(t.map((p) => [p.x, p.y])).toEqual([[2, 2], [3, 2], [4, 2], [5, 2], [6, 2]]);
  });
});
