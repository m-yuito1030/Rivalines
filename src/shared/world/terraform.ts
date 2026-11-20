import { MAX_LEVEL, SEA_LEVEL, levelOf } from './constants';
import type { GameMap } from './gameMap';

/** 段数 → 高度(その段の中央値)。0 は海 */
export const heightOfLevel = (lvl: number): number => (lvl <= 0 ? SEA_LEVEL - 6 : SEA_LEVEL + 1 + (Math.min(lvl, MAX_LEVEL) - 1) * 16 + 8);

/** 構造物のないタイルだけ整地できる */
export function canTerraform(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  return !(map.road.get(i) || map.rail.get(i) || map.air.get(i) || map.building.get(i));
}

/** タイルを指定の段数にする。変更したら true */
export function setLevel(map: GameMap, x: number, y: number, lvl: number): boolean {
  if (!canTerraform(map, x, y)) return false;
  const target = Math.max(0, Math.min(MAX_LEVEL, lvl));
  if (levelOf(map.heightAt(x, y)) === target) return false;
  map.setHeight(x, y, heightOfLevel(target));
  return true;
}

export const raise = (map: GameMap, x: number, y: number) => setLevel(map, x, y, levelOf(map.heightAt(x, y)) + 1);
export const lower = (map: GameMap, x: number, y: number) => setLevel(map, x, y, levelOf(map.heightAt(x, y)) - 1);

export const MAX_TERRAFORM_AREA = 128;
