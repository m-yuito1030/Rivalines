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
 * Atlas of building sprites (houses and offices x S/M/L x 25 kinds).
 * One cell is 128x192. Row = kind (0..24), column = kind*3 + (level-1) (kind: 0 = house, 1 = office).
 * The centre of the diamond at the foot sits at (64,150) in the cell. S/M occupy one tile, L a 2x2-tile site.
 *
 * Offices have a further 100 kinds (offices2.png: 15 columns x 20 rows. Kind i is at row = floor(i/5), column = (i%5)*3 + S/M/L).
 * One is chosen from the 125 kinds (25 old + 100 new) by the per-tile variation (hv).
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
/** Facility kinds whose cell differs by size (hotels, parks, and later additions) -> the atlas image URL and the loaded image */
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
    img.onerror = () => resolve(null); // on failure, carry on with procedural drawing / the old sprites
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
 * Draw a building sprite. (px,py) is the top vertex of the building's anchor tile (the frontmost tile of a 2x2 L).
 * @returns true if drawn
 */
/** The atlas image and crop position of the sprite for building b (variation hv). null for tiles that draw nothing (attached tiles) */
export function buildingSpriteRect(b: number, hv = 0): { img: HTMLImageElement; sx: number; sy: number; level: number } | null {
  if (!atlas) return null;
  const level = buildingLevel(b);
  if (level < 1) return null;
  let img = atlas;
  let col = (isOffice(b) ? 3 : 0) + (level - 1);
  let row = buildingVariant(b);
  if (isOffice(b) && atlas2) {
    // Offices are chosen from the 25 old and 100 new kinds by the tile's variation
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
  if (!r) return true; // attached tiles draw nothing
  // Centre of the foot: for 1x1 the tile centre (py+16), for 2x2 the shared point of the four tiles (py)
  const cy = r.level === 3 ? py : py + 16;
  const scale = ctx.getTransform().a;
  ctx.imageSmoothingEnabled = scale < 1; // keep the pixels crisp when enlarged
  ctx.drawImage(r.img, r.sx, r.sy, SPRITE_W, SPRITE_H, Math.round(px - CX), Math.round(cy - CY), SPRITE_W, SPRITE_H);
  ctx.imageSmoothingEnabled = true;
  return true;
}

/** A facility sprite's crop position in the atlas and its drawing offset from the top vertex (px,py) of the site's front tile (geometry only, no image) */
export interface FacilityGeom {
  /** Atlas kind (a key of sizedAtlas, or school/cityhall/department/mall/sight) */
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
 * Work out the geometry of a facility's sprite. null if it cannot be drawn (not a sprite facility).
 * Hotels, parks, later additions, amusement parks, stadiums: the cell differs by size (the site is n x n). The foot centre is aligned with the centre of the site.
 * Schools, town halls, department stores, malls, sights: the atlas has 15 columns x N rows (kind i at row = floor(i/5), column = (i%5)*3 + S/M/L). S/M are one tile, L is 2x2 tiles.
 */
export function facilityGeom(f: Pick<Facility, 'type' | 'design' | 'size' | 'w'>): FacilityGeom | null {
  const d = f.design ?? 0;
  if (SIZED_TYPES.includes(f.type) && f.design !== undefined && f.size !== undefined) {
    const band = (sheetInfo as Record<string, { sizes: Record<string, Band> }>)[f.type]?.sizes[f.size];
    if (!band) return null;
    // For an n x n site, the centre is (n-2)*16 above the top vertex of the front tile
    return { atlas: f.type, sx: (d % 5) * band.w, sy: band.y0 + Math.floor(d / 5) * band.h, w: band.w, h: band.h, dx: -band.cx, dy: -(f.w - 2) * 16 - band.cy };
  }
  if (f.type !== 'school' && f.type !== 'cityhall' && f.type !== 'department' && f.type !== 'mall' && f.type !== 'sight') return null;
  const si = f.size === 'L' ? 2 : f.size === 'M' ? 1 : 0;
  // Centre of the foot: for 1x1 the tile centre (py+16), for 2x2 the shared point of the four tiles (py)
  return { atlas: f.type, sx: ((d % 5) * 3 + si) * SPRITE_W, sy: Math.floor(d / 5) * SPRITE_H, w: SPRITE_W, h: SPRITE_H, dx: -CX, dy: (si === 2 ? 0 : 16) - CY };
}

export interface FacilityFrame extends FacilityGeom {
  img: HTMLImageElement;
}

/** A facility sprite's crop together with its image. null if the image is not loaded yet or it is not a sprite */
export function facilitySpriteFrame(f: Pick<Facility, 'type' | 'design' | 'size' | 'w'>): FacilityFrame | null {
  const g = facilityGeom(f);
  if (!g) return null;
  const img = SIZED_URLS[g.atlas]
    ? sizedAtlas[g.atlas]
    : { school: atlasSchool, cityhall: atlasCityhall, department: atlasDepartment, mall: atlasMall, sight: atlasSights }[g.atlas];
  return img ? { ...g, img } : null;
}

/**
 * Draw a facility's sprite. (px,py) is the top vertex of the site's front tile (largest x+y).
 * @returns true if drawn
 */
export function drawFacilitySprite(ctx: CanvasRenderingContext2D, px: number, py: number, f: Facility): boolean {
  const r = facilitySpriteFrame(f);
  if (!r) return false;
  const scale = ctx.getTransform().a;
  ctx.imageSmoothingEnabled = scale < 1; // keep the pixels crisp when enlarged
  ctx.drawImage(r.img, r.sx, r.sy, r.w, r.h, Math.round(px + r.dx), Math.round(py + r.dy), r.w, r.h);
  ctx.imageSmoothingEnabled = true;
  return true;
}

/** The facility picker's preview: draw one building in the middle of the canvas (nothing before loading). Large facilities are shrunk to fit without overflowing */
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
    // Align the bottom of the sprite with the bottom edge of the canvas (6 px margin). drawSizedSprite puts the foot centre (n-2)*16 above the front tile's top vertex
    const centreY = (canvas.height - 6) / k - (band.h - band.cy);
    drawFacilitySprite(ctx, canvas.width / 2 / k, centreY + (n - 2) * 16, { type, design, size, w: n, h: n } as Facility);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }
  const n = size === 'L' ? 2 : 1;
  const f = { type, design, size, w: n, h: n } as Facility;
  // Put the foot centre toward the bottom of the canvas ((px,py) of drawFacilitySprite is the top vertex of the front tile)
  const centreY = canvas.height - 40;
  const py = size === 'L' ? centreY : centreY - 16;
  drawFacilitySprite(ctx, canvas.width / 2, py, f);
}
