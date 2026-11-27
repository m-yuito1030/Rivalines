import { type Facility, sizeMul } from './facilities';
import { TIERS, townTier, type Town } from './town';

/** Hospital effect: nearby towns grow faster (people find it easier to live near a hospital). The bonus per L-size hospital (S/M are smaller, by the size multiplier) */
export const HOSPITAL_GROWTH = 0.25;
/** Cap on the bonus however many there are (growth is at most +60% faster) */
export const HOSPITAL_GROWTH_MAX = 0.6;
/** How far a hospital reaches a town: up to this many times the town's extent (radius) */
export const HOSPITAL_REACH = 1.2;

/** Whether hospital h reaches that town */
export function hospitalServes(h: Pick<Facility, 'x0' | 'y0' | 'w' | 'h'>, town: Pick<Town, 'x' | 'y' | 'pop' | 'tier'>): boolean {
  return Math.hypot(h.x0 + h.w / 2 - town.x, h.y0 + h.h / 2 - town.y) <= TIERS[townTier(town)].radius * HOSPITAL_REACH;
}

/** The bonus to a town's growth speed (0..MAX) and the number of hospitals reaching it. It works for the whole town regardless of owner (hospitals in the same town add up, up to the cap) */
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
