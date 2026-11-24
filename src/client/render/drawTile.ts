import { TILE_H, TILE_W } from '../../shared/world/constants';
import { drawBuildingSprite } from './buildingSprites';

const HW = TILE_W / 2;
const HH = TILE_H / 2;

/** タイル内座標(u:+x方向, v:+y方向, 0..1) → キャンバス座標。(px,py)はタイル上面の頂点 */
export const sx = (px: number, u: number, v: number) => px + (u - v) * HW;
export const sy = (py: number, u: number, v: number) => py + (u + v) * HH;

function poly(ctx: CanvasRenderingContext2D, px: number, py: number, pts: number[][], lift = 0): void {
  ctx.beginPath();
  pts.forEach(([u, v], i) => {
    const x = sx(px, u, v);
    const y = sy(py, u, v) - lift;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

/** 壁面(2D面)上の四角形: face='L' は v=c 面(u方向に a0..a1)、face='R' は u=c 面(v方向に a0..a1)。z0..z1 は高さ(px) */
function wallQuad(ctx: CanvasRenderingContext2D, px: number, py: number, face: 'L' | 'R', c: number, a0: number, a1: number, z0: number, z1: number): void {
  const p = (a: number, z: number): [number, number] => (face === 'L' ? [sx(px, a, c), sy(py, a, c) - z] : [sx(px, c, a), sy(py, c, a) - z]);
  const [x0, y0] = p(a0, z0);
  const [x1, y1] = p(a1, z0);
  const [x2, y2] = p(a1, z1);
  const [x3, y3] = p(a0, z1);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fill();
}

/** 方向ごとの単位ベクトル(u,v) N,E,S,W */
const E = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

// ---------------------------------------------------------------- 道路
const WALK = '#aaa8a1';
const CURB = '#8a8882';
const ASPHALT = '#484b52';
const ASPHALT2 = '#51545b';
const LINE = '#e9e2c0';

/** 腕(中心→辺)の長方形。half=半幅, from..to=中心からの距離 */
function arm(ctx: CanvasRenderingContext2D, px: number, py: number, d: number, half: number, from: number, to: number): void {
  const [ex, ey] = E[d];
  const [nx, ny] = [-ey, ex];
  const c = 0.5;
  poly(ctx, px, py, [
    [c + ex * from + nx * half, c + ey * from + ny * half],
    [c + ex * to + nx * half, c + ey * to + ny * half],
    [c + ex * to - nx * half, c + ey * to - ny * half],
    [c + ex * from - nx * half, c + ey * from - ny * half],
  ]);
}

/** 道路タイル。road=GameMap.road のビット値, hv=個体差(0..1)。歩道・縁石・センターライン・横断歩道・矢印・街灯つき */
export function drawRoad(ctx: CanvasRenderingContext2D, px: number, py: number, road: number, hv = 0, detail = true): void {
  const c = 0.5;
  const arms = [0, 1, 2, 3].filter((d) => road & (1 << d));
  const WS = 0.27; // 歩道を含む半幅
  const WA = 0.2; // 車道の半幅
  // 歩道(縁石色の外縁 → 歩道面)
  ctx.fillStyle = CURB;
  poly(ctx, px, py, [
    [c - WS - 0.015, c - WS - 0.015],
    [c + WS + 0.015, c - WS - 0.015],
    [c + WS + 0.015, c + WS + 0.015],
    [c - WS - 0.015, c + WS + 0.015],
  ]);
  for (const d of arms) arm(ctx, px, py, d, WS + 0.015, 0, 0.5);
  ctx.fillStyle = WALK;
  poly(ctx, px, py, [
    [c - WS, c - WS],
    [c + WS, c - WS],
    [c + WS, c + WS],
    [c - WS, c + WS],
  ]);
  for (const d of arms) arm(ctx, px, py, d, WS, 0, 0.5);
  // 車道
  ctx.fillStyle = ASPHALT;
  poly(ctx, px, py, [
    [c - WA, c - WA],
    [c + WA, c - WA],
    [c + WA, c + WA],
    [c - WA, c + WA],
  ]);
  for (const d of arms) arm(ctx, px, py, d, WA, 0, 0.5);
  if (!detail) return;
  // 路面のわずかな明暗
  ctx.fillStyle = ASPHALT2;
  for (const d of arms) arm(ctx, px, py, d, WA * 0.55, 0.05, 0.45);

  // センターライン(双方向の腕のみ)/ 一方通行の矢印
  for (const d of arms) {
    const twoWay = (road & (16 << d)) !== 0;
    const [ex, ey] = E[d];
    const [nx, ny] = [-ey, ex];
    if (twoWay && arms.length <= 2) {
      ctx.fillStyle = LINE;
      for (const [a, b] of [
        [0.08, 0.2],
        [0.3, 0.42],
      ])
        arm(ctx, px, py, d, 0.012, a, b);
    } else if (!twoWay) {
      // 流入側: 進行方向(=-腕方向)を示す白い矢印
      const ax = c + ex * 0.2;
      const ay = c + ey * 0.2;
      ctx.fillStyle = '#f2f2f2';
      poly(ctx, px, py, [
        [ax - ex * 0.1, ay - ey * 0.1],
        [ax + ex * 0.06 + nx * 0.1, ay + ey * 0.06 + ny * 0.1],
        [ax + ex * 0.02, ay + ey * 0.02],
        [ax + ex * 0.06 - nx * 0.1, ay + ey * 0.06 - ny * 0.1],
      ]);
    }
  }
  // 交差点の横断歩道(3方向以上)
  if (arms.length >= 3) {
    ctx.fillStyle = 'rgba(245,245,240,0.9)';
    for (const d of arms) {
      for (let k = -2; k <= 2; k++) {
        const [ex, ey] = E[d];
        const [nx, ny] = [-ey, ex];
        const o = k * 0.07;
        const u0 = c + nx * o + ex * 0.27;
        const v0 = c + ny * o + ey * 0.27;
        const u1 = c + nx * o + ex * 0.36;
        const v1 = c + ny * o + ey * 0.36;
        poly(ctx, px, py, [
          [u0 + nx * 0.014, v0 + ny * 0.014],
          [u1 + nx * 0.014, v1 + ny * 0.014],
          [u1 - nx * 0.014, v1 - ny * 0.014],
          [u0 - nx * 0.014, v0 - ny * 0.014],
        ]);
      }
    }
  }
  // 街灯(直線区間でときどき)
  if (arms.length === 2 && arms[0] + 2 === arms[1] && hv < 0.16) {
    const d = arms[0];
    const [nx, ny] = [-E[d][1], E[d][0]];
    const lu = c + nx * 0.34;
    const lv = c + ny * 0.34;
    const x = sx(px, lu, lv);
    const y = sy(py, lu, lv);
    ctx.fillStyle = '#3a3d44';
    ctx.fillRect(x - 0.8, y - 15, 1.6, 15);
    ctx.fillStyle = '#ffe9a6';
    ctx.beginPath();
    ctx.arc(x, y - 16, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- 線路
const BALLAST = '#8c8478';
const BALLAST_DARK = '#6e675d';

/** 8方向の単位ベクトルと、中心から辺(斜めは角)までの長さ */
const E8: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];
// 斜めの腕は角の先まで少し長く描く(つなぎ先のタイルの上に重ねる)。角で細くなる先端が点でしか接せず、ネックレス状に途切れて見えるのを防ぐ
const DIAG_LEN = Math.SQRT1_2 + 0.24;
const ARM_LEN = [0.5, 0.5, 0.5, 0.5, DIAG_LEN, DIAG_LEN, DIAG_LEN, DIAG_LEN];

/** 線路タイル。conn は rail ビット(下位4bit=N,E,S,W / 上位4bit=NE,SE,SW,NW の斜め)。バラスト・枕木・レール(ハイライトつき) */
export function drawRail(ctx: CanvasRenderingContext2D, px: number, py: number, conn: number): void {
  const c = 0.5;
  const arms = [0, 1, 2, 3, 4, 5, 6, 7].filter((d) => conn & (1 << d));
  const w = 0.19;
  const armRect = (d: number, half: number) => {
    const [ex, ey] = E8[d];
    const [nx, ny] = [-ey, ex];
    const to = ARM_LEN[d];
    poly(ctx, px, py, [
      [c + nx * half, c + ny * half],
      [c + ex * to + nx * half, c + ey * to + ny * half],
      [c + ex * to - nx * half, c + ey * to - ny * half],
      [c - nx * half, c - ny * half],
    ]);
  };
  // 中心の四角は、斜めの腕だけのタイルでは描かない(帯の両脇に角が飛び出して、つなぎ目に出っ張りができるため)
  const square = arms.length === 0 || arms.some((d) => d < 4);
  ctx.fillStyle = BALLAST_DARK;
  if (square)
    poly(ctx, px, py, [
      [c - w - 0.02, c - w - 0.02],
      [c + w + 0.02, c - w - 0.02],
      [c + w + 0.02, c + w + 0.02],
      [c - w - 0.02, c + w + 0.02],
    ]);
  for (const d of arms) armRect(d, w + 0.02);
  ctx.fillStyle = BALLAST;
  if (square)
    poly(ctx, px, py, [
      [c - w, c - w],
      [c + w, c - w],
      [c + w, c + w],
      [c - w, c + w],
    ]);
  for (const d of arms) armRect(d, w);
  for (const d of arms) {
    const [ex, ey] = E8[d];
    const [nx, ny] = [-ey, ex];
    const L = ARM_LEN[d];
    const k = L / 0.5;
    // 枕木
    ctx.fillStyle = '#5b4535';
    for (const t of [0.06, 0.16, 0.26, 0.36, 0.46]) {
      const cu = c + ex * t * k;
      const cv = c + ey * t * k;
      poly(ctx, px, py, [
        [cu + nx * 0.17 - ex * 0.018, cv + ny * 0.17 - ey * 0.018],
        [cu + nx * 0.17 + ex * 0.018, cv + ny * 0.17 + ey * 0.018],
        [cu - nx * 0.17 + ex * 0.018, cv - ny * 0.17 + ey * 0.018],
        [cu - nx * 0.17 - ex * 0.018, cv - ny * 0.17 - ey * 0.018],
      ]);
    }
    // レール(暗い台座 + 明るい頭)
    for (const side of [-0.075, 0.075]) {
      ctx.fillStyle = '#3a3836';
      poly(ctx, px, py, [
        [c + nx * (side - 0.016), c + ny * (side - 0.016)],
        [c + nx * (side - 0.016) + ex * L, c + ny * (side - 0.016) + ey * L],
        [c + nx * (side + 0.016) + ex * L, c + ny * (side + 0.016) + ey * L],
        [c + nx * (side + 0.016), c + ny * (side + 0.016)],
      ]);
      ctx.fillStyle = '#c4c6c8';
      poly(ctx, px, py, [
        [c + nx * (side - 0.007), c + ny * (side - 0.007)],
        [c + nx * (side - 0.007) + ex * L, c + ny * (side - 0.007) + ey * L],
        [c + nx * (side + 0.007) + ex * L, c + ny * (side + 0.007) + ey * L],
        [c + nx * (side + 0.007), c + ny * (side + 0.007)],
      ]);
    }
  }
}

// ---------------------------------------------------------------- 空港
/** 空港タイル(1=エプロン 2=滑走路 3=ターミナル) */
export function drawAirTile(ctx: CanvasRenderingContext2D, px: number, py: number, kind: number): void {
  ctx.fillStyle = kind === 2 ? '#43464c' : '#80848b';
  poly(ctx, px, py, [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]);
  if (kind === 2) {
    // 縁線・中心線・進入端のしま
    ctx.fillStyle = '#f2f2f2';
    poly(ctx, px, py, [
      [0, 0.04],
      [1, 0.04],
      [1, 0.07],
      [0, 0.07],
    ]);
    poly(ctx, px, py, [
      [0, 0.93],
      [1, 0.93],
      [1, 0.96],
      [0, 0.96],
    ]);
    for (const u of [0.06, 0.38, 0.7])
      poly(ctx, px, py, [
        [u, 0.47],
        [u + 0.2, 0.47],
        [u + 0.2, 0.53],
        [u, 0.53],
      ]);
  } else {
    // エプロンの目地
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx(px, 0.5, 0), sy(py, 0.5, 0));
    ctx.lineTo(sx(px, 0.5, 1), sy(py, 0.5, 1));
    ctx.moveTo(sx(px, 0, 0.5), sy(py, 0, 0.5));
    ctx.lineTo(sx(px, 1, 0.5), sy(py, 1, 0.5));
    ctx.stroke();
  }
  if (kind === 3) {
    const a = 0.1;
    const z = 0.9;
    const h = 26;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    poly(ctx, px, py, [
      [a + 0.1, a + 0.1],
      [z + 0.12, a + 0.1],
      [z + 0.12, z + 0.12],
      [a + 0.1, z + 0.12],
    ]);
    ctx.fillStyle = '#dfe3ea';
    wallQuad(ctx, px, py, 'L', z, a, z, 0, h);
    ctx.fillStyle = '#b9c0cc';
    wallQuad(ctx, px, py, 'R', z, a, z, 0, h);
    // ガラス帯
    ctx.fillStyle = '#5a86b8';
    wallQuad(ctx, px, py, 'L', z, a + 0.05, z - 0.05, 8, 19);
    ctx.fillStyle = '#4a74a4';
    wallQuad(ctx, px, py, 'R', z, a + 0.05, z - 0.05, 8, 19);
    ctx.fillStyle = '#2f7dd1';
    poly(
      ctx,
      px,
      py,
      [
        [a - 0.02, a - 0.02],
        [z + 0.02, a - 0.02],
        [z + 0.02, z + 0.02],
        [a - 0.02, z + 0.02],
      ],
      h,
    );
    ctx.fillStyle = '#e8ecf2';
    poly(
      ctx,
      px,
      py,
      [
        [0.4, 0.4],
        [0.6, 0.4],
        [0.6, 0.6],
        [0.4, 0.6],
      ],
      h + 5,
    ); // 管制塔の基部
    ctx.fillStyle = '#8fc4ff';
    poly(
      ctx,
      px,
      py,
      [
        [0.42, 0.42],
        [0.58, 0.42],
        [0.58, 0.58],
        [0.42, 0.58],
      ],
      h + 9,
    );
  }
}

// ---------------------------------------------------------------- 建物
/** 壁色(明) */
const WALLS = ['#efe6d2', '#f3ecd9', '#dfe8ef', '#f1dcc8', '#e8e3dc', '#e4eadb', '#f0e0e0', '#ebe9e2'];
const ROOFS = ['#b8503a', '#3f6ea8', '#7a5a8c', '#5c8a4a', '#9a7040', '#6e7076', '#a84a68', '#3f8a86'];
const GLASS = ['#6e9ac4', '#7aa6cc', '#5f8fbb', '#86b0cf'];

const shadeHex = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * k) | 0;
  const b = Math.min(255, (n & 255) * k) | 0;
  return `rgb(${r},${g},${b})`;
};

function shadow(ctx: CanvasRenderingContext2D, px: number, py: number, a: number, z: number, h: number): void {
  const s = 0.1 + h / 160;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  poly(ctx, px, py, [
    [a + 0.04, a + 0.04],
    [z + s, a + 0.04 + s * 0.4],
    [z + s, z + s],
    [a + 0.04 + s * 0.4, z + s],
  ]);
}

/** 窓の格子を壁面に描く */
function windows(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  face: 'L' | 'R',
  c: number,
  a0: number,
  a1: number,
  z0: number,
  z1: number,
  cols: number,
  rows: number,
  hv: number,
  lit: boolean,
): void {
  const cw = (a1 - a0) / cols;
  const rh = (z1 - z0) / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const on = lit && (Math.floor(hv * 1000) + r * 7 + k * 3) % 5 === 0;
      ctx.fillStyle = on ? '#ffe9a0' : face === 'L' ? '#4e6f93' : '#3f5f82';
      wallQuad(ctx, px, py, face, c, a0 + k * cw + cw * 0.2, a0 + (k + 1) * cw - cw * 0.2, z0 + r * rh + rh * 0.22, z0 + (r + 1) * rh - rh * 0.22);
    }
  }
}

/**
 * 建設中の建物(工事現場): 土の基礎・足場・シート・仮囲い。動く部分(砂ぼこり・火花)は constructionFx が毎フレーム重ねる。
 * level は完成後の段階(高いほど足場が高い)。hv=個体差
 */
export function drawConstruction(ctx: CanvasRenderingContext2D, px: number, py: number, level: number, hv = 0): void {
  const h = level === 1 ? 14 : level === 2 ? 26 : 40;
  // 土の基礎
  ctx.fillStyle = '#8a7358';
  poly(ctx, px, py, [
    [0.06, 0.06],
    [0.94, 0.06],
    [0.94, 0.94],
    [0.06, 0.94],
  ]);
  ctx.fillStyle = '#a58b6a';
  poly(ctx, px, py, [
    [0.14, 0.14],
    [0.86, 0.14],
    [0.86, 0.86],
    [0.14, 0.86],
  ]);
  // 建物の骨組み(コンクリートの箱を、途中の高さまで)
  const done = h * (0.35 + 0.3 * hv);
  ctx.fillStyle = '#9aa0a6';
  wallQuad(ctx, px, py, 'L', 0.8, 0.2, 0.8, 0, done);
  ctx.fillStyle = '#7b8186';
  wallQuad(ctx, px, py, 'R', 0.8, 0.2, 0.8, 0, done);
  ctx.fillStyle = '#b7bcc1';
  poly(
    ctx,
    px,
    py,
    [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ],
    done,
  );
  // 足場(柱と横木)と、青いシート
  ctx.fillStyle = 'rgba(70,130,200,0.55)';
  wallQuad(ctx, px, py, 'L', 0.9, 0.1, 0.9, 2, h * 0.8);
  ctx.fillStyle = 'rgba(50,100,170,0.55)';
  wallQuad(ctx, px, py, 'R', 0.9, 0.1, 0.9, 2, h * 0.8);
  ctx.strokeStyle = '#d9a21b';
  ctx.lineWidth = 1.5;
  for (const [u, v] of [
    [0.1, 0.9],
    [0.5, 0.9],
    [0.9, 0.9],
    [0.9, 0.5],
    [0.9, 0.1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(sx(px, u, v), sy(py, u, v));
    ctx.lineTo(sx(px, u, v), sy(py, u, v) - h);
    ctx.stroke();
  }
  for (let z = 6; z <= h; z += 10) {
    ctx.beginPath();
    ctx.moveTo(sx(px, 0.1, 0.9), sy(py, 0.1, 0.9) - z);
    ctx.lineTo(sx(px, 0.9, 0.9), sy(py, 0.9, 0.9) - z);
    ctx.lineTo(sx(px, 0.9, 0.1), sy(py, 0.9, 0.1) - z);
    ctx.stroke();
  }
  // 仮囲いの黄黒のコーン代わりの印
  ctx.fillStyle = '#ffb300';
  poly(
    ctx,
    px,
    py,
    [
      [0.02, 0.98],
      [0.12, 0.98],
      [0.12, 0.88],
      [0.02, 0.88],
    ],
    3,
  );
  ctx.fillStyle = '#222';
  poly(
    ctx,
    px,
    py,
    [
      [0.05, 0.95],
      [0.09, 0.95],
      [0.09, 0.91],
      [0.05, 0.91],
    ],
    6,
  );
}

/** 建物。b = level | variant<<2(level 1=戸建て 2=集合住宅 3=ビル)。hv=個体差(0..1) */
export function drawBuilding(ctx: CanvasRenderingContext2D, px: number, py: number, b: number, hv = 0, detail = true): void {
  if (drawBuildingSprite(ctx, px, py, b, hv)) return;
  const level = b & 3;
  if (level === 0) return;
  const variant = (b >> 2) & 7;
  const wall = WALLS[variant];
  const roof = ROOFS[(variant + Math.floor(hv * 4)) & 7];
  if (level === 1) {
    // 戸建て: 切妻屋根(向きは個体差)
    const a = 0.2;
    const z = 0.8;
    const h = 13;
    const rh = 9;
    const m = 0.5;
    shadow(ctx, px, py, a, z, h + rh);
    ctx.fillStyle = shadeHex(wall, 0.96);
    wallQuad(ctx, px, py, 'L', z, a, z, 0, h);
    ctx.fillStyle = shadeHex(wall, 0.78);
    wallQuad(ctx, px, py, 'R', z, a, z, 0, h);
    if (detail) {
      ctx.fillStyle = '#5a7da0';
      wallQuad(ctx, px, py, 'L', z, 0.3, 0.42, 5, 10);
      wallQuad(ctx, px, py, 'L', z, 0.58, 0.7, 5, 10);
      ctx.fillStyle = '#6b4a30';
      wallQuad(ctx, px, py, 'R', z, 0.4, 0.52, 0, 8);
    }
    const alongU = hv < 0.5;
    ctx.beginPath();
    if (alongU) {
      // 棟が u 方向: 手前(+v)の屋根面と +u 側の妻面
      ctx.fillStyle = shadeHex(wall, 0.78);
      ctx.moveTo(sx(px, z, a), sy(py, z, a) - h);
      ctx.lineTo(sx(px, z, z), sy(py, z, z) - h);
      ctx.lineTo(sx(px, z, m), sy(py, z, m) - h - rh);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(sx(px, a - 0.04, z + 0.04), sy(py, a - 0.04, z + 0.04) - h);
      ctx.lineTo(sx(px, z + 0.04, z + 0.04), sy(py, z + 0.04, z + 0.04) - h);
      ctx.lineTo(sx(px, z + 0.04, m), sy(py, z + 0.04, m) - h - rh);
      ctx.lineTo(sx(px, a - 0.04, m), sy(py, a - 0.04, m) - h - rh);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = shadeHex(roof, 0.7);
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = shadeHex(wall, 0.96);
      ctx.moveTo(sx(px, a, z), sy(py, a, z) - h);
      ctx.lineTo(sx(px, z, z), sy(py, z, z) - h);
      ctx.lineTo(sx(px, m, z), sy(py, m, z) - h - rh);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shadeHex(roof, 0.82);
      ctx.beginPath();
      ctx.moveTo(sx(px, z + 0.04, a - 0.04), sy(py, z + 0.04, a - 0.04) - h);
      ctx.lineTo(sx(px, z + 0.04, z + 0.04), sy(py, z + 0.04, z + 0.04) - h);
      ctx.lineTo(sx(px, m, z + 0.04), sy(py, m, z + 0.04) - h - rh);
      ctx.lineTo(sx(px, m, a - 0.04), sy(py, m, a - 0.04) - h - rh);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = shadeHex(roof, 0.6);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (detail && hv > 0.6) {
      ctx.fillStyle = '#7a4a3a'; // 煙突
      ctx.fillRect(sx(px, 0.62, 0.42) - 1.5, sy(py, 0.62, 0.42) - h - rh - 4, 3, 7);
    }
    return;
  }
  if (level === 2) {
    // 集合住宅: 中層・窓の格子・屋上設備
    const a = 0.16;
    const z = 0.84;
    const h = 30 + (variant & 1) * 4;
    shadow(ctx, px, py, a, z, h);
    ctx.fillStyle = shadeHex(wall, 0.98);
    wallQuad(ctx, px, py, 'L', z, a, z, 0, h);
    ctx.fillStyle = shadeHex(wall, 0.76);
    wallQuad(ctx, px, py, 'R', z, a, z, 0, h);
    if (detail) {
      windows(ctx, px, py, 'L', z, a + 0.04, z - 0.04, 5, h - 4, 3, 3, hv, false);
      windows(ctx, px, py, 'R', z, a + 0.04, z - 0.04, 5, h - 4, 3, 3, hv * 1.7, false);
      ctx.fillStyle = shadeHex(wall, 0.6); // 床の帯
      wallQuad(ctx, px, py, 'L', z, a, z, 0, 3);
      wallQuad(ctx, px, py, 'R', z, a, z, 0, 3);
    }
    ctx.fillStyle = shadeHex(roof, 0.9);
    poly(
      ctx,
      px,
      py,
      [
        [a - 0.02, a - 0.02],
        [z + 0.02, a - 0.02],
        [z + 0.02, z + 0.02],
        [a - 0.02, z + 0.02],
      ],
      h,
    );
    ctx.fillStyle = shadeHex(roof, 1.15);
    poly(
      ctx,
      px,
      py,
      [
        [a + 0.04, a + 0.04],
        [z - 0.04, a + 0.04],
        [z - 0.04, z - 0.04],
        [a + 0.04, z - 0.04],
      ],
      h,
    );
    if (detail) {
      ctx.fillStyle = '#9aa0a8';
      poly(
        ctx,
        px,
        py,
        [
          [0.3, 0.3],
          [0.5, 0.3],
          [0.5, 0.45],
          [0.3, 0.45],
        ],
        h + 4,
      );
      ctx.fillStyle = '#c7ccd2';
      poly(
        ctx,
        px,
        py,
        [
          [0.3, 0.3],
          [0.5, 0.3],
          [0.5, 0.45],
          [0.3, 0.45],
        ],
        h + 4,
      );
    }
    return;
  }
  // ビル: ガラスのカーテンウォール・セットバック・アンテナ
  const a = 0.2;
  const z = 0.8;
  const h = 46 + (variant & 3) * 6;
  const glass = GLASS[variant & 3];
  shadow(ctx, px, py, a, z, h);
  ctx.fillStyle = shadeHex(glass, 1.0);
  wallQuad(ctx, px, py, 'L', z, a, z, 0, h);
  ctx.fillStyle = shadeHex(glass, 0.74);
  wallQuad(ctx, px, py, 'R', z, a, z, 0, h);
  if (detail) {
    // 水平の窓帯と柱
    for (let zz = 4; zz < h - 2; zz += 6) {
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      wallQuad(ctx, px, py, 'L', z, a, z, zz, zz + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      wallQuad(ctx, px, py, 'R', z, a, z, zz, zz + 2);
    }
    ctx.fillStyle = 'rgba(10,30,60,0.28)';
    for (const u of [0.35, 0.5, 0.65]) wallQuad(ctx, px, py, 'L', z, u - 0.006, u + 0.006, 0, h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    wallQuad(ctx, px, py, 'L', z, a, a + 0.05, 0, h); // 角のハイライト
  }
  ctx.fillStyle = '#c9ced6';
  poly(
    ctx,
    px,
    py,
    [
      [a - 0.02, a - 0.02],
      [z + 0.02, a - 0.02],
      [z + 0.02, z + 0.02],
      [a - 0.02, z + 0.02],
    ],
    h,
  );
  // セットバックした上層
  const t1 = 0.32;
  const t2 = 0.68;
  const hh2 = 9;
  ctx.fillStyle = shadeHex(glass, 0.96);
  wallQuad(ctx, px, py, 'L', t2, t1, t2, h, h + hh2);
  ctx.fillStyle = shadeHex(glass, 0.72);
  wallQuad(ctx, px, py, 'R', t2, t1, t2, h, h + hh2);
  ctx.fillStyle = '#d8dce2';
  poly(
    ctx,
    px,
    py,
    [
      [t1, t1],
      [t2, t1],
      [t2, t2],
      [t1, t2],
    ],
    h + hh2,
  );
  if (detail) {
    ctx.strokeStyle = '#7a8088';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx(px, 0.5, 0.5), sy(py, 0.5, 0.5) - h - hh2);
    ctx.lineTo(sx(px, 0.5, 0.5), sy(py, 0.5, 0.5) - h - hh2 - 12);
    ctx.stroke();
    ctx.fillStyle = '#ff4a4a';
    ctx.fillRect(sx(px, 0.5, 0.5) - 1, sy(py, 0.5, 0.5) - h - hh2 - 13, 2, 2);
  }
}

// ---------------------------------------------------------------- 高低差・橋・トンネル
const LIFT_PX = 8; // 1段の高さ(constants.LEVEL_PX と同値)

function liftedQuad(ctx: CanvasRenderingContext2D, px: number, py: number, pts: [number, number, number][]): void {
  ctx.beginPath();
  pts.forEach(([u, v, lift], i) => {
    const x = sx(px, u, v);
    const y = sy(py, u, v) - lift;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

/**
 * スロープ: 1段高い隣(方向 d)へ向かう路面を、中心(高さ0)→辺(1段=8px)で持ち上げて描く。
 * 低い側のタイルに重ねる。kind='road' はアスファルト、'rail' はバラスト+レール。
 */
export function drawRamp(ctx: CanvasRenderingContext2D, px: number, py: number, d: number, kind: 'road' | 'rail'): void {
  const c = 0.5;
  const [ex, ey] = E[d];
  const [nx, ny] = [-ey, ex];
  const halfs = kind === 'road' ? [0.27, 0.2] : [0.19];
  const fills = kind === 'road' ? [WALK, ASPHALT] : [BALLAST];
  halfs.forEach((half, i) => {
    ctx.fillStyle = fills[i];
    liftedQuad(ctx, px, py, [
      [c + nx * half, c + ny * half, 0],
      [c + ex * 0.5 + nx * half, c + ey * 0.5 + ny * half, LIFT_PX],
      [c + ex * 0.5 - nx * half, c + ey * 0.5 - ny * half, LIFT_PX],
      [c - nx * half, c - ny * half, 0],
    ]);
  });
  if (kind === 'rail') {
    ctx.fillStyle = '#c4c6c8';
    for (const side of [-0.075, 0.075]) {
      liftedQuad(ctx, px, py, [
        [c + nx * (side - 0.012), c + ny * (side - 0.012), 0],
        [c + ex * 0.5 + nx * (side - 0.012), c + ey * 0.5 + ny * (side - 0.012), LIFT_PX],
        [c + ex * 0.5 + nx * (side + 0.012), c + ey * 0.5 + ny * (side + 0.012), LIFT_PX],
        [c + nx * (side + 0.012), c + ny * (side + 0.012), 0],
      ]);
    }
  } else {
    ctx.fillStyle = LINE;
    liftedQuad(ctx, px, py, [
      [c + nx * 0.008, c + ny * 0.008, 0],
      [c + ex * 0.5 + nx * 0.008, c + ey * 0.5 + ny * 0.008, LIFT_PX],
      [c + ex * 0.5 - nx * 0.008, c + ey * 0.5 - ny * 0.008, LIFT_PX],
      [c - nx * 0.008, c - ny * 0.008, 0],
    ]);
  }
}

/**
 * 橋の中間タイル。px,py は地面(段)基準の頂点、lift は地面から路面までの高さ(px)。
 * 橋脚 → 桁(厚み) → 路面(道路/線路) → 欄干 の順に描く。
 */
export function drawBridgeTile(ctx: CanvasRenderingContext2D, px: number, py: number, lift: number, road: number, rail: number, hv: number): void {
  const bits = road ? road : rail;
  const alongX = !!(bits & 10); // E/W
  const half = 0.3;
  // 橋脚(タイル中心の柱)
  const cxp = sx(px, 0.5, 0.5);
  const cyp = sy(py, 0.5, 0.5);
  ctx.fillStyle = '#8d8a84';
  ctx.fillRect(cxp - 3, cyp - lift, 6, lift + 2);
  ctx.fillStyle = '#6f6c67';
  ctx.fillRect(cxp + 1, cyp - lift, 2, lift + 2);
  // 桁の厚み
  const gird = alongX
    ? [
        [0, 0.5 - half],
        [1, 0.5 - half],
        [1, 0.5 + half],
        [0, 0.5 + half],
      ]
    : [
        [0.5 - half, 0],
        [0.5 + half, 0],
        [0.5 + half, 1],
        [0.5 - half, 1],
      ];
  ctx.fillStyle = '#74716b';
  for (let k = 5; k >= 1; k--) {
    ctx.beginPath();
    gird.forEach(([u, v], i) => {
      const x = sx(px, u, v);
      const y = sy(py, u, v) - lift + k;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
  if (road) drawRoad(ctx, px, py - lift, road, hv, false);
  else drawRail(ctx, px, py - lift, rail);
  // 欄干(両側の細い線)
  ctx.fillStyle = '#b9b6ae';
  for (const sd of [-0.29, 0.29]) {
    const a: [number, number] = alongX ? [0, 0.5 + sd] : [0.5 + sd, 0];
    const b: [number, number] = alongX ? [1, 0.5 + sd] : [0.5 + sd, 1];
    ctx.beginPath();
    ctx.moveTo(sx(px, a[0], a[1]), sy(py, a[0], a[1]) - lift);
    ctx.lineTo(sx(px, b[0], b[1]), sy(py, b[0], b[1]) - lift);
    ctx.lineTo(sx(px, b[0], b[1]), sy(py, b[0], b[1]) - lift - 3);
    ctx.lineTo(sx(px, a[0], a[1]), sy(py, a[0], a[1]) - lift - 3);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * トンネル口: 見える側(E/S)の崖の壁面の根元に、暗い口とレンガ色の縁を描く。
 * drop = この(高い)タイルの上面から、外側の路面までの高さ(px)
 */
export function drawTunnelPortal(ctx: CanvasRenderingContext2D, px: number, py: number, d: number, drop: number): void {
  if (d !== 1 && d !== 2) return; // 北・西側の壁は画面に描かれない
  const [ex, ey] = E[d];
  const [nx, ny] = [-ey, ex];
  const c = 0.5;
  const edgeC = [c + ex * 0.495, c + ey * 0.495];
  ctx.fillStyle = '#6b5b4e';
  liftedQuad(ctx, px, py, [
    [edgeC[0] + nx * 0.27, edgeC[1] + ny * 0.27, -drop],
    [edgeC[0] + nx * 0.27, edgeC[1] + ny * 0.27, -drop + 11],
    [edgeC[0] - nx * 0.27, edgeC[1] - ny * 0.27, -drop + 11],
    [edgeC[0] - nx * 0.27, edgeC[1] - ny * 0.27, -drop],
  ]);
  ctx.fillStyle = '#17150f';
  liftedQuad(ctx, px, py, [
    [edgeC[0] + nx * 0.2, edgeC[1] + ny * 0.2, -drop],
    [edgeC[0] + nx * 0.2, edgeC[1] + ny * 0.2, -drop + 8],
    [edgeC[0] - nx * 0.2, edgeC[1] - ny * 0.2, -drop + 8],
    [edgeC[0] - nx * 0.2, edgeC[1] - ny * 0.2, -drop],
  ]);
}
