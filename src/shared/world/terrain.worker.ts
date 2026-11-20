import { generateTerrain } from './terrain';

export interface TerrainRequest {
  size: number;
  seed: number;
}
export type TerrainMessage =
  | { type: 'progress'; value: number }
  | { type: 'done'; height: Uint8Array };

self.onmessage = (e: MessageEvent<TerrainRequest>) => {
  const { size, seed } = e.data;
  const height = generateTerrain({
    size,
    seed,
    onProgress: (value) => (self as unknown as Worker).postMessage({ type: 'progress', value } satisfies TerrainMessage),
  });
  (self as unknown as Worker).postMessage({ type: 'done', height } satisfies TerrainMessage, [height.buffer]);
};
