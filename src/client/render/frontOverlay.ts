import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Transit } from '../../shared/sim/network/transit';
import type { GameMap } from '../../shared/world/gameMap';
import { FACILITY_TILE, type Facility, isSpriteFacility } from '../../shared/world/facilities';
import { stationTiles } from '../../shared/world/stations';
import { LEVEL_PX } from '../../shared/world/constants';
import { buildingSpriteRect, facilitySpriteFrame } from './buildingSprites';
import { hash2 } from './terrainDraw';
import type { View } from './chunkRenderer';

/**
 * Front buildings: stations, depots, large facilities, and vehicles are drawn on a layer separate from town buildings, so as-is they would cover even the buildings in front of them.
 * Only the buildings in front of those (town buildings and sprite facilities) are redrawn on an upper layer so the front/back order is right.
 */
export class FrontOverlay {
  readonly container = new Container();
  private sprites: Sprite[] = [];
  private frameTex = new Map<string, Texture>();

  constructor(
    private readonly map: GameMap,
    private readonly transit: Transit,
  ) {}

  /** Report the tiles where a vehicle was drawn in the current frame (u,v are tile coordinates) */
  addVehicleTile(u: number, v: number): void {
    this.vehTiles.push(Math.floor(u), Math.floor(v));
  }

  /** Hide everything (when zoomed too far out) */
  clear(): void {
    this.hideFrom(0);
    this.staticFront = [];
    this.staticFacs = [];
    this.vehTiles.length = 0;
  }

  /** Buildings (tile indexes) in front of stations, depots, and large facilities. Recomputed only when the structure changes */
  private staticFront: number[] = [];
  /** Likewise, sprite facilities in front of stations, depots, and large facilities (so station roofs and the like do not cover them) */
  private staticFacs: Facility[] = [];
  /** Tiles where a vehicle was drawn in the current frame (with duplicates) */
  private vehTiles: number[] = [];
  /** For each tile, the list of "buildings in front" (for vehicles; rebuilt every few seconds) */
  private nearCache = new Map<number, number[]>();
  private nearCacheAt = 0;

  /**
   * Stations, depots, large facilities, and vehicles are drawn on a layer separate from town buildings, so as-is they always cover even the buildings in front of them.
   * Only the buildings in front of them (the side with larger x+y) are redrawn on top so the front/back order is right.
   * Here we work out the part for stations, depots, and facilities (the vehicle part is added every frame in renderFront).
   */
  computeStatic(view: View): void {
    const m = this.map;
    const inView = (wx: number, wy: number) => wx > view.left - 160 && wx < view.right + 160 && wy > view.top - 320 && wy < view.bottom + 160;
    const out = new Set<number>();
    const outFacs = new Set<Facility>();
    const spriteFacs = m.facilities.filter(isSpriteFacility);
    const R = 7; // how many tiles to the front and around to check, to allow for building height
    const scan = (tiles: [number, number][]) => {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const [x, y] of tiles) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      if (!inView((x0 - y0) * 32, (x0 + y0) * 16)) return;
      for (let ty = Math.max(0, y0 - 2); ty <= Math.min(m.size - 1, y1 + R); ty++) {
        for (let tx = Math.max(0, x0 - 2); tx <= Math.min(m.size - 1, x1 + R); tx++) {
          const b = m.building.get(m.idx(tx, ty));
          if (!b || b === FACILITY_TILE) continue;
          // Only buildings in front of (larger x+y than) the nearest tile
          let best = Infinity;
          let bsum = 0;
          for (const [x, y] of tiles) {
            const d = Math.abs(tx - x) + Math.abs(ty - y);
            if (d < best) {
              best = d;
              bsum = x + y;
            }
          }
          if (tx + ty > bsum) out.add(m.idx(tx, ty));
        }
      }
      // Sprite facilities: only those whose front tile (the site tile with the largest x+y) is in front of the nearest tile
      for (const f of spriteFacs) {
        const ax = f.x0 + f.w - 1;
        const ay = f.y0 + f.h - 1;
        if (ax < x0 - 2 || ax > x1 + R || ay < y0 - 2 || ay > y1 + R) continue;
        let best = Infinity;
        let bsum = 0;
        for (const [x, y] of tiles) {
          const d = Math.abs(ax - x) + Math.abs(ay - y);
          if (d < best) {
            best = d;
            bsum = x + y;
          }
        }
        if (ax + ay > bsum) outFacs.add(f);
      }
    };
    for (const s of this.transit.stops.values()) {
      if (s.waypoint || s.kind !== 'rail') continue;
      scan(s.station ? stationTiles(s.station) : [[s.x, s.y]]);
    }
    for (const d of this.transit.depots.values()) scan([[d.x, d.y]]);
    for (const f of m.facilities) {
      if (isSpriteFacility(f)) continue; // sprite facilities are on the same layer as buildings
      const tiles: [number, number][] = [];
      for (let y = f.y0; y < f.y0 + f.h; y++) for (let x = f.x0; x < f.x0 + f.w; x++) tiles.push([x, y]);
      scan(tiles);
    }
    this.staticFront = [...out];
    this.staticFacs = [...outFacs];
  }

  /** Buildings in front of the tile a vehicle is on (so the vehicle is hidden behind buildings) */
  private nearFront(tx: number, ty: number): number[] {
    const m = this.map;
    const key = ty * m.size + tx;
    let l = this.nearCache.get(key);
    if (l) return l;
    l = [];
    for (let y = Math.max(0, ty - 1); y <= Math.min(m.size - 1, ty + 7); y++) {
      for (let x = Math.max(0, tx - 1); x <= Math.min(m.size - 1, tx + 7); x++) {
        if (x + y <= tx + ty) continue;
        const b = m.building.get(m.idx(x, y));
        if (b && b !== FACILITY_TILE) l.push(m.idx(x, y));
      }
    }
    this.nearCache.set(key, l);
    return l;
  }

  /** Update the sprites of buildings redrawn in front (every frame) */
  render(): void {
    const m = this.map;
    const now = performance.now();
    if (now - this.nearCacheAt > 3000 || this.nearCache.size > 20000) {
      this.nearCache.clear();
      this.nearCacheAt = now;
    }
    const want = new Set<number>(this.staticFront);
    const doneTiles = new Set<number>();
    for (let i = 0; i < this.vehTiles.length; i += 2) {
      const tx = this.vehTiles[i];
      const ty = this.vehTiles[i + 1];
      if (!m.inBounds(tx, ty)) continue;
      const k = ty * m.size + tx;
      if (doneTiles.has(k)) continue;
      doneTiles.add(k);
      for (const b of this.nearFront(tx, ty)) want.add(b);
    }
    this.vehTiles.length = 0;
    this.container.sortableChildren = true;
    let n = 0;
    for (const k of want) {
      if (n >= 3000) break;
      const tx = k % m.size;
      const ty = Math.floor(k / m.size);
      const b = m.building.get(k);
      if (!b) continue;
      const r = buildingSpriteRect(b, hash2(tx, ty, m.seed + 17));
      if (!r) continue;
      const lvl = m.levelAt(tx, ty);
      const px = (tx - ty) * 32;
      const py = (tx + ty) * 16 - lvl * LEVEL_PX;
      const cy = r.level === 3 ? py : py + 16;
      const fk = `${r.img.src}|${r.sx}|${r.sy}`;
      let tex = this.frameTex.get(fk);
      if (!tex) {
        tex = new Texture({ source: Texture.from(r.img).source, frame: new Rectangle(r.sx, r.sy, r.w, r.h) });
        this.frameTex.set(fk, tex);
      }
      let sp = this.sprites[n];
      if (!sp) {
        sp = new Sprite();
        this.container.addChild(sp);
        this.sprites.push(sp);
      }
      n++;
      sp.visible = true;
      sp.texture = tex;
      sp.position.set(Math.round(px - r.cx), Math.round(cy - r.cy));
      sp.zIndex = tx + ty;
    }
    // Sprite facilities (ordered with the same front/back relation as town buildings, relative to the site's front tile)
    for (const f of this.staticFacs) {
      const fr = facilitySpriteFrame(f);
      if (!fr) continue;
      const ax = f.x0 + f.w - 1;
      const ay = f.y0 + f.h - 1;
      const lvl = m.levelAt(ax, ay);
      const fk = `${fr.img.src}|${fr.sx}|${fr.sy}|${fr.w}|${fr.h}`;
      let tex = this.frameTex.get(fk);
      if (!tex) {
        tex = new Texture({ source: Texture.from(fr.img).source, frame: new Rectangle(fr.sx, fr.sy, fr.w, fr.h) });
        this.frameTex.set(fk, tex);
      }
      let sp = this.sprites[n];
      if (!sp) {
        sp = new Sprite();
        this.container.addChild(sp);
        this.sprites.push(sp);
      }
      n++;
      sp.visible = true;
      sp.texture = tex;
      sp.position.set(Math.round((ax - ay) * 32 + fr.dx), Math.round((ax + ay) * 16 - lvl * LEVEL_PX + fr.dy));
      sp.zIndex = ax + ay;
    }
    this.hideFrom(n);
  }

  private hideFrom(from: number): void {
    for (let i = from; i < this.sprites.length; i++) this.sprites[i].visible = false;
  }
}
