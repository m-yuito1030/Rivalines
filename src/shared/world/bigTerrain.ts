import { CHUNK } from './tileLayer';
import { SEA_LEVEL } from './constants';
import { GameMap } from './gameMap';

/** A map larger than this side length does not build everything; its terrain is generated chunk by chunk */
export const BIG_MAP_MIN = 8192;

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
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

/** Wavelength of the continents (tiles). Constant regardless of map size, so density is the same however large it is */
const CONTINENT = 1536;
const OCTAVES = 9; // shortest wavelength ~6 tiles

/** How much land there is. The larger, the less sea (0.54 gives about 50% land, 0.47 about 70%) */
const LAND_BIAS = 0.47;

const fbm2 = (x: number, y: number, seed: number) => (valueNoise(x, y, seed) * 2 + valueNoise(x * 2.3, y * 2.3, seed + 7)) / 3;

/** Height of a river bank (level 1). Rivers are dug down to sea level and the banks are lowered so bridges are easy to build */
const BANK = SEA_LEVEL + 10;
/** No rivers are dug above this height (about level 5) (they fade out naturally in the mountains) */
const RIVER_MAX = SEA_LEVEL + 75;

/**
 * An estimate of the distance to a river (tiles), and the river's half-width. Decided from coordinates alone, so it connects across chunks.
 * The river course is the line where low-frequency noise equals 0.5 (meandering gently); other noise separates stretches with a river from stretches without.
 */
function river(x: number, y: number, seed: number): { dist: number; half: number } | null {
  const mask = valueNoise(x / 2000, y / 2000, seed + 3011);
  if (mask < 0.3) return null;
  const taper = smooth(Math.min(1, (mask - 0.3) / 0.12)); // both ends of a river thin out and vanish
  const wx = x + (valueNoise(x / 400, y / 400, seed + 3001) - 0.5) * 300;
  const wy = y + (valueNoise(x / 400 + 41, y / 400 + 17, seed + 3002) - 0.5) * 300;
  const f = (px: number, py: number) => fbm2(px / 650, py / 650, seed + 3003);
  const v = f(wx, wy);
  const gx = Math.abs(f(wx + 3, wy) - v) / 3;
  const gy = Math.abs(f(wx, wy + 3) - v) / 3;
  const g = Math.max(1e-5, Math.hypot(gx, gy));
  return { dist: Math.abs(v - 0.5) / g, half: (1.4 + 1.6 * valueNoise(x / 300, y / 300, seed + 3021)) * taper };
}

/** Height (0..255) at one point. Always identical for the same seed (decided by coordinates alone). rivers=false omits rivers (for coarse lookups) */
export function bigHeight(x: number, y: number, seed: number, octaves = OCTAVES): number {
  let amp = 1;
  let freq = 1 / CONTINENT;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  let n = sum / norm;
  const rf = 1 / (CONTINENT * 0.7);
  const r = 1 - Math.abs(valueNoise(x * rf, y * rf, seed + 997) * 2 - 1);
  const t = (n - LAND_BIAS) * 2.2 + 0.5;
  n = t + (t > 0.5 ? Math.pow(r, 4) * 0.25 * (t - 0.4) : 0);
  let h = Math.round(n * 255);
  h = h < 0 ? 0 : h > 255 ? 255 : h;
  if (octaves >= OCTAVES && h > SEA_LEVEL && h <= RIVER_MAX + 30) {
    const rv = river(x, y, seed);
    if (rv) {
      if (rv.dist < rv.half && h <= RIVER_MAX) h = SEA_LEVEL;
      else if (rv.dist < rv.half + 2 && h > BANK) h = BANK;
    }
  }
  return h;
}

/** Heights of a chunk (64x64) */
export function bigChunk(cx: number, cy: number, seed: number): Uint8Array {
  const out = new Uint8Array(CHUNK * CHUNK);
  for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) out[ly * CHUNK + lx] = bigHeight(cx * CHUNK + lx, cy * CHUNK + ly, seed);
  return out;
}

/** Build a map with the same terrain on the server and the client (decided by coordinates and seed alone, so they agree without any communication) */
export function makeWorldMap(size: number, seed: number): GameMap {
  return new GameMap(
    size,
    seed,
    (cx, cy) => bigChunk(cx, cy, seed),
    (x, y) => bigHeight(x, y, seed, 5),
  );
}
