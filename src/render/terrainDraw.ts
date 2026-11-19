import { LEVEL_PX, SEA_LEVEL, TILE_H, TILE_W } from '../world/constants';
import type { GameMap } from '../world/gameMap';

/** 描画用の決定論的ハッシュ/ノイズ(座標とシードのみで決まる。ゲーム状態に影響しない) */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sm = (t: number) => t * t * (3 - 2 * t);
export function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = sm(x - xi);
  const fy = sm(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

type RGB = [number, number, number];
const css = (c: RGB, k = 1) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const SAND: RGB = [226, 210, 154];
const LUSH: RGB = [74, 146, 56];
const DRY: RGB = [152, 160, 76];
const ROCK: RGB = [126, 116, 100];
const HIGH_ROCK: RGB = [152, 144, 138];
const SNOW: RGB = [238, 242, 250];
const SOIL: RGB = [118, 90, 62];
const SHALLOW: RGB = [96, 178, 228];
const DEEP: RGB = [14, 56, 120];

/** 陸の地表色。湿度(草の濃さ)・斑・個体差で変化をつける */
export function landColor(map: GameMap, x: number, y: number, lvl: number, h: number): RGB {
  const s = map.seed;
  if (lvl === 1 && h <= SEA_LEVEL + 3) {
    const j = hash2(x, y, s + 3);
    return mixc(SAND, [236, 222, 170], j * 0.5);
  }
  const m = vnoise(x / 38, y / 38, s + 11); // 湿度
  const patch = vnoise(x / 6.5, y / 6.5, s + 23);
  const jit = hash2(x, y, s + 5);
  let c: RGB = mixc(LUSH, DRY, Math.max(0, Math.min(1, (m - 0.35) * 2)));
  // 同じ段の中でも高いほどわずかに明るく(なだらかな起伏の手がかり)
  const frac = ((h - SEA_LEVEL - 1) & 15) / 15;
  const k = 0.92 + patch * 0.14 + jit * 0.04 + (frac - 0.5) * 0.07;
  if (lvl <= 5) {
    c = c.map((v) => v * (1 - 0.045 * (lvl - 1))) as RGB;
    if (lvl === 5) c = mixc(c, ROCK, 0.35);
  } else if (lvl <= 7) c = mixc(ROCK, c, lvl === 6 ? 0.3 : 0.12);
  else if (lvl === 8) c = HIGH_ROCK;
  else if (lvl === 9) c = mixc(HIGH_ROCK, SNOW, 0.6);
  else c = SNOW;
  if (lvl >= 9) {
    // 雪面: 青みの影と氷のむらで単調さを避ける
    const ice = vnoise(x / 3.2, y / 3.2, s + 31);
    c = mixc(c, [196, 212, 236], Math.max(0, ice - 0.35) * 0.9);
  }
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function waterRGB(h: number): RGB {
  const d = Math.max(0, Math.min(1, (SEA_LEVEL - h) / SEA_LEVEL));
  return mixc(SHALLOW, DEEP, Math.pow(d, 0.8));
}

/** 森の密度(0..1)。草地(段2〜5)にだけ木を置く */
export function forestAt(map: GameMap, x: number, y: number): number {
  const s = map.seed;
  const f = vnoise(x / 17, y / 17, s + 77) * 0.72 + vnoise(x / 5, y / 5, s + 91) * 0.28;
  return Math.max(0, Math.min(1, (f - 0.5) / 0.18));
}

const HW = TILE_W / 2;
const HH = TILE_H / 2;

type Side = 'N' | 'E' | 'S' | 'W';
/** 辺の端点 (x0,y0,x1,y1): N=上→右, E=右→下, S=下→左, W=左→上 */
function edge(px: number, py: number, side: Side): [number, number, number, number] {
  switch (side) {
    case 'N':
      return [px, py, px + HW, py + HH];
    case 'E':
      return [px + HW, py + HH, px, py + TILE_H];
    case 'S':
      return [px, py + TILE_H, px - HW, py + HH];
    default:
      return [px - HW, py + HH, px, py];
  }
}

/** 辺に沿った帯(辺から中心方向へ f の幅)を塗る */
function strip(ctx: CanvasRenderingContext2D, px: number, py: number, side: Side, f: number, fill: string, alpha: number): void {
  const [x0, y0, x1, y1] = edge(px, py, side);
  const cx = px;
  const cy = py + HH;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 + (cx - x1) * f, y1 + (cy - y1) * f);
  ctx.lineTo(x0 + (cx - x0) * f, y0 + (cy - y0) * f);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function diamond(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + HW, py + HH);
  ctx.lineTo(px, py + TILE_H);
  ctx.lineTo(px - HW, py + HH);
  ctx.closePath();
}

export interface Neighbors {
  n: number;
  e: number;
  s: number;
  w: number;
}

/** 崖の壁(+x側=E面、+y側=S面)。地層の線と足元の影つき */
function drawWall(ctx: CanvasRenderingContext2D, px: number, py: number, side: 'E' | 'S', steps: number, top: RGB, sandy: boolean, detail: boolean): void {
  const d = steps * LEVEL_PX;
  const [x0, y0, x1, y1] = edge(px, py, side);
  const base = mixc(SOIL, top, sandy ? 0.6 : 0.25);
  const k = side === 'E' ? 0.74 : 0.56;
  ctx.fillStyle = css(base, k);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1, y1 + d);
  ctx.lineTo(x0, y0 + d);
  ctx.closePath();
  ctx.fill();
  // 足元ほど暗く
  ctx.fillStyle = 'rgba(20,10,0,0.22)';
  ctx.beginPath();
  ctx.moveTo(x0, y0 + d * 0.55);
  ctx.lineTo(x1, y1 + d * 0.55);
  ctx.lineTo(x1, y1 + d);
  ctx.lineTo(x0, y0 + d);
  ctx.closePath();
  ctx.fill();
  if (detail) {
    // 地層の線
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i < steps; i++) {
      ctx.beginPath();
      ctx.moveTo(x0, y0 + i * LEVEL_PX);
      ctx.lineTo(x1, y1 + i * LEVEL_PX);
      ctx.stroke();
    }
    // 上端のハイライト
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(x0, y0 + 0.5);
    ctx.lineTo(x1, y1 + 0.5);
    ctx.stroke();
  }
}

/** 地表(タイル上面)。lvl=0 は水面 */
export function drawTerrainTile(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  tx: number,
  ty: number,
  px: number,
  py: number,
  lvl: number,
  h: number,
  nb: Neighbors,
  detail: boolean,
  occupied: boolean,
  /** 粗いLOD用: 上面をこの色で塗り、装飾は省く */
  override?: string,
): void {
  const seed = map.seed;
  if (lvl > 0) {
    const top = landColor(map, tx, ty, lvl, h);
    const sandy = lvl === 1 && h <= SEA_LEVEL + 3;
    if (nb.e < lvl) drawWall(ctx, px, py, 'E', lvl - nb.e, top, sandy, detail);
    if (nb.s < lvl) drawWall(ctx, px, py, 'S', lvl - nb.s, top, sandy, detail);
    const fill = override ?? css(top);
    ctx.fillStyle = fill;
    diamond(ctx, px, py);
    ctx.fill();
    ctx.strokeStyle = fill; // 継ぎ目(ヘアライン)を隠す
    ctx.lineWidth = 1;
    ctx.stroke();

    // 高い隣接タイルの足元の影(N/W側)
    const dN = nb.n - lvl;
    const dW = nb.w - lvl;
    if (dN > 0) strip(ctx, px, py, 'N', 0.2, '#000', 0.16 + 0.05 * Math.min(dN, 3));
    if (dW > 0) strip(ctx, px, py, 'W', 0.2, '#000', 0.12 + 0.05 * Math.min(dW, 3));
    // 水辺の湿った砂/土
    if (lvl === 1) {
      if (nb.n === 0) strip(ctx, px, py, 'N', 0.16, '#6a5a38', 0.28);
      if (nb.w === 0) strip(ctx, px, py, 'W', 0.16, '#6a5a38', 0.28);
    }
    if (!detail || occupied || override) return;

    const hv = hash2(tx, ty, seed + 41);
    if (sandy) {
      ctx.fillStyle = 'rgba(120,100,60,0.35)';
      for (let i = 0; i < 4; i++) {
        const u = hash2(tx, ty, seed + 100 + i);
        const v = hash2(tx, ty, seed + 200 + i);
        ctx.fillRect(px + (u - v) * HW * 0.8, py + (u + v) * HH * 0.8 + 3, 1.4, 1);
      }
    } else if (lvl <= 5) {
      // 草のかたまり
      const dark = css(top, 0.82);
      const light = css(top, 1.14);
      for (let i = 0; i < 4; i++) {
        const u = 0.12 + hash2(tx, ty, seed + 300 + i) * 0.76;
        const v = 0.12 + hash2(tx, ty, seed + 400 + i) * 0.76;
        const gx = px + (u - v) * HW;
        const gy = py + (u + v) * HH;
        ctx.fillStyle = i & 1 ? dark : light;
        ctx.fillRect(gx - 1, gy - 2, 1.2, 3);
        ctx.fillRect(gx + 1, gy - 1, 1.2, 2);
      }
      if (hv > 0.965) {
        const col = hv > 0.985 ? '#fff6a8' : hv > 0.975 ? '#ffffff' : '#f6a0c0';
        ctx.fillStyle = col;
        ctx.fillRect(px + (hash2(tx, ty, seed + 9) - 0.5) * 24, py + 10 + hash2(tx, ty, seed + 10) * 10, 2, 2);
      }
    } else if (lvl <= 8) {
      // 岩肌のひび
      ctx.strokeStyle = 'rgba(40,30,20,0.28)';
      ctx.lineWidth = 1;
      const u = hash2(tx, ty, seed + 500);
      const v = hash2(tx, ty, seed + 501);
      const gx = px + (u - v) * HW * 0.6;
      const gy = py + 6 + (u + v) * HH * 0.6;
      ctx.beginPath();
      ctx.moveTo(gx - 5, gy);
      ctx.lineTo(gx, gy + 2);
      ctx.lineTo(gx + 6, gy - 1);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(150,175,215,0.22)';
      ctx.fillRect(px - 8 + hash2(tx, ty, seed + 600) * 10, py + 8 + hash2(tx, ty, seed + 601) * 8, 7, 2);
    }

    // 木
    if (!sandy && lvl <= 6) {
      const dens = forestAt(map, tx, ty);
      if (dens > 0) {
        const n = (hash2(tx, ty, seed + 61) < dens * 0.95 ? 1 : 0) + (hash2(tx, ty, seed + 62) < dens * 0.45 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const u = 0.22 + hash2(tx, ty, seed + 70 + i) * 0.56;
          const v = 0.22 + hash2(tx, ty, seed + 80 + i) * 0.56;
          const conifer = lvl >= 4 || hash2(tx, ty, seed + 90 + i) < 0.28;
          drawTree(ctx, px + (u - v) * HW, py + (u + v) * HH, conifer, hash2(tx, ty, seed + 95 + i), top);
        }
      }
    }
    return;
  }

  // 水面
  const wc = waterRGB(h);
  const fill = override ?? css(wc);
  ctx.fillStyle = fill;
  diamond(ctx, px, py);
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 1;
  ctx.stroke();
  // 岸: 浅い青の帯と白い波打ち際
  const shore: [Side, number][] = [['N', nb.n], ['E', nb.e], ['S', nb.s], ['W', nb.w]];
  for (const [side, l] of shore) {
    if (l > 0 && !override) {
      strip(ctx, px, py, side, 0.34, '#bfeaff', 0.28);
      strip(ctx, px, py, side, 0.12, '#ffffff', 0.55);
    }
  }
  if (detail) {
    // きらめき
    const g = hash2(tx, ty, seed + 7);
    if (g > 0.86) {
      const u = hash2(tx, ty, seed + 8);
      const v = hash2(tx, ty, seed + 9);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      const gx = px + (u - v) * HW * 0.7;
      const gy = py + (u + v) * HH * 0.7 + 2;
      ctx.beginPath();
      ctx.moveTo(gx - 4, gy);
      ctx.lineTo(gx + 4, gy);
      ctx.stroke();
    }
  }
}

/** 木1本。(x,y) は根元 */
function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, conifer: boolean, r: number, ground: RGB): void {
  const sc = 0.85 + r * 0.35;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 1, 8 * sc, 3.2 * sc, 0, 0, Math.PI * 2);
  ctx.fill();
  if (conifer) {
    ctx.fillStyle = '#5a3f2a';
    ctx.fillRect(x - 1, y - 4 * sc, 2, 4 * sc);
    const g = mixc([30, 92, 52], ground, 0.12);
    for (let i = 0; i < 3; i++) {
      const by = y - 3 * sc - i * 5.5 * sc;
      const w = (9.5 - i * 2.2) * sc;
      const tip = by - 9 * sc;
      ctx.fillStyle = css(g, 0.78);
      ctx.beginPath();
      ctx.moveTo(x, tip);
      ctx.lineTo(x + w, by);
      ctx.lineTo(x - w, by);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = css(g, 1.12);
      ctx.beginPath();
      ctx.moveTo(x, tip);
      ctx.lineTo(x, by);
      ctx.lineTo(x - w, by);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    const autumn = r > 0.965;
    const g: RGB = autumn ? [212, 122, 44] : mixc([58, 132, 50], [96, 156, 58], r);
    ctx.fillStyle = '#5e4330';
    ctx.fillRect(x - 1.2, y - 7 * sc, 2.4, 7 * sc);
    ctx.fillStyle = css(g, 0.72);
    ctx.beginPath();
    ctx.ellipse(x, y - 13 * sc, 8.2 * sc, 7.4 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(g, 1.0);
    ctx.beginPath();
    ctx.ellipse(x - 1.6 * sc, y - 14.5 * sc, 6 * sc, 5.4 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(g, 1.25);
    ctx.beginPath();
    ctx.ellipse(x - 3 * sc, y - 16 * sc, 2.8 * sc, 2.2 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** LODが粗いときのセル色(森は暗く、水は深さで) */
export function lodCellColor(map: GameMap, sx: number, sy: number, lvl: number, h: number): string {
  if (lvl === 0) return css(waterRGB(h));
  const c = landColor(map, sx, sy, lvl, h);
  if (lvl <= 6 && !(lvl === 1 && h <= SEA_LEVEL + 3)) {
    const f = forestAt(map, sx, sy);
    if (f > 0) return css(mixc(c, [38, 98, 50], f * 0.55));
  }
  return css(c);
}
