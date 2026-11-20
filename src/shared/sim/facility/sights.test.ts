import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { FACILITY_SPECS, FACILITY_TYPES, hourFactor } from '../../world/facilities';
import { GameMap } from '../../world/gameMap';
import { townTier } from '../../world/town';
import { makeRng } from '../../world/towns';
import { Simulation } from '../simulation';
import { placePublicFacilities, sightTarget } from './publicFacilities';
import sights from '../../data/sights.json';
import { type SightMeta, sightFits } from '../../data/sightTiers';

const flat = (size = 256, seed = 5) => new GameMap(size, seed, new Uint8Array(size * size).fill(SEA_LEVEL + 10));

describe('ご当地の観光地', () => {
  it('ユーザーは建てられず、日中(9〜17時)だけ需要がある', () => {
    expect(FACILITY_TYPES).not.toContain('sight');
    const s = FACILITY_SPECS.sight;
    expect(s.public).toBe(true);
    for (const h of [10, 12, 15]) expect(hourFactor(s, h)).toBe(1);
    for (const h of [0, 3, 6, 20, 23]) expect(hourFactor(s, h)).toBeLessThan(0.05);
  });
  it('規模に合うデザインだけ: 村には高層タワー・カジノ・大型アウトレットがなく、都市には全種類の道がある', () => {
    const m = sights as SightMeta[];
    const find = (cat: string, type: string) => m.findIndex((x) => x.cat === cat && x.type === type);
    expect(sightFits(m[find('タワー', 'スカイツリー風')], 0)).toBe(false);
    expect(sightFits(m[find('タワー', 'スカイツリー風')], 1)).toBe(false);
    expect(sightFits(m[find('タワー', 'スカイツリー風')], 2)).toBe(true);
    expect(sightFits(m[find('タワー', '灯台')], 0)).toBe(true);
    expect(sightFits(m[find('カジノ', 'ピラミッド型')], 1)).toBe(false);
    expect(sightFits(m[find('アウトレット', 'ガラスアーケード')], 1)).toBe(false);
    expect(sightFits(m[find('神社', '小さな祠+御神木')], 2)).toBe(false);
    for (const t of [0, 1, 2]) expect(m.filter((x) => sightFits(x, t)).length).toBeGreaterThan(15); // どの規模にも十分な種類
    expect(m.every((x) => sightFits(x, 2) || sightFits(x, 1) || sightFits(x, 0))).toBe(true);
  });
  it('村・街・都市の各街に1〜3か所が自動で生まれる(特大都市・首都にはない)。180種の見た目', () => {
    expect(sights).toHaveLength(180);
    const map = flat();
    const sim = new Simulation(map);
    const rng = makeRng(9);
    for (let i = 0; i < 200; i++) placePublicFacilities(map, sim.transit, rng);
    expect(map.towns.length).toBeGreaterThanOrEqual(2);
    for (const t of map.towns) {
      const n = map.facilities.filter((f) => f.type === 'sight' && f.townId === t.id).length;
      expect(n).toBeLessThanOrEqual(3);
      expect(sightTarget(t)).toBeGreaterThanOrEqual(1);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(townTier(t)).toBeLessThanOrEqual(2);
    }
    for (const f of map.facilities.filter((x) => x.type === 'sight')) {
      expect(f.owner).toBe('public');
      expect(f.design).toBeGreaterThanOrEqual(0);
      expect(f.design).toBeLessThan(180);
      const town = map.towns.find((x) => x.id === f.townId)!;
      expect(sightFits((sights as SightMeta[])[f.design!], townTier(town))).toBe(true); // 村にタワーなどが出ない
      expect(['S', 'M', 'L']).toContain(f.size);
    }
    // 特大都市・首都は対象外
    expect(sightTarget({ x: 1, y: 1, pop: 100000, tier: 3 } as never)).toBe(0);
    expect(sightTarget({ x: 1, y: 1, pop: 300000, tier: 4 } as never)).toBe(0);
  });
});
