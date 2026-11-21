import atlasUrl from '../assets/buildings.png';
import offices2Url from '../assets/offices2.png';
import schoolUrl from '../assets/school.png';
import cityhallUrl from '../assets/cityhall.png';
import departmentUrl from '../assets/department.png';
import mallUrl from '../assets/mall.png';
import sightsUrl from '../assets/sights.png';
import hotelUrl from '../assets/hotel.png';
import parkUrl from '../assets/park.png';
import cinemaUrl from '../assets/cinema.png';
import zooUrl from '../assets/zoo.png';
import skiUrl from '../assets/ski.png';
import beachUrl from '../assets/beach.png';
import arenaUrl from '../assets/arena.png';
import conventionUrl from '../assets/convention.png';
import bizhotelUrl from '../assets/bizhotel.png';
import campusUrl from '../assets/campus.png';
import golfUrl from '../assets/golf.png';
import hospitalUrl from '../assets/hospital.png';
import stationmallUrl from '../assets/stationmall.png';
import amusementUrl from '../assets/amusement.png';
import stadiumUrl from '../assets/stadium.png';
import sheetInfo from '../../shared/data/facilitySprites.json';
import { SIZED_TYPES, type Facility, facilityDims } from '../../shared/world/facilities';
import { buildingLevel, buildingVariant, isOffice } from '../../shared/world/buildings';

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
/** 大きさごとにセルが違う施設(ホテル・公園と、あとから加わった施設)の種類 → アトラスの画像URLと、読み込んだ画像 */
const SIZED_URLS: Record<string, string> = {
  hotel: hotelUrl,
  park: parkUrl,
  cinema: cinemaUrl,
  zoo: zooUrl,
  ski: skiUrl,
  beach: beachUrl,
  arena: arenaUrl,
  convention: conventionUrl,
  bizhotel: bizhotelUrl,
  campus: campusUrl,
  golf: golfUrl,
  hospital: hospitalUrl,
  stationmall: stationmallUrl,
  amusement: amusementUrl,
  stadium: stadiumUrl,
};
const sizedAtlas: Record<string, HTMLImageElement | null> = {};

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // 失敗しても手続き描画/旧スプライトで続行
    img.src = url;
  });

export async function loadBuildingSprites(): Promise<void> {
  if (atlas) return;
  const sized = Object.keys(SIZED_URLS);
  let sizedImgs: (HTMLImageElement | null)[] = [];
  [atlas, atlas2, atlasSchool, atlasCityhall, atlasDepartment, atlasMall, atlasSights, ...sizedImgs] = await Promise.all([
    loadImage(atlasUrl),
    loadImage(offices2Url),
    loadImage(schoolUrl),
    loadImage(cityhallUrl),
    loadImage(departmentUrl),
    loadImage(mallUrl),
    loadImage(sightsUrl),
    ...sized.map((k) => loadImage(SIZED_URLS[k])),
  ]);
  sized.forEach((k, i) => (sizedAtlas[k] = sizedImgs[i]));
}

export const spritesReady = () => atlas !== null;

/**
 * 建物スプライトを描く。(px,py) は建物のアンカータイル(L は 2x2 の最前面タイル)の上頂点。
 * @returns 描いたら true
 */
/** 建物 b(個体差 hv)のスプライトの、アトラスの画像と切り出し位置。描かないタイル(付属)は null */
export function buildingSpriteRect(b: number, hv = 0): { img: HTMLImageElement; sx: number; sy: number; level: number } | null {
  if (!atlas) return null;
  const level = buildingLevel(b);
  if (level < 1) return null;
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
  return { img, sx: col * SPRITE_W, sy: row * SPRITE_H, level };
}

export function drawBuildingSprite(ctx: CanvasRenderingContext2D, px: number, py: number, b: number, hv = 0): boolean {
  if (!atlas) return false;
  const r = buildingSpriteRect(b, hv);
  if (!r) return true; // 付属タイルは何も描かない
  // 足元の中心: 1x1 はタイル中心(py+16)、2x2 は4タイルの共有点(py)
  const cy = r.level === 3 ? py : py + 16;
  const scale = ctx.getTransform().a;
  ctx.imageSmoothingEnabled = scale < 1; // 拡大時はドットを保つ
  ctx.drawImage(r.img, r.sx, r.sy, SPRITE_W, SPRITE_H, Math.round(px - CX), Math.round(cy - CY), SPRITE_W, SPRITE_H);
  ctx.imageSmoothingEnabled = true;
  return true;
}

/** 施設スプライトの、アトラス内の切り出し位置と、敷地の手前タイルの上頂点 (px,py) からの描画位置のずれ(画像なしの幾何だけ) */
export interface FacilityGeom {
  /** アトラスの種類(sizedAtlas のキー、または school/cityhall/department/mall/sight) */
  atlas: string;
  sx: number;
  sy: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
}

type Band = { w: number; h: number; y0: number; cx: number; cy: number };

/**
 * 施設のスプライトの幾何を求める。描けない(スプライトの施設でない)なら null。
 * ホテル・公園・あとから加わった施設・遊園地・スタジアム: 大きさごとにセルが違う(敷地が n×n)。敷地の中心に足元の中心を合わせる。
 * 学校・市役所・百貨店・モール・観光地: アトラスは 15列×N行(種類 i は 行=⌊i/5⌋、列=(i%5)*3+S/M/L)。S/M は1タイル、L は 2x2 タイル。
 */
export function facilityGeom(f: Pick<Facility, 'type' | 'design' | 'size' | 'w'>): FacilityGeom | null {
  const d = f.design ?? 0;
  if (SIZED_TYPES.includes(f.type) && f.design !== undefined && f.size !== undefined) {
    const band = (sheetInfo as Record<string, { sizes: Record<string, Band> }>)[f.type]?.sizes[f.size];
    if (!band) return null;
    // 敷地が n×n のとき、中心は手前タイルの上頂点から (n-2)*16 だけ上
    return { atlas: f.type, sx: (d % 5) * band.w, sy: band.y0 + Math.floor(d / 5) * band.h, w: band.w, h: band.h, dx: -band.cx, dy: -(f.w - 2) * 16 - band.cy };
  }
  if (f.type !== 'school' && f.type !== 'cityhall' && f.type !== 'department' && f.type !== 'mall' && f.type !== 'sight') return null;
  const si = f.size === 'L' ? 2 : f.size === 'M' ? 1 : 0;
  // 足元の中心: 1x1 はタイル中心(py+16)、2x2 は4タイルの共有点(py)
  return { atlas: f.type, sx: ((d % 5) * 3 + si) * SPRITE_W, sy: Math.floor(d / 5) * SPRITE_H, w: SPRITE_W, h: SPRITE_H, dx: -CX, dy: (si === 2 ? 0 : 16) - CY };
}

export interface FacilityFrame extends FacilityGeom {
  img: HTMLImageElement;
}

/** 施設のスプライトの画像つきの切り出し。画像がまだ読み込まれていない・スプライトでない場合は null */
export function facilitySpriteFrame(f: Pick<Facility, 'type' | 'design' | 'size' | 'w'>): FacilityFrame | null {
  const g = facilityGeom(f);
  if (!g) return null;
  const img = SIZED_URLS[g.atlas]
    ? sizedAtlas[g.atlas]
    : { school: atlasSchool, cityhall: atlasCityhall, department: atlasDepartment, mall: atlasMall, sight: atlasSights }[g.atlas];
  return img ? { ...g, img } : null;
}

/**
 * 施設のスプライトを描く。(px,py) は敷地の手前側(x+y が最大)のタイルの上頂点。
 * @returns 描いたら true
 */
export function drawFacilitySprite(ctx: CanvasRenderingContext2D, px: number, py: number, f: Facility): boolean {
  const r = facilitySpriteFrame(f);
  if (!r) return false;
  const scale = ctx.getTransform().a;
  ctx.imageSmoothingEnabled = scale < 1; // 拡大時はドットを保つ
  ctx.drawImage(r.img, r.sx, r.sy, r.w, r.h, Math.round(px + r.dx), Math.round(py + r.dy), r.w, r.h);
  ctx.imageSmoothingEnabled = true;
  return true;
}

/** 施設ピッカーの見本: キャンバスの中央に1棟を描く(読み込み前は何も描かない)。大きな施設は、はみ出さないよう縮めて収める */
export function drawFacilityPreview(canvas: HTMLCanvasElement, type: Facility['type'], design: number, size: 'S' | 'M' | 'L'): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (SIZED_TYPES.includes(type)) {
    const band = (sheetInfo as Record<string, { sizes: Record<string, Band> }>)[type]?.sizes[size];
    if (!band) return;
    const n = facilityDims(type, size).w;
    const k = Math.min(1, (canvas.width - 8) / band.w, (canvas.height - 12) / band.h);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    // スプライトの下端をキャンバスの下辺(余白6px)に合わせる。drawSizedSprite は手前タイルの上頂点から (n-2)*16 だけ上を足元の中心にする
    const centreY = (canvas.height - 6) / k - (band.h - band.cy);
    drawFacilitySprite(ctx, canvas.width / 2 / k, centreY + (n - 2) * 16, { type, design, size, w: n, h: n } as Facility);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }
  const n = size === 'L' ? 2 : 1;
  const f = { type, design, size, w: n, h: n } as Facility;
  // 足元の中心をキャンバスの下寄りに置く(drawFacilitySprite の (px,py) は手前タイルの上頂点)
  const centreY = canvas.height - 40;
  const py = size === 'L' ? centreY : centreY - 16;
  drawFacilitySprite(ctx, canvas.width / 2, py, f);
}
