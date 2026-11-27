import { MAX_LEVEL, SEA_LEVEL, levelOf } from './constants';
import type { GameMap } from './gameMap';

/** Level -> height (the middle value of that level). 0 is sea */
export const heightOfLevel = (lvl: number): number => (lvl <= 0 ? SEA_LEVEL - 6 : SEA_LEVEL + 1 + (Math.min(lvl, MAX_LEVEL) - 1) * 16 + 8);

/** Only tiles with no structures can be terraformed */
export function canTerraform(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  return !(map.road.get(i) || map.rail.get(i) || map.air.get(i) || map.building.get(i));
}

/** Set a tile to the given level. True if it changed */
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
