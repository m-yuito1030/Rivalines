import { describe, expect, it, vi } from 'vitest';
import { Mirror } from './mirror';
import { GameMap } from '../../shared/world/gameMap';
import { Simulation } from '../../shared/sim/simulation';
import { SEA_LEVEL } from '../../shared/world/constants';
import type { Facility } from '../../shared/world/facilities';

const fac = (over: Partial<Facility>): Facility => ({ id: 1, type: 'cinema', x0: 10, y0: 10, w: 2, h: 2, name: 'f', owner: 'player', design: 0, size: 'M', ...over }) as Facility;

describe('Mirror: 施設の更新', () => {
  it('デザインや大きさが変わった施設の敷地だけ、描き直す(タイルを更新する)。変わらない施設は触らない。新しく建った施設も描き直す(タイルが先に届くと施設の一覧がなく、絵が描かれないため)', () => {
    const map = new GameMap(64, 1, new Uint8Array(64 * 64).fill(SEA_LEVEL + 20));
    const mirror = new Mirror(map, new Simulation(map, undefined, { multi: true }));
    mirror.apply({ type: 'fac', facilities: [fac({}), fac({ id: 2, x0: 30, y0: 30 })] });
    const touch = vi.spyOn(map, 'touch');
    // 変化なし(グレードなど絵に関係ない変更)では何もしない
    mirror.apply({ type: 'fac', facilities: [fac({ grade: 3 }), fac({ id: 2, x0: 30, y0: 30 })] });
    expect(touch).not.toHaveBeenCalled();
    // 施設1のデザインが変わった → 敷地の 2x2 タイルだけ
    mirror.apply({ type: 'fac', facilities: [fac({ design: 5 }), fac({ id: 2, x0: 30, y0: 30 })] });
    expect(touch.mock.calls.map((c) => [c[0], c[1]]).sort()).toEqual([
      [10, 10],
      [10, 11],
      [11, 10],
      [11, 11],
    ]);
    touch.mockClear();
    // 大きさが変わった場合も
    mirror.apply({ type: 'fac', facilities: [fac({ design: 5, size: 'L', w: 3, h: 3 }), fac({ id: 2, x0: 30, y0: 30 })] });
    expect(touch).toHaveBeenCalledTimes(9);
    touch.mockClear();
    // 新しく建った施設: タイルの更新が先に届いて絵が描かれなかった可能性があるので、敷地を描き直す(ズームインしたまま現れない不具合)
    mirror.apply({ type: 'fac', facilities: [fac({ design: 5, size: 'L', w: 3, h: 3 }), fac({ id: 2, x0: 30, y0: 30 }), fac({ id: 3, x0: 40, y0: 40 })] });
    expect(touch.mock.calls.map((c) => [c[0], c[1]]).sort()).toEqual([
      [40, 40],
      [40, 41],
      [41, 40],
      [41, 41],
    ]);
  });
});
