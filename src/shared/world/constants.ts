/** Shared constants for terrain and drawing */
export const SEA_LEVEL = 105; // height (0-255) at or below this is sea
export const MAX_LEVEL = 10; // number of land levels (1..10)
export const LEVEL_PX = 8; // drawn height per level (px)
export const TILE_W = 64; // isometric tile width
export const TILE_H = 32; // isometric tile height
export const MAP_SIZES = [256, 512, 1024, 2048, 4096, 16384, 65535] as const;

/** Height value -> level (sea = 0, land = 1..MAX_LEVEL) */
export function levelOf(h: number): number {
  return h <= SEA_LEVEL ? 0 : 1 + ((h - SEA_LEVEL) >> 4);
}
