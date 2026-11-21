import { describe, expect, it } from 'vitest';
import {
  CHOOSABLE,
  DESIGN_COUNT,
  FACILITY_SPECS,
  FACILITY_TYPES,
  NEW_FACILITY_TYPES,
  SIZED3,
  SKI_MIN_LEVEL,
  SPRITE_TYPES,
  facilityCost,
  facilityDims,
  nearRailStop,
  planFacility,
  siteRule,
} from './facilities';
import { GameMap } from './gameMap';
import { SEA_LEVEL } from './constants';
import sheetInfo from '../data/facilitySprites.json';
import { facilityDayMul, facilityEvent, isHoliday, seasonMul, weatherMul } from '../sim/world/events';

type Sheet = { count: number; names: string[]; sizes: Record<'S' | 'M' | 'L', { w: number; h: number; y0: number; cx: number; cy: number }> };
const sheets = sheetInfo as unknown as Record<string, Sheet>;

describe('新しい施設(映画館・動物園・スキー場・ビーチ・アリーナ・コンベンション・ビジネスホテル・大学・ゴルフ場・病院・駅ビル)', () => {
  it('全部、プレイヤーが建てられ、デザインと大きさを選べて、スプライトの枚数と一致する', () => {
    expect(NEW_FACILITY_TYPES).toHaveLength(11);
    for (const t of NEW_FACILITY_TYPES) {
      expect(FACILITY_TYPES).toContain(t);
      expect(CHOOSABLE).toContain(t);
      expect(SPRITE_TYPES).toContain(t);
      expect(SIZED3).toContain(t);
      const sh = sheets[t];
      expect(sh, `${t} のアトラス情報`).toBeDefined();
      expect(sh.count).toBe(DESIGN_COUNT[t]);
      expect(sh.names).toHaveLength(sh.count);
      expect(new Set(sh.names).size).toBe(sh.names.length); // 名前の重複なし
      // 大きさごとの帯が縦に積まれている(S → M → L)
      expect(sh.sizes.M.y0).toBeGreaterThan(sh.sizes.S.y0);
      expect(sh.sizes.L.y0).toBeGreaterThan(sh.sizes.M.y0);
      expect(facilityDims(t, 'S')).toEqual({ w: 1, h: 1 });
      expect(facilityDims(t, 'M')).toEqual({ w: 2, h: 2 });
      expect(facilityDims(t, 'L')).toEqual({ w: 3, h: 3 });
      expect(facilityCost(t, 'S')).toBeLessThan(facilityCost(t, 'M'));
      expect(facilityCost(t, 'M')).toBeLessThan(facilityCost(t, 'L'));
      expect(FACILITY_SPECS[t].desc.length).toBeGreaterThan(10);
    }
  });

  it('立地の条件: スキー場は標高4以上、ビーチは海のそば。ほかは条件なし', () => {
    const n = 64;
    const h = new Uint8Array(n * n).fill(SEA_LEVEL + 20); // 標高2の平地
    for (let y = 0; y < n; y++) for (let x = 0; x < 10; x++) h[y * n + x] = SEA_LEVEL - 5; // 左端が海
    for (let y = 40; y < 50; y++) for (let x = 40; x < 50; x++) h[y * n + x] = SEA_LEVEL + 16 * 4; // 高地(標高5)
    const map = new GameMap(n, 1, h);
    const free = () => false;
    expect(planFacility(map, 30, 30, 'ski', free, facilityDims('ski', 'L')).ok).toBe(false);
    expect(planFacility(map, 30, 30, 'ski', free, facilityDims('ski', 'L')).reason).toContain(`標高${SKI_MIN_LEVEL}`);
    expect(planFacility(map, 45, 45, 'ski', free, facilityDims('ski', 'L')).ok).toBe(true);
    expect(planFacility(map, 30, 30, 'beach', free, facilityDims('beach', 'L')).ok).toBe(false); // 海から遠い
    expect(planFacility(map, 12, 30, 'beach', free, facilityDims('beach', 'L')).ok).toBe(true); // 海のそば
    expect(planFacility(map, 30, 30, 'cinema', free, facilityDims('cinema', 'L')).ok).toBe(true);
    expect(siteRule(map, 'golf', 30, 30, 3, 3, 2)).toBeNull();
  });

  it('駅ビルは鉄道の駅(経由点を除く)から4タイル以内にだけ建てられる', () => {
    const plan = { x0: 20, y0: 20, w: 3, h: 3 };
    expect(nearRailStop([], plan, 4)).toBe(false);
    expect(nearRailStop([{ kind: 'road', x: 21, y: 21 }], plan, 4)).toBe(false); // バス停は不可
    expect(nearRailStop([{ kind: 'rail', x: 21, y: 21, waypoint: true }], plan, 4)).toBe(false); // 経由点は不可
    expect(nearRailStop([{ kind: 'rail', x: 26, y: 21 }], plan, 4)).toBe(true);
    expect(nearRailStop([{ kind: 'rail', x: 28, y: 21 }], plan, 4)).toBe(false); // 遠い
  });

  it('季節・天候・休日・イベント: 施設ごとの個性が出る', () => {
    expect(seasonMul('ski', 1)).toBeGreaterThan(seasonMul('ski', 7) * 10); // 冬に殺到、夏はほぼゼロ
    expect(weatherMul('ski', 'snow')).toBeGreaterThan(weatherMul('ski', 'sunny'));
    expect(seasonMul('beach', 8)).toBeGreaterThan(seasonMul('beach', 12) * 10);
    expect(weatherMul('beach', 'rain')).toBeLessThan(0.5);
    expect(weatherMul('cinema', 'rain')).toBeGreaterThan(1); // 遊園地とは逆に雨で増える
    expect(weatherMul('amusement', 'rain')).toBeLessThan(1);
    expect(seasonMul('campus', 8)).toBeLessThan(0.5);
    // 休日の判定(2026/4/5=日曜、4/29=祝日、4/2=平日の木曜)
    expect(isHoliday(4)).toBe(true);
    expect(isHoliday(28)).toBe(true);
    expect(isHoliday(1)).toBe(false);
    // どの種類・どの日でも、倍率は正の有限値
    for (const t of NEW_FACILITY_TYPES) {
      for (let d = 0; d < 400; d++) {
        const m = facilityDayMul(7, { id: 3, type: t }, d);
        expect(m).toBeGreaterThan(0);
        expect(Number.isFinite(m)).toBe(true);
      }
    }
    // コンサートは日が合えば大きく増える
    let found = 0;
    for (let d = 0; d < 200; d++) if (facilityEvent(5, { id: 2, type: 'arena' }, d)?.mul === 4) found++;
    expect(found).toBeGreaterThan(20);
  });
});
