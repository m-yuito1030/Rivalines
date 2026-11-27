import { MAX_LEVEL, SEA_LEVEL } from '../../shared/world/constants';

const rgb = (r: number, g: number, b: number) => `rgb(${r | 0},${g | 0},${b | 0})`;
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const shade = (c: number[], k: number) => c.map((v) => Math.min(255, v * k));

/** Base color per level (1 = beach ... 10 = snow) */
const LAND: number[][] = [
  [214, 200, 140], // 1 sand
  [104, 160, 70], // 2 grass
  [86, 148, 62], // 3
  [70, 130, 52], // 4 forest
  [96, 122, 62], // 5
  [128, 118, 88], // 6 rock
  [128, 112, 100], // 7
  [150, 140, 134], // 8
  [200, 200, 204], // 9
  [244, 246, 250], // 10 snow
];

const VARIANTS = 4;

/** top[level][variant], wall[level] */
export const topColors: string[][] = [];
export const wallColors: string[] = [];
/** By sea depth (0 = shallow .. 15 = deep) */
export const waterColors: string[] = [];
export const waterWall: string = rgb(30, 90, 150);

for (let l = 0; l <= MAX_LEVEL; l++) {
  const base = LAND[Math.max(0, l - 1)];
  topColors[l] = [];
  for (let v = 0; v < VARIANTS; v++) topColors[l].push(rgb(...(shade(base, 0.96 + v * 0.025) as [number, number, number])));
  wallColors[l] = rgb(...(shade(base, 0.62) as [number, number, number]));
}
for (let d = 0; d < 16; d++) {
  const c = mix([70, 150, 215], [14, 50, 110], d / 15);
  waterColors.push(rgb(c[0], c[1], c[2]));
}

/** Water color (height 0..SEA_LEVEL in 16 steps) */
export function waterColor(h: number): string {
  const d = Math.min(15, Math.max(0, Math.floor(((SEA_LEVEL - h) / SEA_LEVEL) * 16)));
  return waterColors[d];
}

/** Flat color for the minimap [r,g,b] */
export function flatColor(h: number): [number, number, number] {
  if (h <= SEA_LEVEL) {
    const d = (SEA_LEVEL - h) / SEA_LEVEL;
    return [70 - 56 * d, 150 - 100 * d, 215 - 105 * d];
  }
  let l = Math.min(MAX_LEVEL, 1 + ((h - SEA_LEVEL) >> 4));
  if (l === 1 && h > SEA_LEVEL + 3) l = 2;
  const c = LAND[l - 1];
  return [c[0], c[1], c[2]];
}
