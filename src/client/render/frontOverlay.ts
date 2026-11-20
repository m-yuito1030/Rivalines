import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Transit } from '../../shared/sim/network/transit';
import type { GameMap } from '../../shared/world/gameMap';
import { FACILITY_TILE, isSpriteFacility } from '../../shared/world/facilities';
import { stationTiles } from '../../shared/world/stations';
import { LEVEL_PX } from '../../shared/world/constants';
import { SPRITE_H, SPRITE_W, buildingSpriteRect } from './buildingSprites';
import { hash2 } from './terrainDraw';
import type { View } from './chunkRenderer';

/**
 * 前面の建物: 駅・車両基地・大型施設・車両は街の建物とは別の層で描くため、そのままだと手前の建物にも上から被さる。
 * それらの手前にある建物だけを、上の層に描き直して前後を正しくする。
 */
export class FrontOverlay {
  readonly container = new Container();
  private sprites: Sprite[] = [];
  private frameTex = new Map<string, Texture>();

  constructor(
    private readonly map: GameMap,
    private readonly transit: Transit,
  ) {}

  /** 今のフレームで車両を描いたタイルを知らせる(u,v はタイル座標) */
  addVehicleTile(u: number, v: number): void {
    this.vehTiles.push(Math.floor(u), Math.floor(v));
  }

  /** 全部隠す(画面が遠すぎるとき) */
  clear(): void {
    this.hideFrom(0);
    this.staticFront = [];
    this.vehTiles.length = 0;
  }

  /** 駅・車両基地・大型施設の手前にある建物(タイルindex)。構造が変わったときだけ計算し直す */
  private staticFront: number[] = [];
  /** 今のフレームで車両を描いたタイル(重複あり) */
  private vehTiles: number[] = [];
  /** タイルごとの「手前にある建物」の一覧(車両用。数秒ごとに作り直す) */
  private nearCache = new Map<number, number[]>();
  private nearCacheAt = 0;

  /**
   * 駅・車両基地・大型施設・車両は、街の建物とは別の層で描くため、そのままだと手前の建物にも常に上から被さる。
   * これらの手前(x+y が大きい側)にある建物だけを、上に描き直して前後を正しくする。
   * ここでは駅・基地・施設の分を求める(車両の分は毎フレーム renderFront で足す)。
   */
  computeStatic(view: View): void {
    const m = this.map;
    const inView = (wx: number, wy: number) => wx > view.left - 160 && wx < view.right + 160 && wy > view.top - 320 && wy < view.bottom + 160;
    const out = new Set<number>();
    const R = 7; // 建物の高さぶん、手前〜周囲の何タイルまで調べるか
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
          // 最も近いタイルより手前(x+y が大きい)にある建物だけ
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
    };
    for (const s of this.transit.stops.values()) {
      if (s.waypoint || s.kind !== 'rail') continue;
      scan(s.station ? stationTiles(s.station) : [[s.x, s.y]]);
    }
    for (const d of this.transit.depots.values()) scan([[d.x, d.y]]);
    for (const f of m.facilities) {
      if (isSpriteFacility(f)) continue; // スプライトの施設は建物と同じ層
      const tiles: [number, number][] = [];
      for (let y = f.y0; y < f.y0 + f.h; y++) for (let x = f.x0; x < f.x0 + f.w; x++) tiles.push([x, y]);
      scan(tiles);
    }
    this.staticFront = [...out];
  }

  /** 車両のいるタイルの手前にある建物(車両を建物の陰に隠す) */
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

  /** 前面に描き直す建物のスプライトを更新する(毎フレーム) */
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
        tex = new Texture({ source: Texture.from(r.img).source, frame: new Rectangle(r.sx, r.sy, SPRITE_W, SPRITE_H) });
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
      sp.position.set(Math.round(px - 64), Math.round(cy - 150));
      sp.zIndex = tx + ty;
    }
    this.hideFrom(n);
  }

  private hideFrom(from: number): void {
    for (let i = from; i < this.sprites.length; i++) this.sprites[i].visible = false;
  }
}
