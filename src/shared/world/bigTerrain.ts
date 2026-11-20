import { CHUNK } from './tileLayer';
import { SEA_LEVEL } from './constants';
import { GameMap } from './gameMap';

/** この一辺を超えるマップは、全体を作らずチャンクごとに地形を生成する */
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

/** 大陸の波長(タイル)。マップサイズによらず一定なので、どれだけ広くても密度が同じ */
const CONTINENT = 1536;
const OCTAVES = 9; // 最小波長 ~6タイル

/** 陸地の多さ。大きいほど海が減る(0.54 で陸約50%、0.47 で約70%) */
const LAND_BIAS = 0.47;

const fbm2 = (x: number, y: number, seed: number) => (valueNoise(x, y, seed) * 2 + valueNoise(x * 2.3, y * 2.3, seed + 7)) / 3;

/** 川の岸の高さ(段1)。川は海面まで掘り下げ、岸を低くして橋を架けやすくする */
const BANK = SEA_LEVEL + 10;
/** この高さ(段5ほど)より高い所には川を掘らない(山の中で自然に消える) */
const RIVER_MAX = SEA_LEVEL + 75;

/**
 * 川までの距離(タイル)の見積もりと、川の半幅。座標だけで決まるので、チャンクをまたいでつながる。
 * 低周波ノイズの「値が0.5になる線」を川筋にし(ゆるやかに蛇行)、別のノイズで川のある区間/ない区間を分ける。
 */
function river(x: number, y: number, seed: number): { dist: number; half: number } | null {
  const mask = valueNoise(x / 2000, y / 2000, seed + 3011);
  if (mask < 0.3) return null;
  const taper = smooth(Math.min(1, (mask - 0.3) / 0.12)); // 川の両端は細く消える
  const wx = x + (valueNoise(x / 400, y / 400, seed + 3001) - 0.5) * 300;
  const wy = y + (valueNoise(x / 400 + 41, y / 400 + 17, seed + 3002) - 0.5) * 300;
  const f = (px: number, py: number) => fbm2(px / 650, py / 650, seed + 3003);
  const v = f(wx, wy);
  const gx = Math.abs(f(wx + 3, wy) - v) / 3;
  const gy = Math.abs(f(wx, wy + 3) - v) / 3;
  const g = Math.max(1e-5, Math.hypot(gx, gy));
  return { dist: Math.abs(v - 0.5) / g, half: (1.4 + 1.6 * valueNoise(x / 300, y / 300, seed + 3021)) * taper };
}

/** 1点の高度(0..255)。同じ seed なら常に同一(座標だけで決まる)。rivers=false で川を省く(粗い参照用) */
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

/** チャンク(64x64)の高度 */
export function bigChunk(cx: number, cy: number, seed: number): Uint8Array {
  const out = new Uint8Array(CHUNK * CHUNK);
  for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) out[ly * CHUNK + lx] = bigHeight(cx * CHUNK + lx, cy * CHUNK + ly, seed);
  return out;
}

/** サーバーとクライアントで同じ地形のマップを作る(座標とシードだけで決まるので、通信しなくても一致する) */
export function makeWorldMap(size: number, seed: number): GameMap {
  return new GameMap(
    size,
    seed,
    (cx, cy) => bigChunk(cx, cy, seed),
    (x, y) => bigHeight(x, y, seed, 5),
  );
}
