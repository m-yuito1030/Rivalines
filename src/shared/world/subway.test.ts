import { describe, expect, it } from 'vitest';
import { GameMap } from './gameMap';
import { SEA_LEVEL } from './constants';
import { hasSub, subConn, subDepth, subwayCost, subwayLine, layNewSubway, removeSubwayLine } from './subway';
import { encodeSave, decodeSave, applyLayers } from '../save/serialize';

/** A flat land map: every tile is above the water */
function land(size = 64): GameMap {
  return new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
}
const io = (cash = 1e9) => {
  const log: string[] = [];
  let c = cash;
  return { log, io: { afford: (n: number) => c >= n, pay: (n: number) => ((c -= n), true), msg: (s: string) => log.push(s) }, cash: () => c };
};

describe('subway', () => {
  it('the depth changes evenly along a line, and a too-short line is refused', () => {
    expect(subwayLine({ x: 0, y: 0 }, { x: 3, y: 0 }, 1, 4)?.map((t) => t.depth)).toEqual([1, 2, 3, 4]);
    expect(subwayLine({ x: 0, y: 0 }, { x: 2, y: 0 }, 1, 4)).toBeNull();
  });

  it('lays connected tiles, charges more for deeper tiles, and removes them again', () => {
    const m = land();
    const t = io();
    layNewSubway(m, { x: 2, y: 5 }, { x: 5, y: 5 }, 1, 4, t.io);
    const v = m.subway.get(m.idx(3, 5));
    expect(hasSub(v)).toBe(true);
    expect(subDepth(v)).toBe(2);
    expect(subConn(v)).toBe(0b1010); // east + west
    expect(1e9 - t.cash()).toBe([1, 2, 3, 4].reduce((s, d) => s + subwayCost(d), 0));
    removeSubwayLine(m, { x: 3, y: 5 }, { x: 4, y: 5 }, t.io);
    expect(hasSub(m.subway.get(m.idx(3, 5)))).toBe(false);
    expect(subConn(m.subway.get(m.idx(2, 5)))).toBe(0); // the link to the removed tile is gone
  });

  it('refuses a depth jump of more than one level against an existing line', () => {
    const m = land();
    const t = io();
    layNewSubway(m, { x: 2, y: 5 }, { x: 4, y: 5 }, 1, 1, t.io);
    layNewSubway(m, { x: 4, y: 5 }, { x: 4, y: 9 }, 4, 4, t.io);
    expect(t.log.length).toBeGreaterThan(0);
  });

  it('stops when funds run out and survives a save round trip', async () => {
    const m = land();
    const t = io(subwayCost(1) * 2);
    layNewSubway(m, { x: 2, y: 5 }, { x: 8, y: 5 }, 1, 1, t.io);
    expect(hasSub(m.subway.get(m.idx(3, 5)))).toBe(true);
    expect(hasSub(m.subway.get(m.idx(4, 5)))).toBe(false);
    const bytes = await encodeSave(m, {} as never);
    const d = await decodeSave(bytes);
    expect(d.header.version).toBe(6);
    const m2 = land();
    applyLayers(m2, d);
    expect(m2.subway.get(m2.idx(3, 5))).toBe(m.subway.get(m.idx(3, 5)));
  });
});

describe('subway diagonals', () => {
  it('a drag at about 45 degrees lays a diagonal track, connected at both ends in the diagonal directions', () => {
    const m = land();
    const t = io();
    layNewSubway(m, { x: 10, y: 10 }, { x: 16, y: 16 }, 2, 2, t.io);
    const mid = m.subway.get(m.idx(13, 13));
    expect(hasSub(mid)).toBe(true);
    // Direction 5 (SE) and 7 (NW): the diagonal bits in the surface rail's layout
    expect(subConn(mid)).toBe((1 << 5) | (1 << 7));
    // The simulation sees the same connections through railAt
    expect(m.railAt(m.idx(13, 13)) & 0xf0).toBe((1 << 5) | (1 << 7));
    expect(t.log).toEqual([]);
  });

  it('removing a diagonal track clears the links on the neighbours', () => {
    const m = land();
    const t = io();
    layNewSubway(m, { x: 10, y: 10 }, { x: 16, y: 16 }, 1, 1, t.io);
    removeSubwayLine(m, { x: 12, y: 12 }, { x: 13, y: 13 }, t.io);
    expect(hasSub(m.subway.get(m.idx(12, 12)))).toBe(false);
    expect(subConn(m.subway.get(m.idx(11, 11)))).toBe(1 << 7); // only its link back to (10,10) is left
  });

  it('saves with diagonal bits survive a round trip', async () => {
    const m = land();
    layNewSubway(m, { x: 10, y: 10 }, { x: 16, y: 16 }, 3, 3, io().io);
    const d = await decodeSave(await encodeSave(m, {} as never));
    const m2 = land();
    applyLayers(m2, d);
    expect(m2.subway.get(m2.idx(13, 13))).toBe(m.subway.get(m.idx(13, 13)));
  });
});
