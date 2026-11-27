import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import kit from '../../shared/data/stationKit.json';
import { STATION_KIT_BASE, type StationInfo, stationTile } from '../../shared/world/stations';
import { LEVEL_PX } from '../../shared/world/constants';
import url0 from '../assets/station0.png';
import url1 from '../assets/station1.png';
import url2 from '../assets/station2.png';
import url3 from '../assets/station3.png';

/**
 * Station sprites (station-kit tiles, 64x64). One atlas per variant (standard, other color, dark, snow).
 * Column = piece number*2 + layer (0 = ground, 1 = things above: roofs, station buildings, footbridges), row = base style*2 + axis.
 * The ground and the upper parts are drawn separately so a train is sandwiched "above the ground, below the roof".
 */
const TILE = kit.tile;
const GROUND_TOP = kit.groundTop;
const PIECE = new Map(kit.pieces.map((p, i) => [p, i]));
const images: (HTMLImageElement | null)[] = [null, null, null, null];

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // on failure, go back to the earlier drawing method
    img.src = url;
  });

export async function loadStationSprites(): Promise<void> {
  if (images[0]) return;
  const loaded = await Promise.all([url0, url1, url2, url3].map(loadImage));
  loaded.forEach((img, i) => (images[i] = img));
}

/** If the image is loaded, it can be drawn with the new design (sprites) */
export const stationSpritesReady = (): boolean => images.every((i) => i !== null);

/** One tile's part of a station: the position i along the length and j across the width (platform track), and the piece name placed there */
export interface StationCell {
  i: number;
  j: number;
  piece: string;
  /** In-game tile coordinates */
  x: number;
  y: number;
}

/** From the station's shape (platform tracks and platform length), decide each tile's piece. The platform side alternates per track, so adjacent tracks form an island platform */
export function stationLayout(info: StationInfo): StationCell[] {
  const glass = (info.design - STATION_KIT_BASE) % 3 === 0; // some styles have a glass roof
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

/** Where in the atlas the cell for (design, axis, piece, layer) is */
function cell(design: number, axis: 0 | 1, piece: string, layer: 0 | 1): { img: HTMLImageElement; sx: number; sy: number } | null {
  const d = design - STATION_KIT_BASE;
  const img = images[d % 4];
  const pi = PIECE.get(piece);
  if (!img || pi === undefined) return null;
  // The game's axis 1 (east-west, long along +x) is the kit's axis 0 (x); the game's axis 0 (north-south) is the kit's axis 1 (y)
  const kitAxis = axis === 1 ? 0 : 1;
  return { img, sx: (pi * 2 + layer) * TILE, sy: (Math.floor(d / 4) * 2 + kitAxis) * TILE };
}

/** Arrange the in-game station sprites into two layers: the ground (under trains) and the upper parts (over trains) */
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

  /** Call before redrawing */
  begin(): void {
    this.used = [0, 0];
  }

  /** Call when finished drawing (hides sprites that were not used) */
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

  /** Place the sprites for one station. lvl is the station's level; if selected, the ground is tinted orange */
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

/** Preview of the selected design: draw a station reflecting the number of tracks, platform length, and orientation, onto a canvas */
export function drawStationPreview(canvas: HTMLCanvasElement, info: StationInfo): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cells = stationLayout({ ...info, x0: 0, y0: 0 });
  if (!cells.length) return;
  // Bounding rectangle of the whole (screen coordinates)
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
