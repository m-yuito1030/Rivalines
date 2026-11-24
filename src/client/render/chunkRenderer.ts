import { Container, Sprite, Texture } from 'pixi.js';
import { LEVEL_PX, MAX_LEVEL, TILE_H, TILE_W } from '../../shared/world/constants';
import type { GameMap } from '../../shared/world/gameMap';
import { FACILITY_TILE, facilityAnchor, facilityTileMap, isSpriteFacility } from '../../shared/world/facilities';
import { drawFacilitySprite } from './buildingSprites';
import { drawAirTile, drawBridgeTile, drawBuilding, drawConstruction, drawRail, drawRamp, drawRoad, drawTunnelPortal } from './drawTile';
import { drawTerrainTile, hash2, lodCellColor } from './terrainDraw';

/** 1チャンク = CELLS x CELLS セル。LODが上がるとセル1つが step x step タイルになる */
export const CELLS = 16;
export const LOD_STEPS = [1, 4, 16] as const;
const MARGIN_TOP = MAX_LEVEL * LEVEL_PX + 128; // 標高+建物の高さぶんの上余白(px)
const CANVAS_W = CELLS * TILE_W + 128; // 左右に 2x2 建物(幅128px)のはみ出しぶんの余白
const CANVAS_H = CELLS * TILE_H + MARGIN_TOP + MAX_LEVEL * LEVEL_PX; // 下は崖の壁ぶん
const BUILD_BUDGET_MS = 8;

interface Entry {
  key: string;
  sprite: Sprite;
  bytes: number;
  lastUsed: number;
  lod: number;
  cx: number;
  cy: number;
  res: number;
  dirty: boolean;
}

export interface View {
  /** ワールド座標系で見えている矩形 */
  left: number;
  top: number;
  right: number;
  bottom: number;
  zoom: number;
}

/** 画面ズームから LOD を決める */
export function lodForZoom(zoom: number): number {
  if (zoom >= 0.25) return 0;
  if (zoom >= 0.06) return 1;
  return 2;
}

export class ChunkRenderer {
  readonly container = new Container();
  private cache = new Map<string, Entry>();
  private pending: { key: string; lod: number; cx: number; cy: number; res: number; dist: number }[] = [];
  private bytes = 0;
  private frame = 0;
  chunksVisible = 0;
  pendingCount = 0;

  private maxCacheBytes: number;
  private hiResZoom: number;
  private lowMem: boolean;

  /** lowMem: スマホ向け。キャッシュ上限を下げ、高解像度テクスチャを使うズームを狭める */
  constructor(
    private map: GameMap,
    opts: { lowMem?: boolean } = {},
  ) {
    this.container.sortableChildren = true;
    this.maxCacheBytes = (opts.lowMem ? 128 : 320) * 1024 * 1024;
    this.hiResZoom = opts.lowMem ? 0.8 : 0.5;
    this.lowMem = !!opts.lowMem;
  }

  /** ズームに応じたテクスチャ解像度: 近接(2x)は高精細、中間(1x)、遠景(0.5x) */
  private resFor(zoom: number): number {
    if (!this.lowMem && zoom >= 1.15) return 2;
    return zoom >= this.hiResZoom ? 1 : 0.5;
  }

  /** 毎フレーム呼ぶ。見えるチャンクを確保し、不要なものを整理する */
  update(view: View): void {
    this.frame++;
    const lod = lodForZoom(view.zoom);
    const step = LOD_STEPS[lod];
    const res = this.resFor(view.zoom); // テクスチャ解像度(メモリ節約)
    const span = CELLS * step; // チャンクが覆うタイル数
    const chunksPerAxis = Math.ceil(this.map.size / span);

    // 見える範囲のタイルbbox(余白付き)
    const m = 128 * step;
    const corners = [
      [view.left - m, view.top - m],
      [view.right + m, view.top - m],
      [view.left - m, view.bottom + m],
      [view.right + m, view.bottom + m],
    ].map(([x, y]) => [(y / 16 + x / 32) / 2, (y / 16 - x / 32) / 2]);
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])) / span));
    const x1 = Math.min(chunksPerAxis - 1, Math.floor(Math.max(...corners.map((c) => c[0])) / span));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])) / span));
    const y1 = Math.min(chunksPerAxis - 1, Math.floor(Math.max(...corners.map((c) => c[1])) / span));

    const cxm = (view.left + view.right) / 2;
    const cym = (view.top + view.bottom) / 2;
    const visible = new Set<string>();
    const dirty: Entry[] = [];
    this.pending = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        // チャンクのスプライト矩形とビューの交差判定
        const ox = (cx * span - cy * span) * 32;
        const oy = (cx * span + cy * span) * 16;
        const sl = ox - (CANVAS_W / 2) * step;
        const st = oy - MARGIN_TOP * step;
        if (sl > view.right || sl + CANVAS_W * step < view.left) continue;
        if (st > view.bottom || st + CANVAS_H * step < view.top) continue;
        const key = `${lod}:${res}:${cx}:${cy}`;
        visible.add(key);
        const e = this.cache.get(key);
        if (e) {
          e.lastUsed = this.frame;
          if (!e.sprite.parent) this.container.addChild(e.sprite);
          if (e.dirty) dirty.push(e);
        } else {
          const dx = sl + (CANVAS_W * step) / 2 - cxm;
          const dy = st + (CANVAS_H * step) / 2 - cym;
          this.pending.push({ key, lod, cx, cy, res, dist: dx * dx + dy * dy });
        }
      }
    }
    this.chunksVisible = visible.size;
    this.pendingCount = this.pending.length;

    // 近い順に、時間予算内でビルド
    this.pending.sort((a, b) => a.dist - b.dist);
    const t0 = performance.now();
    for (const e of dirty) {
      this.rebuild(e);
      if (performance.now() - t0 > BUILD_BUDGET_MS) break;
    }
    for (const p of this.pending) {
      this.build(p.key, p.lod, p.cx, p.cy, p.res);
      if (performance.now() - t0 > BUILD_BUDGET_MS) break;
    }

    // 新LODが出揃うまで旧スプライトを残し、揃ったら見えないものを外す
    const allReady = this.pending.every((p) => this.cache.has(p.key));
    if (allReady) {
      for (const e of this.cache.values()) {
        if (!visible.has(e.key) && e.sprite.parent) this.container.removeChild(e.sprite);
      }
    }
    this.evict(visible);
  }

  private makeTexture(lod: number, cx: number, cy: number, res: number): { texture: Texture; bytes: number } {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(CANVAS_W * res);
    canvas.height = Math.ceil(CANVAS_H * res);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(res, res);
    this.drawChunk(ctx, cx, cy, LOD_STEPS[lod], res >= 1);
    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'linear';
    return { texture, bytes: canvas.width * canvas.height * 4 };
  }

  private build(key: string, lod: number, cx: number, cy: number, res: number): void {
    const step = LOD_STEPS[lod];
    const { texture, bytes } = this.makeTexture(lod, cx, cy, res);
    const sprite = new Sprite(texture);
    const span = CELLS * step;
    sprite.x = (cx * span - cy * span) * 32 - (CANVAS_W / 2) * step;
    sprite.y = (cx * span + cy * span) * 16 - MARGIN_TOP * step;
    sprite.scale.set(step / res);
    sprite.zIndex = (2 - lod) * 100000 + cx + cy;
    this.container.addChild(sprite);
    this.bytes += bytes;
    this.cache.set(key, { key, sprite, bytes, lastUsed: this.frame, lod, cx, cy, res, dirty: false });
  }

  /** 内容が変わったチャンクのテクスチャを作り直す */
  private rebuild(e: Entry): void {
    const { texture, bytes } = this.makeTexture(e.lod, e.cx, e.cy, e.res);
    const old = e.sprite.texture;
    e.sprite.texture = texture;
    old.destroy(true);
    this.bytes += bytes - e.bytes;
    e.bytes = bytes;
    e.dirty = false;
  }

  /** タイル(x,y)が変化した: それを含む全LODのキャッシュ済みチャンクを要再生成にする */
  markDirty(x: number, y: number): void {
    for (let lod = 0; lod < LOD_STEPS.length; lod++) {
      const span = CELLS * LOD_STEPS[lod];
      const cx = Math.floor(x / span);
      const cy = Math.floor(y / span);
      for (const res of [2, 1, 0.5]) {
        const e = this.cache.get(`${lod}:${res}:${cx}:${cy}`);
        if (e) e.dirty = true;
      }
    }
  }

  private drawChunk(ctx: CanvasRenderingContext2D, cx: number, cy: number, step: number, detail: boolean): void {
    const map = this.map;
    const half = step >> 1;
    const tx0 = cx * CELLS * step;
    const ty0 = cy * CELLS * step;
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const seed = map.seed;

    for (let j = 0; j < CELLS; j++) {
      for (let i = 0; i < CELLS; i++) {
        const tx = tx0 + i * step;
        const ty = ty0 + j * step;
        if (tx >= map.size || ty >= map.size) continue;
        const sx = tx + half;
        const sy = ty + half;
        const h = map.heightAt(sx, sy);
        const lvl = map.levelAt(sx, sy);
        const px = (i - j) * hw + CANVAS_W / 2;
        const py = (i + j) * hh - lvl * LEVEL_PX + MARGIN_TOP;
        const nb = { n: map.levelAt(sx, sy - step), e: map.levelAt(sx + step, sy), s: map.levelAt(sx, sy + step), w: map.levelAt(sx - step, sy) };

        if (step === 1) {
          const k = map.idx(tx, ty);
          const occupied = map.road.get(k) !== 0 || map.building.get(k) !== 0 || map.rail.get(k) !== 0 || map.air.get(k) !== 0;
          const sp = map.span.get(k);
          drawTerrainTile(ctx, map, tx, ty, px, py, lvl, h, nb, detail, occupied && !(sp & 32));
          if (sp & 16) {
            // 橋: 地面の上に路面を持ち上げて描く
            drawBridgeTile(ctx, px, py, ((sp & 15) - lvl) * LEVEL_PX, map.road.get(k), map.rail.get(k), hash2(tx, ty, seed + 13));
          } else if (sp & 32) {
            // トンネル: 路面は見えない。坑口は隣が通常タイルの側に描く
            for (let d = 0; d < 4; d++) {
              const nx2 = tx + [0, 1, 0, -1][d];
              const ny2 = ty + [-1, 0, 1, 0][d];
              if ((map.road.get(k) | map.rail.get(k)) & (1 << d) && map.inBounds(nx2, ny2) && !(map.span.get(map.idx(nx2, ny2)) & 32))
                drawTunnelPortal(ctx, px, py, d, (lvl - (sp & 15)) * LEVEL_PX);
            }
          } else {
            if (map.air.get(k)) drawAirTile(ctx, px, py, map.air.get(k));
            if (map.road.get(k)) drawRoad(ctx, px, py, map.road.get(k), hash2(tx, ty, seed + 13), detail);
            if (map.rail.get(k)) drawRail(ctx, px, py, map.rail.get(k));
            // 1段高い隣へつながる道路/線路はスロープで描く
            for (let d = 0; d < 4; d++) {
              const nx2 = tx + [0, 1, 0, -1][d];
              const ny2 = ty + [-1, 0, 1, 0][d];
              if (!map.inBounds(nx2, ny2) || map.span.get(map.idx(nx2, ny2)) || map.levelAt(nx2, ny2) !== lvl + 1) continue;
              if (map.road.get(k) & (1 << d)) drawRamp(ctx, px, py, d, 'road');
              if (map.rail.get(k) & (1 << d)) drawRamp(ctx, px, py, d, 'rail');
            }
          }
          if (map.building.get(k) === FACILITY_TILE) {
            // 学校・市役所・百貨店・モールはスプライト(敷地の手前のタイルで描く)。スタジアムなどは別レイヤーで描く
            const f = facilityTileMap(map).get(k);
            if (f && isSpriteFacility(f) && facilityAnchor(map, f) === k) drawFacilitySprite(ctx, px, py, f);
          } else if (map.building.get(k) && map.construction.get(k)) drawConstruction(ctx, px, py, map.building.get(k) & 3, hash2(tx, ty, seed + 19));
          else if (map.building.get(k)) drawBuilding(ctx, px, py, map.building.get(k), hash2(tx, ty, seed + 17), detail);
        } else {
          const color = this.blockBuilt(tx, ty, step) ? '#9b9a96' : lodCellColor(map, sx, sy, lvl, h);
          drawTerrainTile(ctx, map, sx, sy, px, py, lvl, h, nb, false, true, color);
        }
      }
    }
  }

  /** LOD>0: セルが覆うブロック内に道路/建物があるか(粗くサンプリング) */
  private blockBuilt(tx: number, ty: number, step: number): boolean {
    const m = this.map;
    if (m.towns.length === 0) return false;
    const s = Math.max(1, step >> 2);
    for (let y = ty; y < Math.min(ty + step, m.size); y += s) {
      for (let x = tx; x < Math.min(tx + step, m.size); x += s) {
        const k = y * m.size + x;
        if (m.road.get(k) || m.building.get(k) || m.rail.get(k) || m.air.get(k)) return true;
      }
    }
    return false;
  }

  private evict(visible: Set<string>): void {
    if (this.bytes <= this.maxCacheBytes) return;
    const candidates = [...this.cache.values()].filter((e) => !visible.has(e.key)).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of candidates) {
      if (this.bytes <= this.maxCacheBytes * 0.8) break;
      if (e.sprite.parent) this.container.removeChild(e.sprite);
      e.sprite.destroy({ texture: true, textureSource: true });
      this.bytes -= e.bytes;
      this.cache.delete(e.key);
    }
  }

  get cacheMB(): number {
    return this.bytes / 1048576;
  }
}
