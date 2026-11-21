import { type Facility, sizeMul } from './facilities';
import { TIERS, townTier, type Town } from './town';

/** 病院の効果: 近くの街の成長が速くなる(病院があると人が住みやすい)。大きさ L の病院1件あたりの上乗せ(S/M は大きさの倍率で小さい) */
export const HOSPITAL_GROWTH = 0.25;
/** 複数あっても、上乗せの上限(成長が最大 +60% の速さ) */
export const HOSPITAL_GROWTH_MAX = 0.6;
/** 病院が街に届く距離: 街の広がり(半径)の何倍まで */
export const HOSPITAL_REACH = 1.2;

/** 病院 h が、その街に届くか */
export function hospitalServes(h: Pick<Facility, 'x0' | 'y0' | 'w' | 'h'>, town: Pick<Town, 'x' | 'y' | 'pop' | 'tier'>): boolean {
  return Math.hypot(h.x0 + h.w / 2 - town.x, h.y0 + h.h / 2 - town.y) <= TIERS[townTier(town)].radius * HOSPITAL_REACH;
}

/** 街の成長の速さへの上乗せ(0〜MAX)と、届いている病院の数。持ち主を問わず街全体のために働く(同じ街の病院は重ねるほど効くが上限あり) */
export function hospitalGrowth(map: { facilities: Facility[] }, town: Pick<Town, 'x' | 'y' | 'pop' | 'tier'>): { bonus: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const f of map.facilities) {
    if (f.type !== 'hospital' || !hospitalServes(f, town)) continue;
    count++;
    sum += HOSPITAL_GROWTH * sizeMul('hospital', f.size);
  }
  return { bonus: Math.min(HOSPITAL_GROWTH_MAX, sum), count };
}
