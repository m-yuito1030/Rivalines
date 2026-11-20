import { GameMap } from './gameMap';
import { BIG_MAP_MIN, bigChunk, bigHeight } from './bigTerrain';
import type { TerrainMessage } from './terrain.worker';
import { TERRAIN_VERSION } from '../save/serialize';
import { getTerrain, putTerrain } from '../save/storage';

/** Web Worker で地形を生成する */
export async function generateMapAsync(size: number, seed: number, onProgress: (p: number) => void): Promise<GameMap> {
  // 巨大マップ: 全体は作らず、必要なチャンクを座標とシードから都度生成する(待ち時間なし)
  if (size >= BIG_MAP_MIN) {
    onProgress(1);
    return new GameMap(size, seed, (cx, cy) => bigChunk(cx, cy, seed), (x, y) => bigHeight(x, y, seed, 5));
  }
  // 生成済みの地形があればそれを使う(同じ size/seed/地形バージョンなら結果は同一)
  const key = `${TERRAIN_VERSION}:${size}:${seed}`;
  const cached = await getTerrain(key);
  if (cached && cached.length === size * size) {
    onProgress(1);
    return new GameMap(size, seed, cached);
  }
  const map = await generateInWorker(size, seed, onProgress);
  void putTerrain(key, map.height.slice());
  return map;
}

function generateInWorker(size: number, seed: number, onProgress: (p: number) => void): Promise<GameMap> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<TerrainMessage>) => {
      if (e.data.type === 'progress') onProgress(e.data.value);
      else {
        worker.terminate();
        resolve(new GameMap(size, seed, e.data.height));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ size, seed });
  });
}
