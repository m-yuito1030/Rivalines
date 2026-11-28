import { describe, expect, it } from 'vitest';
import { SPRITE_H, SPRITE_W, facilityGeom } from './buildingSprites';
import sheetInfo from '../../shared/data/facilitySprites.json';
import { SIZED_TYPES } from '../../shared/world/facilities';

type Band = { w: number; h: number; y0: number; cx: number; cy: number };
const bands = sheetInfo as unknown as Record<string, { sizes: Record<string, Band> }>;

describe('facilityGeom: 施設スプライトの切り出しと描画位置', () => {
  it('大きさごとにセルが違う施設: アトラスの帯からデザインの位置を引き、敷地の中心に足元を合わせる', () => {
    const f = { type: 'hotel' as const, design: 7, size: 'L' as const, w: 3 };
    const b = bands.hotel.sizes.L;
    expect(facilityGeom(f)).toEqual({ atlas: 'hotel', sx: (7 % 5) * b.w, sy: b.y0 + Math.floor(7 / 5) * b.h, w: b.w, h: b.h, dx: -b.cx, dy: -(3 - 2) * 16 - b.cy });
    // 1x1 の敷地は中心がタイルの中心(手前タイルの上頂点から 16 下)
    const s = { type: 'cinema' as const, design: 0, size: 'S' as const, w: 1 };
    expect(facilityGeom(s)!.dy).toBe(16 - bands.cinema.sizes.S.cy);
    // 敷地の大きい遊園地・スタジアムも同じ規則
    const a = { type: 'amusement' as const, design: 3, size: 'L' as const, w: 5 };
    expect(facilityGeom(a)).toMatchObject({ atlas: 'amusement', w: bands.amusement.sizes.L.w, dy: -(5 - 2) * 16 - bands.amusement.sizes.L.cy });
  });

  it('学校・市役所・百貨店・モール: 15列のアトラス(種類 i は 行=⌊i/5⌋、列=(i%5)*3+S/M/L)。S/Mは1タイル、Lは2x2', () => {
    const d = { type: 'department' as const, design: 7, size: 'L' as const, w: 2 };
    expect(facilityGeom(d)).toEqual({ atlas: 'department', sx: ((7 % 5) * 3 + 2) * SPRITE_W, sy: Math.floor(7 / 5) * SPRITE_H, w: SPRITE_W, h: SPRITE_H, dx: -64, dy: 0 - 150 });
    const m = { type: 'mall' as const, design: 1, size: 'S' as const, w: 1 };
    expect(facilityGeom(m)).toMatchObject({ sx: (1 * 3 + 0) * SPRITE_W, dy: 16 - 150 });
  });

  it('描けないもの: デザインのない古い施設・スプライトのない種類は null', () => {
    expect(facilityGeom({ type: 'stadium', design: undefined, size: undefined, w: 4 })).toBeNull();
    expect(facilityGeom({ type: 'amusement', design: 2, size: undefined, w: 5 })).toBeNull();
    expect(facilityGeom({ type: 'stadium', design: 0, size: 'L', w: 4 })).not.toBeNull();
  });

  it('スプライトで描く全ての種類・全てのデザインで、切り出しがアトラスの範囲内に収まる', () => {
    for (const t of SIZED_TYPES) {
      const info = bands[t] as unknown as { count: number; sizes: Record<string, Band> };
      for (const size of ['S', 'M', 'L'] as const) {
        const b = info.sizes[size];
        for (let d = 0; d < info.count; d++) {
          const g = facilityGeom({ type: t, design: d, size, w: 3 })!;
          expect(g.sx + g.w).toBeLessThanOrEqual(5 * b.w);
          expect(g.sy).toBeGreaterThanOrEqual(b.y0);
        }
      }
    }
  });
});

describe('housing-complex blocks', () => {
  it('the mark is told apart from ordinary buildings, and every design can be picked', async () => {
    const { DANCHI_DESIGNS, DANCHI_VARIANT, isDanchi, makeBuilding } = await import('../../shared/world/buildings');
    expect(isDanchi(makeBuilding(3, DANCHI_VARIANT, false))).toBe(true);
    expect(isDanchi(makeBuilding(3, 24, false))).toBe(false); // an ordinary big building
    expect(isDanchi(makeBuilding(2, DANCHI_VARIANT, false))).toBe(false); // a small one is never a housing-complex block
    expect(isDanchi(makeBuilding(3, DANCHI_VARIANT, true))).toBe(false); // nor an office
    const { danchiDesignOf } = await import('./buildingSprites');
    const seen = new Set<number>();
    for (let i = 0; i < 100000; i++) seen.add(danchiDesignOf(i / 100000));
    expect(seen.size).toBe(DANCHI_DESIGNS);
    expect(Math.max(...seen)).toBe(DANCHI_DESIGNS - 1);
    expect(danchiDesignOf(1)).toBe(DANCHI_DESIGNS - 1); // hv = 1 does not run off the end
  });
});
