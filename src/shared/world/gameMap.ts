import { levelOf } from './constants';
import type { Town } from './town';
import type { Facility } from './facilities';
import { CHUNK, CHUNK_SHIFT, type TileLayer, u16Layer, u8Layer } from './tileLayer';

/** A generator returning the heights of a chunk (64x64). On a huge map, terrain is built only for chunks that are needed */
export type HeightChunkGen = (cx: number, cy: number) => Uint8Array;
/** Height at one point (uncached; for coarse lookups such as the minimap) */
export type HeightPoint = (x: number, y: number) => number;

/** A simple hash of the height array (FNV-1a, sampled sparsely). Used to check terrain matches at save time */
export function heightHash(h: Uint8Array): number {
  let x = 0x811c9dc5;
  const step = Math.max(1, Math.floor(h.length / 65536) | 1);
  for (let i = 0; i < h.length; i += step) x = Math.imul(x ^ h[i], 0x01000193);
  return x >>> 0;
}

/** The game map (tile data, held in typed arrays) */
export class GameMap {
  /** Road: low 4 bits = connections (N,E,S,W), high 4 bits = passable in that direction. 0 means no road */
  readonly road: TileLayer;
  /** Rail: low 4 bits = connections (N,E,S,W). Two-way only. 0 means no rail */
  readonly rail: TileLayer;
  /** Middle tiles of a bridge/tunnel: bit4 = bridge, bit5 = tunnel, low 4 bits = the road-surface level (bridge height). 0 is normal */
  readonly span: TileLayer;
  /** Airport tile: 0 = none, 1 = apron, 2 = runway, 3 = terminal */
  readonly air: TileLayer;
  /** Building: 0 = none, bits 0-1 = level (1..3), bits 2-5 = look variant */
  readonly building: TileLayer;
  /** Subway tiles (see subway.ts): connections, depth, and a present flag. Separate from the surface layers, so it can lie under buildings and roads */
  readonly subway: TileLayer;
  /** Multiplayer: the company that owns each subway tile (0 = none) */
  readonly subwayOwner: TileLayer<Uint16Array>;
  /** Increases whenever any subway tile changes (so the underground view knows to redraw) */
  subwayVer = 0;

  /**
   * The rail connections of a tile as the simulation sees them: the surface rail, plus the subway (bits 0-3) where there is one.
   * Surface rail and subway never share a tile (the build rules forbid it), so the union cannot let a train change layers by mistake.
   * Cheap when there is no subway yet (subwayVer is still 0).
   */
  railAt(i: number): number {
    const r = this.rail.get(i);
    if (this.subwayVer === 0) return r;
    const s = this.subway.get(i);
    return s & 0x80 ? r | (s & 15) : r;
  }
  /** Building under construction: 1 = under construction (the building is placed but not yet usable). Saves are restored from SimState.sites */
  readonly construction: TileLayer;
  /** Server: tiles under construction (index) -> the tick they finish */
  readonly sites = new Map<number, number>();
  /** ID of the town a building belongs to (0 = none) */
  readonly owner: TileLayer<Uint16Array>;
  /** Multiplayer: the company (account ID) that laid the road or rail. 0 = none / unowned */
  readonly infraOwner: TileLayer<Uint16Array>;
  readonly towns: Town[] = [];
  /** Huge map: regions whose towns are generated (ry * region count + rx) */
  readonly townRegions = new Set<number>();
  /** Large facilities (stadium, etc.). Their sites are placed in the building layer as FACILITY_TILE */
  readonly facilities: Facility[] = [];
  /** Increase whenever facilities are added or removed (to decide when to rebuild the drawing index) */
  facilityVer = 0;
  /** Increase whenever airport tiles change (to decide when to rebuild what an airport is: runways, stands, hangars) */
  airVer = 0;
  /** Notification when a tile changes (to regenerate drawing) */
  onTouch: ((x: number, y: number) => void) | null = null;
  /** Tiles edited by terraforming (index -> height). Terrain is regenerated from the seed, so only the differences are saved */
  readonly edits = new Map<number, number>();
  editVersion = 0;
  /** Terrain hash right after seed generation (before edits) */
  readonly baseHash: number;

  /** Heights: a whole array for small and medium maps; chunks generated lazily for huge maps */
  private dense: Uint8Array | null = null;
  private hchunks = new Map<number, Uint8Array>();
  private readonly cw: number;
  /** A single-point height lookup for huge maps (for the minimap) */
  readonly heightPoint: HeightPoint | null;

  constructor(
    readonly size: number,
    readonly seed: number,
    height: Uint8Array | HeightChunkGen,
    heightPoint?: HeightPoint,
  ) {
    this.cw = Math.ceil(size / CHUNK);
    this.heightPoint = heightPoint ?? null;
    if (typeof height === 'function') {
      this.gen = height;
      this.baseHash = 0;
    } else {
      this.dense = height;
      this.baseHash = heightHash(height);
    }
    this.road = u8Layer(size);
    this.rail = u8Layer(size);
    this.air = u8Layer(size);
    this.span = u8Layer(size);
    this.building = u8Layer(size);
    this.construction = u8Layer(size);
    this.subway = u8Layer(size);
    this.subwayOwner = u16Layer(size);
    this.owner = u16Layer(size);
    this.infraOwner = u16Layer(size);
  }

  private gen: HeightChunkGen | null = null;

  /** Whether it is a huge map (chunked) */
  get chunked(): boolean {
    return this.dense === null;
  }

  private heightIdx(x: number, y: number): number {
    if (this.dense) return this.dense[y * this.size + x];
    const key = (y >> CHUNK_SHIFT) * this.cw + (x >> CHUNK_SHIFT);
    let c = this.hchunks.get(key);
    if (!c) {
      c = this.gen!(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT).slice();
      for (const [i, h] of this.edits) {
        const ex = i % this.size;
        const ey = (i - ex) / this.size;
        if ((ey >> CHUNK_SHIFT) * this.cw + (ex >> CHUNK_SHIFT) === key) c[((ey & (CHUNK - 1)) << CHUNK_SHIFT) | (ex & (CHUNK - 1))] = h;
      }
      this.hchunks.set(key, c);
    }
    return c[((y & (CHUNK - 1)) << CHUNK_SHIFT) | (x & (CHUNK - 1))];
  }

  /** The whole height array (small and medium maps only; for saving and caching) */
  get height(): Uint8Array {
    if (!this.dense) throw new Error('巨大マップは高度の全体配列を持ちません');
    return this.dense;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  idx(x: number, y: number): number {
    return y * this.size + x;
  }

  /** Returns the height, clamping out-of-range coordinates to the nearest tile */
  heightAt(x: number, y: number): number {
    const s = this.size - 1;
    const cx = x < 0 ? 0 : x > s ? s : x;
    const cy = y < 0 ? 0 : y > s ? s : y;
    return this.heightIdx(cx, cy);
  }

  levelAt(x: number, y: number): number {
    return levelOf(this.heightAt(x, y));
  }

  /** Height (levels) at which vehicles and road surfaces sit. The middle tiles of a bridge or tunnel use the road-surface height */
  surfaceLevel(x: number, y: number): number {
    const sp = this.span.get(this.idx(Math.max(0, Math.min(this.size - 1, x)), Math.max(0, Math.min(this.size - 1, y))));
    return sp ? sp & 15 : this.levelAt(x, y);
  }

  /**
   * The continuous road-surface height (levels). (fx,fy) is the position within the tile (0..1).
   * When a road/rail connects to a neighbour one level higher, it climbs one level from the centre to the edge in that direction (a slope).
   */
  smoothLevel(x: number, y: number, fx: number, fy: number): number {
    if (!this.inBounds(x, y)) return this.levelAt(x, y);
    const i = this.idx(x, y);
    const base = this.surfaceLevel(x, y);
    if (this.span.get(i)) return base;
    const conn = this.road.get(i) | this.rail.get(i);
    if (!(conn & 15)) return base;
    let up = 0;
    const t = [(0.5 - fy) * 2, (fx - 0.5) * 2, (fy - 0.5) * 2, (0.5 - fx) * 2];
    const dxs = [0, 1, 0, -1];
    const dys = [-1, 0, 1, 0];
    for (let d = 0; d < 4; d++) {
      if (!(conn & (1 << d)) || t[d] <= 0) continue;
      const nx = x + dxs[d];
      const ny = y + dys[d];
      if (!this.inBounds(nx, ny) || this.span.get(this.idx(nx, ny))) continue;
      if (this.levelAt(nx, ny) === base + 1) up = Math.max(up, Math.min(1, t[d]));
    }
    return base + up;
  }

  touch(x: number, y: number): void {
    this.onTouch?.(x, y);
  }

  /** Restore terraforming differences from a save (no drawing notification) */
  restoreEdit(i: number, h: number): void {
    const x = i % this.size;
    const y = (i - x) / this.size;
    if (this.dense) this.dense[i] = h;
    else {
      this.heightIdx(x, y);
      this.hchunks.get((y >> CHUNK_SHIFT) * this.cw + (x >> CHUNK_SHIFT))![((y & (CHUNK - 1)) << CHUNK_SHIFT) | (x & (CHUNK - 1))] = h;
    }
    this.edits.set(i, h);
  }

  /** Terraform: change the height and also mark neighbouring tiles that affect wall drawing for redrawing */
  setHeight(x: number, y: number, h: number): void {
    const i = this.idx(x, y);
    if (this.dense) this.dense[i] = h;
    else {
      this.heightIdx(x, y); // allocate the chunk
      this.hchunks.get((y >> CHUNK_SHIFT) * this.cw + (x >> CHUNK_SHIFT))![((y & (CHUNK - 1)) << CHUNK_SHIFT) | (x & (CHUNK - 1))] = h;
    }
    this.edits.set(i, h);
    this.editVersion++;
    this.touch(x, y);
    this.touch(x - 1, y);
    this.touch(x, y - 1);
  }
}
