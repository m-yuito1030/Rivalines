import { SEA_LEVEL } from './constants';

/** 32-bit integer hash (random numbers at lattice points) */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise (0..1) */
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
  /** Notifies progress (0..1). Called once per block of rows */
  onProgress?: (p: number) => void;
}

/**
 * Generate the height map (size x size, Uint8, row-major index = y*size + x).
 * Always the same result for the same size/seed. Terrain feature size is proportional to the map size.
 */
/** Number of river tiles dug by the latest generateTerrain (for tests and tuning) */
export let riverTiles = 0;

export function generateTerrain({ size, seed, onProgress }: TerrainOptions): Uint8Array {
  const out = new Uint8Array(size * size);
  const octaves = Math.max(5, Math.floor(Math.log2(size / 16)) + 1); // down to a shortest wavelength of ~4 tiles
  const baseFreq = 4 / size; // continent scale: about 4 periods across the map
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
      let n = sum / norm; // roughly 0.2..0.8
      // Mountains: add ridge noise only on land
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

/** Height of a river bank (level 1). Rivers are dug down to sea level (level 0) and the banks are lowered so bridges are easy to build */
const BANK = SEA_LEVEL + 10;

/**
 * Dig rivers that flow downhill from mountainsides to the sea (deterministic).
 * A river is a 4-connected run of tiles with height at or below sea level, and both banks are levelled to at most level 1.
 */
export function carveRivers(h: Uint8Array, size: number, seed: number): number {
  let carved = 0;
  const count = Math.min(40, Math.max(2, Math.round(size / 128)));
  const visited = new Set<number>();
  const DXS = [0, 1, 0, -1];
  const DYS = [-1, 0, 1, 0];
  for (let r = 0; r < count; r++) {
    // Source: look for land around levels 3-5 at random
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
      if (h[cur] <= SEA_LEVEL) break; // reached the sea or a lake
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

/** Share of tiles that are not sea (for tests and tuning) */
export function landRatio(height: Uint8Array): number {
  let land = 0;
  for (let i = 0; i < height.length; i++) if (height[i] > SEA_LEVEL) land++;
  return land / height.length;
}
