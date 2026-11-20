import { SEA_LEVEL } from './constants';

/** 32bit整数ハッシュ(格子点の乱数) */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 値ノイズ(0..1) */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export interface TerrainOptions {
  size: number;
  seed: number;
  /** 進捗(0..1)通知。行ブロックごとに呼ばれる */
  onProgress?: (p: number) => void;
}

/**
 * 高度マップを生成する(size x size, Uint8, 行優先 index = y*size + x)。
 * 同じ size/seed なら常に同一結果。地形の特徴サイズはマップサイズに比例させる。
 */
/** 直近の generateTerrain で掘った川タイル数(テスト・調整用) */
export let riverTiles = 0;

export function generateTerrain({ size, seed, onProgress }: TerrainOptions): Uint8Array {
  const out = new Uint8Array(size * size);
  const octaves = Math.max(5, Math.floor(Math.log2(size / 16)) + 1); // 最小波長 ~4タイルまで
  const baseFreq = 4 / size; // 大陸スケール: マップ全体で約4周期
  const ridgeFreq = 6 / size;
  const progressEvery = Math.max(1, size >> 6);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let amp = 1;
      let freq = baseFreq;
      let sum = 0;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += valueNoise(x * freq, y * freq, seed + o * 101) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      let n = sum / norm; // 概ね 0.2..0.8
      // 山岳: リッジノイズを陸地にのみ加算
      const r = 1 - Math.abs(valueNoise(x * ridgeFreq, y * ridgeFreq, seed + 997) * 2 - 1);
      const t = (n - 0.54) * 2.2 + 0.5;
      n = t + (t > 0.5 ? Math.pow(r, 4) * 0.25 * (t - 0.4) : 0);
      const h = Math.round(n * 255);
      out[y * size + x] = h < 0 ? 0 : h > 255 ? 255 : h;
    }
    if (onProgress && y % progressEvery === 0) onProgress(y / size);
  }
  riverTiles = carveRivers(out, size, seed);
  onProgress?.(1);
  return out;
}

/** 川の岸の高さ(1段目)。川は海面(段0)まで掘り下げ、岸を低くして橋をかけやすくする */
const BANK = SEA_LEVEL + 10;

/**
 * 山の中腹から海へ向かって低い方へ流れる川を掘る(決定論的)。
 * 川は高度を海面以下にした4連結のタイル列で、両岸は最大で段1に均す。
 */
export function carveRivers(h: Uint8Array, size: number, seed: number): number {
  let carved = 0;
  const count = Math.min(40, Math.max(2, Math.round(size / 128)));
  const visited = new Set<number>();
  const DXS = [0, 1, 0, -1];
  const DYS = [-1, 0, 1, 0];
  for (let r = 0; r < count; r++) {
    // 水源: 段3〜5あたりの陸地を乱数で探す
    let cur = -1;
    for (let t = 0; t < 60 && cur < 0; t++) {
      const x = Math.floor(hash(r, t, seed + 5001) * size);
      const y = Math.floor(hash(t, r, seed + 5003) * size);
      const lv = h[y * size + x] - SEA_LEVEL;
      if (lv >= 40 && lv <= 90 && !visited.has(y * size + x)) cur = y * size + x;
    }
    if (cur < 0) continue;
    const path: number[] = [];
    const local = new Set<number>();
    for (let step = 0; step < size * 3; step++) {
      path.push(cur);
      local.add(cur);
      if (h[cur] <= SEA_LEVEL) break; // 海・湖に到達
      const cx = cur % size;
      const cy = Math.floor(cur / size);
      let best = -1;
      let bestV = Infinity;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DXS[d];
        const ny = cy + DYS[d];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const k = ny * size + nx;
        if (local.has(k)) continue;
        const v = h[k] + hash(k, step, seed + 7001) * 4;
        if (v < bestV) {
          bestV = v;
          best = k;
        }
      }
      if (best < 0) break;
      cur = best;
    }
    for (const k of path) {
      visited.add(k);
      const x = k % size;
      const y = Math.floor(k / size);
      for (let d = 0; d < 4; d++) {
        const nx = x + DXS[d];
        const ny = y + DYS[d];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const nk = ny * size + nx;
        if (h[nk] > BANK) h[nk] = BANK;
      }
    }
    for (const k of path) {
      if (h[k] > SEA_LEVEL) carved++;
      h[k] = Math.min(h[k], SEA_LEVEL);
    }
  }
  return carved;
}

/** 海でないタイルの割合(テスト・調整用) */
export function landRatio(height: Uint8Array): number {
  let land = 0;
  for (let i = 0; i < height.length; i++) if (height[i] > SEA_LEVEL) land++;
  return land / height.length;
}
