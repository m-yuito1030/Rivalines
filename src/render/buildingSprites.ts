import atlasUrl from '../assets/buildings.png';
import offices2Url from '../assets/offices2.png';
import schoolUrl from '../assets/school.png';
import cityhallUrl from '../assets/cityhall.png';
import departmentUrl from '../assets/department.png';
import mallUrl from '../assets/mall.png';
import sightsUrl from '../assets/sights.png';
import hotelUrl from '../assets/hotel.png';
import parkUrl from '../assets/park.png';
import sheetInfo from '../data/facilitySprites.json';
import type { Facility } from '../world/facilities';
import { buildingLevel, buildingVariant, isOffice } from '../world/buildings';

/**
 * 建物スプライト(住宅・オフィス × S/M/L × 25種)のアトラス。
 * 1セル 128x192。行 = 種類(0..24)、列 = kind*3 + (level-1)(kind: 0=住宅 1=オフィス)。
 * 足元の菱形の中心がセル内 (64,150) に来る。S/M は1タイル、L は 2x2 タイルの敷地。
 *
 * オフィスはさらに追加の100種(offices2.png: 15列x20行。種類 i は 行=⌊i/5⌋、列=(i%5)*3+S/M/L)がある。
 * 旧25種+新100種の計125種から、タイルごとの個体差(hv)で選ぶ。
 */
const OFFICE_OLD = 25;
const OFFICE_NEW = 100;
export const SPRITE_W = 128;
export const SPRITE_H = 192;
const CX = 64;
const CY = 150;

let atlas: HTMLImageElement | null = null;
let atlas2: HTMLImageElement | null = null;
let atlasSchool: HTMLImageElement | null = null;
let atlasCityhall: HTMLImageElement | null = null;
let atlasDepartment: HTMLImageElement | null = null;
let atlasMall: HTMLImageElement | null = null;
let atlasSights: HTMLImageElement | null = null;
let atlasHotel: HTMLImageElement | null = null;
let atlasPark: HTMLImageElement | null = null;

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // 失敗しても手続き描画/旧スプライトで続行
    img.src = url;
  });

export async function loadBuildingSprites(): Promise<void> {
  if (atlas) return;
  [atlas, atlas2, atlasSchool, atlasCityhall, atlasDepartment, atlasMall, atlasSights, atlasHotel, atlasPark] = await Promise.all([loadImage(atlasUrl), loadImage(offices2Url), loadImage(schoolUrl), loadImage(cityhallUrl), loadImage(departmentUrl), loadImage(mallUrl), loadImage(sightsUrl), loadImage(hotelUrl), loadImage(parkUrl)]);
}

export const spritesReady = () => atlas !== null;

/**
 * 建物スプライトを描く。(px,py) は建物のアンカータイル(L は 2x2 の最前面タイル)の上頂点。
 * @returns 描いたら true
 */
export function drawBuildingSprite(ctx: CanvasRenderingContext2D, px: number, py: number, b: number, hv = 0): boolean {
  if (!atlas) return false;
  const level = buildingLevel(b);
  if (level < 1) return true; // 付属タイルは何も描かない
  let img = atlas;
  let col = (isOffice(b) ? 3 : 0) + (level - 1);
  let row = buildingVariant(b);
  if (isOffice(b) && atlas2) {
    // オフィスは旧25種+新100種から、タイルの個体差で選ぶ
    const r = Math.min(OFFICE_OLD + OFFICE_NEW - 1, Math.floor(hv * (OFFICE_OLD + OFFICE_NEW)));
    if (r >= OFFICE_OLD) {
      const i = r - OFFICE_OLD;
      img = atlas2;
      col = (i % 5) * 3 + (level - 1);
      row = Math.floor(i / 5);
    }
  }
  // 足元の中心: 1x1 はタイル中心(py+16)、2x2 は4タイルの共有点(py)
  const cy = level === 3 ? py : py + 16;
  const scale = ctx.getTransform().a;
  ctx.imageSmoothingEnabled = scale < 1; // 拡大時はドットを保つ
  ctx.drawImage(img, col * SPRITE_W, row * SPRITE_H, SPRITE_W, SPRITE_H, Math.round(px - CX), Math.round(cy - CY), SPRITE_W, SPRITE_H);
  ctx.imageSmoothingEnabled = true;
  return true;
}

/**
 * 施設(学校・市役所・百貨店・モール)のスプライトを描く。大きさ S/M は1タイル、L は 2x2 タイルの敷地。
 * (px,py) は敷地の手前側(x+y が最大)のタイルの上頂点。アトラスは 15列×N行(種類 i は 行=⌊i/5⌋、列=(i%5)*3+S/M/L)。
 * @returns 描いたら true
 */
export function drawFacilitySprite(ctx: CanvasRenderingContext2D, px: number, py: number, f: Facility): boolean {
  if (f.type === 'hotel' || f.type === 'park') return drawSizedSprite(ctx, px, py, f);
  const img = f.type === 'school' ? atlasSchool : f.type === 'cityhall' ? atlasCityhall : f.type === 'department' ? atlasDepartment : f.type === 'mall' ? atlasMall : f.type === 'sight' ? atlasSights : null;
  if (!img) return false;
  const si = f.size === 'L' ? 2 : f.size === 'M' ? 1 : 0;
  const d = f.design ?? 0;
  const col = (d % 5) * 3 + si;
  const row = Math.floor(d / 5);
  const cy = si === 2 ? py : py + 16;
  const scale = ctx.getTransform().a;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(img, col * SPRITE_W, row * SPRITE_H, SPRITE_W, SPRITE_H, Math.round(px - CX), Math.round(cy - CY), SPRITE_W, SPRITE_H);
  ctx.imageSmoothingEnabled = true;
  return true;
}

type Band = { w: number; h: number; y0: number; cx: number; cy: number };
/** ホテル・公園: 大きさごとにセルの大きさが違う(S=1x1 M=2x2 L=3x3)。敷地の中心にスプライトの足元の中心を合わせる */
function drawSizedSprite(ctx: CanvasRenderingContext2D, px: number, py: number, f: Facility): boolean {
  const img = f.type === 'hotel' ? atlasHotel : atlasPark;
  if (!img) return false;
  const band = (sheetInfo as Record<string, { sizes: Record<string, Band> }>)[f.type]?.sizes[f.size ?? 'S'];
  if (!band) return false;
  const d = f.design ?? 0;
  // 敷地が n×n のとき、中心は手前タイルの上頂点から (n-2)*16 だけ上
  const cy = py - (f.w - 2) * 16;
  const scale = ctx.getTransform().a;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(img, (d % 5) * band.w, band.y0 + Math.floor(d / 5) * band.h, band.w, band.h, Math.round(px - band.cx), Math.round(cy - band.cy), band.w, band.h);
  ctx.imageSmoothingEnabled = true;
  return true;
}

/** 施設ピッカーの見本: キャンバスの中央に1棟を描く(読み込み前は何も描かない) */
export function drawFacilityPreview(canvas: HTMLCanvasElement, type: Facility['type'], design: number, size: 'S' | 'M' | 'L'): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const n = type === 'hotel' || type === 'park' ? (size === 'L' ? 3 : size === 'M' ? 2 : 1) : size === 'L' ? 2 : 1;
  const f = { type, design, size, w: n, h: n } as Facility;
  // 足元の中心をキャンバスの下寄りに置く(drawFacilitySprite の (px,py) は手前タイルの上頂点)
  const centreY = canvas.height - 40;
  const py = type === 'hotel' || type === 'park' ? centreY + (n - 2) * 16 : size === 'L' ? centreY : centreY - 16;
  drawFacilitySprite(ctx, canvas.width / 2, py, f);
}
