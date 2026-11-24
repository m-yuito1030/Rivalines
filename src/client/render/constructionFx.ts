import { Graphics } from 'pixi.js';
import { LEVEL_PX } from '../../shared/world/constants';
import type { GameMap } from '../../shared/world/gameMap';
import type { View } from './chunkRenderer';

const MAX_DRAWN = 300;
const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  return ((Math.imul(x, 0xc2b2ae35) >>> 0) % 1000) / 1000;
};

/** 工事中の建物の動き: 立ちのぼる砂ぼこりと、ときどき光る溶接の火花(足場や基礎は、チャンクに描いてある) */
export class ConstructionFx {
  readonly g = new Graphics();

  constructor(private readonly map: GameMap) {}

  draw(view: View, nowMs: number): void {
    const g = this.g;
    g.clear();
    const m = this.map;
    if (view.zoom < 0.2 || m.sites.size === 0) return;
    const t = nowMs / 1000;
    let n = 0;
    for (const i of m.sites.keys()) {
      if (!m.construction.get(i) || !m.building.get(i)) {
        m.sites.delete(i); // 完成した・取り壊された
        continue;
      }
      if (n >= MAX_DRAWN) break;
      const u = i % m.size;
      const v = (i - u) / m.size;
      const wx = (u - v) * 32;
      const wy = (u + v) * 16 - m.levelAt(u, v) * LEVEL_PX + 16; // タイルの中心
      if (wx < view.left - 40 || wx > view.right + 40 || wy < view.top - 80 || wy > view.bottom + 40) continue;
      n++;
      const h = hash(i);
      for (let k = 0; k < 3; k++) {
        const age = (t * 0.45 + h + k / 3) % 1;
        const px = wx + (hash(i + k * 7) - 0.5) * 22 + Math.sin(t + k) * 3;
        const py = wy - 6 - age * 26;
        g.circle(px, py, 3 + age * 6).fill({ color: 0xcdbf9e, alpha: (1 - age) * 0.5 });
      }
      // 溶接の火花(0.15秒ほど光る)
      const ph = (t * 1.3 + h * 5) % 3;
      if (ph < 0.15) {
        const sx = wx + (hash(i + 3) - 0.5) * 16;
        const sy = wy - 20 - hash(i + 5) * 12;
        g.circle(sx, sy, 2.5).fill({ color: 0xfff3a0, alpha: 0.95 });
        for (let k = 0; k < 4; k++) g.circle(sx + (k - 1.5) * 4 * ph * 10, sy + (k % 2 ? 1 : -1) * 3 + ph * 20, 1).fill({ color: 0xffd24a, alpha: 0.8 });
      }
    }
  }
}
