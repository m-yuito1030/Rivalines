import { Rectangle, Texture } from 'pixi.js';
import busUrl from '../assets/bus.png';
import aircraftUrl from '../assets/aircraft.png';
import trainUrl from '../assets/train.png';
import trainDesigns from '../../shared/data/trainDesigns.json';

/** 乗り物スプライトの拡大率(ゲームのタイルに合わせて小さくしてある。大きすぎ・小さすぎならここを調整する) */
export const BUS_SCALE = 0.55;
export const AIR_SCALE = 0.6;

/**
 * バス(250種)・航空機(100種)の8方向スプライト。方向 k は 0=+u(画面右下) から45度ずつ(transitLayer の dirIndex と同じ)。
 * アトラス: 1デザイン = 8方向を横に並べた帯。バスは1行に5デザイン(セル72x64)、航空機は1行に3デザイン(セル112x104)。
 * 原点(車両の地面位置)はセル内の (ox,oy)。
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

/** 失敗しても続行する(その場合は手続き描画の乗り物になる) */
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
 * 鉄道1両のスプライト(余白を詰めたアトラス)。head=先頭車(運転台つき)/中間車。dir は 0〜7。
 * 最後尾は先頭車を dir+4 で使うと反転できる。sc は1両の長さをゲームの車両間隔に合わせる拡大率。
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

/** ズームに応じて、近いときはドットのまま(nearest)、遠いときはなめらか(linear)に拡縮する */
export function setVehicleSmoothing(zoom: number): void {
  const mode = zoom >= 1 ? 'nearest' : 'linear';
  for (const t of [...Object.values(base), trainBase]) if (t && t.source.scaleMode !== mode) t.source.scaleMode = mode;
}

/** (種類, デザイン, 方向) のテクスチャとアンカー。アトラスが読めていなければ null */
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
