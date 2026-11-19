import { CONN } from './directions';

export const NS = CONN(0) | CONN(2);
export const EW = CONN(1) | CONN(3);

/**
 * 同一タイルに道路と線路が共存できるか(踏切)。
 * どちらも直線で、互いに直交している場合のみ許可する。
 */
export function crossingOk(road: number, rail: number): boolean {
  const rc = road & 15;
  const tc = rail & 15;
  if (rail & 0xf0) return rc === 0; // 斜めの線路は道路と共存できない
  if (!rc || !tc) return true;
  return ((rc & ~NS) === 0 && (tc & ~EW) === 0) || ((rc & ~EW) === 0 && (tc & ~NS) === 0);
}
