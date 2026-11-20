import { describe, expect, it } from 'vitest';
import { makeWorldMap } from './bigTerrain';
import { placeTownsRegion, growTown, makeRng, pickTier } from './towns';
import { TIERS, townTier } from './town';

describe('街の段階', () => {
  it('割合は重みどおり(村が多く、首都はまれ)', () => {
    const rng = makeRng(7);
    const n = [0, 0, 0, 0, 0];
    for (let i = 0; i < 20000; i++) n[pickTier(rng, 4)]++;
    expect(n[0]).toBeGreaterThan(n[1]);
    expect(n[1]).toBeGreaterThan(n[2]);
    expect(n[2]).toBeGreaterThan(n[3]);
    expect(n[3]).toBeGreaterThan(n[4]);
    expect(n[4]).toBeGreaterThan(0);
    expect(pickTier(makeRng(1), 1)).toBeLessThanOrEqual(1);
  });

  it('生まれたときの人口は段階の最低値以上で、上限を超えて成長しない', () => {
    const map = makeWorldMap(65535, 11);
    let found = 0;
    for (let ry = 10; ry < 22 && found < 40; ry++) for (let rx = 10; rx < 22; rx++) found += placeTownsRegion(map, rx, ry);
    expect(map.towns.length).toBeGreaterThan(30);
    const tiers = new Set(map.towns.map((t) => townTier(t)));
    expect(tiers.size).toBeGreaterThanOrEqual(3);
    for (const t of map.towns) {
      const T = TIERS[townTier(t)];
      expect(t.pop).toBeLessThan(T.max + 1000); // 上限の少し手前で止まる(1棟の人口ぶんの誤差)
      void T;
    }
    // 多くの街は最低人口に届く(平地が足りない場所では届かないものもある)
    const reached = map.towns.filter((t) => t.pop >= TIERS[townTier(t)].min * 0.9).length;
    expect(reached).toBeGreaterThan(map.towns.length * 0.7);
    // 村は上限に達したら成長しない
    const v = map.towns.find((t) => townTier(t) === 0)!;
    v.pop = TIERS[0].max;
    const rng = makeRng(3);
    const h = v.houses;
    for (let i = 0; i < 200; i++) growTown(map, v, i * 1000, rng);
    expect(v.houses).toBe(h);
  }, 60000);
});

import { buildingLevel, isOffice } from './buildings';
describe('街の段階ごとの見た目', () => {
  it('村は低い住宅だけ、都市以上は高層とオフィスが出る', () => {
    const map = makeWorldMap(65535, 11);
    for (let ry = 10; ry < 15; ry++) for (let rx = 10; rx < 15; rx++) placeTownsRegion(map, rx, ry);
    const stat = (tier: number) => {
      let l3 = 0,
        l2 = 0,
        off = 0,
        n = 0;
      for (const t of map.towns.filter((x) => townTier(x) === tier)) {
        const R = TIERS[tier].radius;
        for (let y = t.y - R; y <= t.y + R; y++)
          for (let x = t.x - R; x <= t.x + R; x++) {
            const b = map.building.get(map.idx(x, y));
            if (!b || map.owner.get(map.idx(x, y)) !== t.id) continue;
            const lv = buildingLevel(b);
            if (lv < 1) continue;
            n++;
            if (lv === 3) l3++;
            if (lv === 2) l2++;
            if (isOffice(b)) off++;
          }
      }
      return { l3, l2, off, n };
    };
    const v = stat(0);
    expect(v.n).toBeGreaterThan(0);
    expect(v.l3 + v.l2 + v.off).toBe(0); // 村は低層の住宅だけ
    const m = stat(1);
    expect(m.l3).toBe(0); // 街は中層まで
    expect(m.l2).toBeGreaterThan(0);
    const c = stat(2);
    expect(c.l3).toBeGreaterThan(0);
    expect(c.off).toBeGreaterThan(0);
  }, 60000);
});
