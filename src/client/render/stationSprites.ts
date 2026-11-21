import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import kit from '../../shared/data/stationKit.json';
import { STATION_KIT_BASE, type StationInfo, stationTile } from '../../shared/world/stations';
import { LEVEL_PX } from '../../shared/world/constants';
import url0 from '../assets/station0.png';
import url1 from '../assets/station1.png';
import url2 from '../assets/station2.png';
import url3 from '../assets/station3.png';

/**
 * 駅のスプライト(駅キットのタイル 64x64)。変種(標準・別色・ダーク・雪景色)ごとに1枚のアトラス。
 * 列 = ピース番号*2 + 層(0=地面 1=上の物: 屋根・駅舎・跨線橋)、行 = 基本の様式*2 + 軸。
 * 地面と上の物を別々に描いて、列車を「地面の上・屋根の下」に挟む。
 */
const TILE = kit.tile;
const GROUND_TOP = kit.groundTop;
const PIECE = new Map(kit.pieces.map((p, i) => [p, i]));
const images: (HTMLImageElement | null)[] = [null, null, null, null];

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // 失敗したら従来の描き方に戻る
    img.src = url;
  });

export async function loadStationSprites(): Promise<void> {
  if (images[0]) return;
  const loaded = await Promise.all([url0, url1, url2, url3].map(loadImage));
  loaded.forEach((img, i) => (images[i] = img));
}

/** 画像が読めていれば、新しいデザイン(スプライト)で描ける */
export const stationSpritesReady = (): boolean => images.every((i) => i !== null);

/** 駅の1タイル分の部品: 長手方向 i・幅方向 j(番線)の位置と、そこに置くピース名 */
export interface StationCell {
  i: number;
  j: number;
  piece: string;
  /** ゲーム内のタイル座標 */
  x: number;
  y: number;
}

/** 駅の形(番線数・ホーム長)から、各タイルのピースを決める。番線ごとにホームの側が交互になり、隣り合う番線で島式ホームになる */
export function stationLayout(info: StationInfo): StationCell[] {
  const glass = (info.design - STATION_KIT_BASE) % 3 === 0; // 一部の様式はガラスの屋根
  const out: StationCell[] = [];
  for (let j = 0; j < info.tracks; j++) {
    const side = j % 2 === 0 ? 'R' : 'L';
    for (let i = 0; i < info.len; i++) {
      let name = glass ? 'cang' : 'can';
      if (info.len >= 3 && i === Math.floor((info.len + 1) / 2)) name = 'shel';
      else if (info.len >= 3 && i === Math.max(1, info.len - 2)) name = 'brg';
      const [x, y] = stationTile(info, j, i);
      out.push({ i, j, piece: `${name}_${side}`, x, y });
    }
  }
  return out;
}

/** (design, 軸, ピース, 層) のセルが、アトラスのどの位置か */
function cell(design: number, axis: 0 | 1, piece: string, layer: 0 | 1): { img: HTMLImageElement; sx: number; sy: number } | null {
  const d = design - STATION_KIT_BASE;
  const img = images[d % 4];
  const pi = PIECE.get(piece);
  if (!img || pi === undefined) return null;
  // ゲームの軸 1(東西 = +x に長い)がキットの軸 0(x)、ゲームの軸 0(南北)がキットの軸 1(y)
  const kitAxis = axis === 1 ? 0 : 1;
  return { img, sx: (pi * 2 + layer) * TILE, sy: (Math.floor(d / 4) * 2 + kitAxis) * TILE };
}

/** ゲーム内の駅のスプライトを、地面(列車の下)と上の物(列車の上)の2つの層に並べる */
export class StationSprites {
  readonly ground = new Container();
  readonly objects = new Container();
  private pool: [Sprite[], Sprite[]] = [[], []];
  private used: [number, number] = [0, 0];
  private frames = new Map<string, Texture>();

  constructor() {
    this.ground.sortableChildren = true;
    this.objects.sortableChildren = true;
  }

  /** 描き直しの前に呼ぶ */
  begin(): void {
    this.used = [0, 0];
  }

  /** 描き終わったら呼ぶ(使わなかったスプライトを隠す) */
  end(): void {
    for (const l of [0, 1] as const) for (let i = this.used[l]; i < this.pool[l].length; i++) this.pool[l][i].visible = false;
  }

  clear(): void {
    this.begin();
    this.end();
  }

  private texture(c: { img: HTMLImageElement; sx: number; sy: number }): Texture {
    const key = `${c.img.src}|${c.sx}|${c.sy}`;
    let t = this.frames.get(key);
    if (!t) {
      t = new Texture({ source: Texture.from(c.img).source, frame: new Rectangle(c.sx, c.sy, TILE, TILE) });
      this.frames.set(key, t);
    }
    return t;
  }

  /** 駅1つぶんのスプライトを置く。lvl は駅の高さの段、selected なら地面を橙に染める */
  add(info: StationInfo, lvl: number, selected: boolean): void {
    for (const c of stationLayout(info)) {
      for (const layer of [0, 1] as const) {
        const src = cell(info.design, info.axis, c.piece, layer);
        if (!src) continue;
        const list = this.pool[layer];
        let sp = list[this.used[layer]];
        if (!sp) {
          sp = new Sprite();
          (layer === 0 ? this.ground : this.objects).addChild(sp);
          list.push(sp);
        }
        this.used[layer]++;
        sp.visible = true;
        sp.texture = this.texture(src);
        sp.position.set((c.x - c.y) * 32 - TILE / 2, (c.x + c.y) * 16 - lvl * LEVEL_PX - GROUND_TOP);
        sp.zIndex = c.x + c.y;
        sp.tint = selected && layer === 0 ? 0xffc890 : 0xffffff;
      }
    }
  }
}

/** 選択中のデザインの見本: 番線数・ホーム長・向きを反映した駅を、キャンバスに描く */
export function drawStationPreview(canvas: HTMLCanvasElement, info: StationInfo): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cells = stationLayout({ ...info, x0: 0, y0: 0 });
  if (!cells.length) return;
  // 全体の外接矩形(画面座標)
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    const px = (c.x - c.y) * 32 - TILE / 2;
    const py = (c.x + c.y) * 16 - GROUND_TOP;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px + TILE);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py + TILE);
  }
  const scale = Math.min(canvas.width / (maxX - minX + 8), canvas.height / (maxY - minY + 8), 3);
  ctx.imageSmoothingEnabled = false;
  ctx.translate((canvas.width - (maxX - minX) * scale) / 2 - minX * scale, (canvas.height - (maxY - minY) * scale) / 2 - minY * scale);
  ctx.scale(scale, scale);
  const order = [...cells].sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const layer of [0, 1] as const) {
    for (const c of order) {
      const src = cell(info.design, info.axis, c.piece, layer);
      if (!src) continue;
      ctx.drawImage(src.img, src.sx, src.sy, TILE, TILE, Math.round((c.x - c.y) * 32 - TILE / 2), Math.round((c.x + c.y) * 16 - GROUND_TOP), TILE, TILE);
    }
  }
}
