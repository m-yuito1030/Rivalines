import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { FACILITY_SPECS, FACILITY_TILE, FACILITY_TYPES, facilityAnchor, facilityTileMap, hourFactor, planFacility } from '../../world/facilities';
import { GameMap } from '../../world/gameMap';
import { bulldoze } from '../../world/roads';
import { makeRng } from '../../world/towns';
import { Simulation } from '../simulation';
import { SCHOOL_MIN_DISTANCE, placePublicFacilities, schoolTarget } from './publicFacilities';
import { DAY_TICKS } from '../network/transit';

const flat = (size = 192, seed = 3) => new GameMap(size, seed, new Uint8Array(size * size).fill(SEA_LEVEL + 10));

describe('公共施設(市役所・学校)', () => {
  it('プレイヤーが建てられる施設には含まれず、需要の時間帯が違う(市役所は一日中一定、学校は8時台と17時台)', () => {
    expect(FACILITY_TYPES).not.toContain('school');
    expect(FACILITY_TYPES).not.toContain('cityhall');
    const school = FACILITY_SPECS.school;
    const hall = FACILITY_SPECS.cityhall;
    for (const h of [0, 3, 8.5, 12, 17.5, 22]) expect(hourFactor(hall, h)).toBe(1); // 一定
    expect(hourFactor(school, 8.5)).toBe(1);
    expect(hourFactor(school, 17.5)).toBe(1);
    expect(hourFactor(school, 12)).toBeLessThan(0.15);
    expect(hourFactor(school, 3)).toBeLessThan(0.15);
    expect(hourFactor(school, 7.75)).toBeGreaterThan(hourFactor(school, 12)); // 直前から上がる
    expect(hourFactor(school, 17.5)).toBeGreaterThan(hourFactor(school, 10) * 5);
    // 従来の施設(単一の時間帯)の係数は変わらない
    expect(hourFactor(FACILITY_SPECS.stadium, 19)).toBe(1);
    expect(hourFactor(FACILITY_SPECS.stadium, 10)).toBeCloseTo(0.15);
  });
  it('市役所は1つの街に1つ(最初から建ち、何度呼んでも増えない)。学校は人口に応じて建ち、15タイル以上離れる', () => {
    const map = flat();
    const sim = new Simulation(map);
    const halls = () => map.facilities.filter((f) => f.type === 'cityhall');
    expect(map.towns.length).toBeGreaterThanOrEqual(2);
    expect(halls()).toHaveLength(map.towns.length); // 開始時点で各街に1つ
    for (const t of map.towns) expect(halls().filter((f) => f.townId === t.id)).toHaveLength(1);
    // 街を育てる
    for (let i = 0; i < 120000; i++) sim.step();
    const rng = makeRng(5);
    for (let i = 0; i < 30; i++) placePublicFacilities(map, sim.transit, rng);
    for (const t of map.towns) expect(halls().filter((f) => f.townId === t.id)).toHaveLength(1);
    const schools = map.facilities.filter((f) => f.type === 'school');
    expect(schools.length).toBeGreaterThan(0);
    // 学校どうしの間隔(中心の x か y の差が 15 以上)
    for (let i = 0; i < schools.length; i++) {
      for (let j = i + 1; j < schools.length; j++) {
        const a = schools[i];
        const b = schools[j];
        const dx = Math.abs(a.x0 + (a.w - 1) / 2 - (b.x0 + (b.w - 1) / 2));
        const dy = Math.abs(a.y0 + (a.h - 1) / 2 - (b.y0 + (b.h - 1) / 2));
        expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(SCHOOL_MIN_DISTANCE);
      }
    }
    // 見た目の情報と持ち主
    for (const f of [...schools, ...halls()]) {
      expect(f.owner).toBe('public');
      expect(['S', 'M', 'L']).toContain(f.size);
      expect(f.w).toBe(f.size === 'L' ? 2 : 1);
      expect(f.design).toBeGreaterThanOrEqual(0);
      expect(f.design).toBeLessThan(f.type === 'school' ? 20 : 100);
    }
    // 街の人口に見合う数を超えない
    for (const t of map.towns) expect(schools.filter((f) => f.townId === t.id).length).toBeLessThanOrEqual(schoolTarget(t.pop));
    // 敷地は FACILITY_TILE で、描画用の索引から引ける(手前のタイルが基準)
    const grid = facilityTileMap(map);
    for (const f of schools) {
      const a = facilityAnchor(map, f);
      expect(map.building.get(a)).toBe(FACILITY_TILE);
      expect(grid.get(a)).toBe(f);
    }
  });
  it('撤去・買収できない。敷地は他の建設を受け付けない。セーブで保たれる', () => {
    const map = flat();
    const sim = new Simulation(map);
    const hall = map.facilities.find((f) => f.type === 'cityhall')!;
    bulldoze(map, hall.x0, hall.y0);
    expect(map.facilities).toContain(hall);
    expect(map.building.get(map.idx(hall.x0, hall.y0))).toBe(FACILITY_TILE);
    expect(planFacility(map, hall.x0, hall.y0, 'park', () => false).ok).toBe(false);
    const st = JSON.parse(JSON.stringify(sim.state()));
    const m2 = flat();
    m2.building.copyFrom(map.building);
    const sim2 = new Simulation(m2, st);
    const hall2 = sim2.map.facilities.find((f) => f.type === 'cityhall' && f.townId === hall.townId)!;
    expect(hall2.design).toBe(hall.design);
    expect(hall2.size).toBe(hall.size);
    expect(hall2.owner).toBe('public');
    void DAY_TICKS;
  });
  it('需要: 学校の近くの停留所は8時台と17時台に乗客が増え、市役所の近くは一日中一定', () => {
    const map = flat();
    const sim = new Simulation(map);
    const tr = sim.transit;
    const hall = map.facilities.find((f) => f.type === 'cityhall')!;
    const road = [...map.towns[0].roads].find((i) => map.road.get(i))!;
    const stop = tr.addStop(road % map.size, Math.floor(road / map.size))!;
    // 学校を停留所の近くに直接置く(配置規則とは別に、需要の計算だけを確認)
    const f = { id: 900, type: 'school' as const, x0: stop.x + 1, y0: stop.y + 1, w: 1, h: 1, name: '学校', owner: 'public' as const, size: 'S' as const, design: 0 };
    map.facilities.push(f);
    map.facilityVer++;
    for (let t = 0; t < 120; t++) tr.step(t); // 集客圏の更新
    expect(stop.facs).toContain(f.id);
    const demand = (hour: number) => (tr as unknown as { facilityDemand: (s: unknown, t: number) => number }).facilityDemand(stop, ((hour * 60 - 6 * 60) / 1440) * DAY_TICKS + 0.5);
    const d8 = demand(8.5);
    const d12 = demand(12);
    const d17 = demand(17.5);
    // 近くに市役所もあるので、その一定の需要の上に学校の需要が8時台・17時台だけ乗る
    expect(d8 - d12).toBeGreaterThan(1000);
    expect(d17 - d12).toBeGreaterThan(1000);
    expect(Math.abs(demand(3) - demand(12))).toBeLessThan(1); // 学校の外の時間帯は市役所分のみで一定
    expect(demand(12)).toBeGreaterThanOrEqual(FACILITY_SPECS.cityhall.attract);
    void hall;
  });
});
