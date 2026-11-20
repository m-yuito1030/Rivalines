/** 地形・描画の共通定数 */
export const SEA_LEVEL = 105; // 高度(0-255)がこれ以下は海
export const MAX_LEVEL = 10; // 陸地の段数(1..10)
export const LEVEL_PX = 8; // 1段あたりの描画上の高さ(px)
export const TILE_W = 64; // アイソメタイル幅
export const TILE_H = 32; // アイソメタイル高さ
export const MAP_SIZES = [256, 512, 1024, 2048, 4096, 16384, 65535] as const;

/** 高度値 → 段数(海=0, 陸=1..MAX_LEVEL) */
export function levelOf(h: number): number {
  return h <= SEA_LEVEL ? 0 : 1 + ((h - SEA_LEVEL) >> 4);
}
