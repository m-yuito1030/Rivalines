import type { SimState } from '../sim/simulation';
import { type GameMap, heightHash } from '../world/gameMap';
import type { TileLayer } from '../world/tileLayer';

const LAYERS = ['road', 'building', 'rail', 'air', 'span', 'owner', 'infraOwner'] as const;
/** Layers of the old versions (v3/v4) */
const LAYERS_OLD = ['road', 'building', 'rail', 'air', 'span', 'owner'] as const;
type LayerKey = (typeof LAYERS)[number];
/** List of tiles whose value is not 0 */
export interface Sparse {
  idx: Uint32Array;
  val: Uint16Array;
}

/** Increment when the terrain generation algorithm changes (old saves would not match the terrain) */
export const TERRAIN_VERSION = 2;
const MAGIC = 'SIMSAVE2';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface SaveHeader {
  version: 3 | 4 | 5;
  terrainVersion: number;
  size: number;
  seed: number;
  /** A simple hash of the terrain (to check the regenerated terrain matches the one at save time) */
  heightHash: number;
  /** Terraforming differences [index, height] */
  edits: [number, number][];
  savedAt: number;
  sim: SimState;
  camera?: CameraState;
}

export interface SaveMeta {
  savedAt: number;
  size: number;
  seed: number;
  gameDate: string;
  towns: number;
  pop: number;
  vehicles: number;
}

export { heightHash };

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export function metaOf(map: GameMap, sim: SimState, gameDate: string, savedAt = Date.now()): SaveMeta {
  return {
    savedAt,
    size: map.size,
    seed: map.seed,
    gameDate,
    towns: map.towns.length,
    pop: map.towns.reduce((s, t) => s + t.pop, 0),
    vehicles: sim.transit.vehicles.length,
  };
}

/** Turn the game state into gzip-compressed bytes. Terrain (heights) is regenerated from the seed, so it is not saved */
export async function encodeSave(map: GameMap, sim: SimState, camera?: CameraState): Promise<Uint8Array<ArrayBuffer>> {
  const header: SaveHeader = {
    version: 5,
    terrainVersion: TERRAIN_VERSION,
    size: map.size,
    seed: map.seed,
    heightHash: map.baseHash,
    edits: [...map.edits],
    savedAt: Date.now(),
    sim,
    camera,
  };
  const hj = new TextEncoder().encode(JSON.stringify(header));
  // 4: each layer is saved as "only tiles whose value is not 0" (index u32, value u16). The save size is proportional to the amount of editing, even on a huge map
  const layers = LAYERS.map((k) => {
    const list: number[] = [];
    (map[k] as TileLayer<Uint8Array | Uint16Array>).forEachNonZero((i, v) => list.push(i, v));
    return list;
  });
  const out = new Uint8Array(12 + hj.length + layers.reduce((a, l) => a + 4 + (l.length / 2) * 6, 0));
  out.set(new TextEncoder().encode(MAGIC), 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(8, hj.length, true);
  out.set(hj, 12);
  let o = 12 + hj.length;
  for (const l of layers) {
    dv.setUint32(o, l.length / 2, true);
    o += 4;
    for (let k = 0; k < l.length; k += 2) {
      dv.setUint32(o, l[k], true);
      dv.setUint16(o + 4, l[k + 1], true);
      o += 6;
    }
  }
  return pipe(out, new CompressionStream('gzip'));
}

export interface DecodedSave {
  header: SaveHeader;
  layers: Record<LayerKey, Sparse>;
}

function denseToSparse(a: ArrayLike<number>): Sparse {
  const idx: number[] = [];
  const val: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i]) (idx.push(i), val.push(a[i]));
  return { idx: Uint32Array.from(idx), val: Uint16Array.from(val) };
}

export async function decodeSave(compressed: Uint8Array<ArrayBuffer>): Promise<DecodedSave> {
  const raw = await pipe(compressed, new DecompressionStream('gzip'));
  if (new TextDecoder().decode(raw.subarray(0, 8)) !== MAGIC) throw new Error('セーブデータの形式が正しくありません');
  const dv = new DataView(raw.buffer, raw.byteOffset);
  const hlen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + hlen))) as SaveHeader;
  let o = 12 + hlen;
  const layers = Object.fromEntries(LAYERS.map((k) => [k, { idx: new Uint32Array(0), val: new Uint16Array(0) }])) as Record<LayerKey, Sparse>;
  if (header.version === 3) {
    const n = header.size * header.size;
    if (raw.length !== o + n * 7) throw new Error('セーブデータが壊れています(サイズ不一致)');
    for (const k of LAYERS_OLD) {
      if (k === 'owner') layers[k] = denseToSparse(new Uint16Array(raw.slice(o, o + n * 2).buffer));
      else layers[k] = denseToSparse(raw.subarray(o, o + n));
      o += k === 'owner' ? n * 2 : n;
    }
    return { header, layers };
  }
  if (header.version !== 4 && header.version !== 5) throw new Error(`未対応のセーブバージョン: ${header.version}`);
  for (const k of header.version === 4 ? LAYERS_OLD : LAYERS) {
    const cnt = dv.getUint32(o, true);
    o += 4;
    if (o + cnt * 6 > raw.length) throw new Error('セーブデータが壊れています');
    const idx = new Uint32Array(cnt);
    const val = new Uint16Array(cnt);
    for (let j = 0; j < cnt; j++) {
      idx[j] = dv.getUint32(o, true);
      val[j] = dv.getUint16(o + 4, true);
      o += 6;
    }
    layers[k] = { idx, val };
  }
  return { header, layers };
}

/** Apply the saved layers to the regenerated terrain. An error if the terrain differs */
export function applyLayers(map: GameMap, d: DecodedSave): void {
  if (d.header.terrainVersion !== TERRAIN_VERSION || d.header.heightHash !== map.baseHash) {
    throw new Error('地形がセーブ時と一致しません(ゲームの更新で地形生成が変わった可能性があります)');
  }
  for (const [i, h] of d.header.edits ?? []) map.restoreEdit(i, h);
  for (const k of LAYERS) {
    const { idx, val } = d.layers[k];
    const layer = map[k] as TileLayer<Uint8Array | Uint16Array>;
    for (let j = 0; j < idx.length; j++) layer.set(idx[j], val[j]);
  }
}
