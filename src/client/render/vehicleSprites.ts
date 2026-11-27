import { Rectangle, Texture } from 'pixi.js';
import busUrl from '../assets/bus.png';
import aircraftUrl from '../assets/aircraft.png';
import trainUrl from '../assets/train.png';
import trainDesigns from '../../shared/data/trainDesigns.json';

/** Magnification of vehicle sprites (made small to match the game's tiles. Adjust here if they look too big or too small) */
export const BUS_SCALE = 0.55;
export const AIR_SCALE = 0.6;

/**
 * 8-direction sprites of buses (250 kinds) and aircraft (100 kinds). Direction k starts at 0 = +u (lower right on screen) and goes in 45-degree steps (same as dirIndex in transitLayer).
 * Atlas: one design = a strip of 8 directions side by side. Buses have 5 designs per row (cell 72x64), aircraft 3 designs per row (cell 112x104).
 * The origin (the vehicle's ground position) is at (ox,oy) in the cell.
 */
const SPEC = {
  bus: { cw: 72, ch: 64, per: 5, ox: 36, oy: 38 },
  air: { cw: 112, ch: 104, per: 3, ox: 56, oy: 66 },
} as const;
export type VehicleKind = keyof typeof SPEC;

const base: Partial<Record<VehicleKind, Texture>> = {};
const cache = new Map<string, { tex: Texture; ax: number; ay: number }>();

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

/** Carry on even on failure (then vehicles are drawn procedurally) */
let trainBase: Texture | null = null;
const trainCache = new Map<string, { tex: Texture; ax: number; ay: number; sc: number }>();

export async function loadVehicleSprites(): Promise<void> {
  if (base.bus) return;
  const [b, a, t] = await Promise.all([loadImage(busUrl), loadImage(aircraftUrl), loadImage(trainUrl)]);
  if (b) base.bus = Texture.from(b);
  if (a) base.air = Texture.from(a);
  if (t) trainBase = Texture.from(t);
  for (const x of [base.bus, base.air, trainBase]) if (x) x.source.scaleMode = 'nearest';
}

type TrainMeta = { sc: number; h: number[][]; m: number[][] };

/**
 * One rail car's sprite (an atlas with the margins trimmed). head = the lead car (with a cab) / middle car. dir is 0-7.
 * The last car can be flipped by using the lead car with dir+4. sc is the scale that fits one car's length to the game's car spacing.
 */
export function trainFrame(design: number, head: boolean, dir: number): { tex: Texture; ax: number; ay: number; sc: number } | null {
  if (!trainBase) return null;
  const key = `${design}|${head ? 1 : 0}|${dir}`;
  let e = trainCache.get(key);
  if (!e) {
    const meta = (trainDesigns.designs as unknown as Record<string, TrainMeta>)[String(design)];
    const f = meta?.[head ? 'h' : 'm'][dir];
    if (!meta || !f) return null;
    e = { tex: new Texture({ source: trainBase.source, frame: new Rectangle(f[0], f[1], f[2], f[3]) }), ax: f[4] / f[2], ay: f[5] / f[3], sc: meta.sc };
    trainCache.set(key, e);
  }
  return e;
}

export const trainSpritesReady = (): boolean => trainBase !== null;

export const vehicleSpritesReady = (kind: VehicleKind): boolean => !!base[kind];

/** Depending on zoom, scale with nearest (pixels kept) when close and linear (smooth) when far */
export function setVehicleSmoothing(zoom: number): void {
  const mode = zoom >= 1 ? 'nearest' : 'linear';
  for (const t of [...Object.values(base), trainBase]) if (t && t.source.scaleMode !== mode) t.source.scaleMode = mode;
}

/** The texture and anchor for (kind, design, direction). null if the atlas is not loaded */
export function vehicleFrame(kind: VehicleKind, design: number, dir: number): { tex: Texture; ax: number; ay: number } | null {
  const b = base[kind];
  if (!b) return null;
  const key = `${kind}|${design}|${dir}`;
  let e = cache.get(key);
  if (!e) {
    const s = SPEC[kind];
    const x = (design % s.per) * s.cw * 8 + dir * s.cw;
    const y = Math.floor(design / s.per) * s.ch;
    e = { tex: new Texture({ source: b.source, frame: new Rectangle(x, y, s.cw, s.ch) }), ax: s.ox / s.cw, ay: s.oy / s.ch };
    cache.set(key, e);
  }
  return e;
}
