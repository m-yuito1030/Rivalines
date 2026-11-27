import { CONN } from './directions';

export const NS = CONN(0) | CONN(2);
export const EW = CONN(1) | CONN(3);

/**
 * Whether a road and a rail can share the same tile (a level crossing).
 * Allowed only when both are straight and perpendicular to each other.
 */
export function crossingOk(road: number, rail: number): boolean {
  const rc = road & 15;
  const tc = rail & 15;
  if (rail & 0xf0) return rc === 0; // a diagonal rail cannot share a tile with a road
  if (!rc || !tc) return true;
  return ((rc & ~NS) === 0 && (tc & ~EW) === 0) || ((rc & ~EW) === 0 && (tc & ~NS) === 0);
}
