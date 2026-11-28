import { Graphics, Texture, TilingSprite } from 'pixi.js';
import { LEVEL_PX } from '../../shared/world/constants';
import { DX8, DY8 } from '../../shared/world/directions';
import type { GameMap } from '../../shared/world/gameMap';
import { hasSub, subConn, subDepth } from '../../shared/world/subway';
import type { View } from './chunkRenderer';

/** Colour of each depth (1 = shallow ... 4 = deep) */
export const DEPTH_COLORS = [0x5fd3ff, 0x4aa3ff, 0x8a7cff, 0xc45cff] as const;
const MAX_TILES = 40_000;
/** The earth texture is this many pixels per repeat: 8 x 8 tiles (a tile is 64 x 32 px on the iso grid) */
const EARTH_W = 256;
const EARTH_H = 128;

/** A deterministic 0..1 number from two integers (so the same spot always gets the same earth) */
const hash01 = (x: number, y: number): number => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
};

/**
 * One repeat of the ground seen from below the surface: every tile of the iso grid is a diamond of dark earth with its own shade, grain and a few
 * stones. The pattern wraps (a diamond that runs off one edge comes back on the other), so it tiles without seams.
 */
function makeEarthTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = EARTH_W;
  c.height = EARTH_H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1c1612';
  ctx.fillRect(0, 0, EARTH_W, EARTH_H);
  for (let a = -10; a <= 18; a++) {
    for (let b = -18; b <= 10; b++) {
      const px = 32 * (a - b);
      const py = 16 * (a + b);
      if (px < -40 || px > EARTH_W + 40 || py < -24 || py > EARTH_H + 24) continue;
      // The same shade for the copies of one diamond that wrap around the edges
      const kx = ((px % EARTH_W) + EARTH_W) % EARTH_W;
      const ky = ((py % EARTH_H) + EARTH_H) % EARTH_H;
      const h = hash01(kx, ky);
      const l = 13 + h * 8;
      ctx.fillStyle = `hsl(${24 + h * 10}, ${16 + h * 8}%, ${l}%)`;
      ctx.beginPath();
      ctx.moveTo(px, py - 16);
      ctx.lineTo(px + 32, py);
      ctx.lineTo(px, py + 16);
      ctx.lineTo(px - 32, py);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.38)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Grain and stones inside the diamond
      for (let k = 0; k < 7; k++) {
        const rx = hash01(kx + k * 7, ky + 3) * 40 - 20;
        const ry = hash01(kx + 5, ky + k * 11) * 16 - 8;
        if (Math.abs(rx) / 32 + Math.abs(ry) / 16 > 0.82) continue;
        const stone = k < 2;
        ctx.fillStyle = stone ? `rgba(150,138,122,${0.18 + h * 0.12})` : 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.ellipse(px + rx, py + ry, stone ? 2.6 : 1.4, stone ? 1.5 : 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return Texture.from(c);
}

/**
 * The underground view, shown while a subway tool is selected: the surface sinks into darkness and what is drawn instead is the ground below it,
 * seen from above: dark earth, with the subway tunnels bored through it. A tunnel is a black bore with a coloured lining (the colour is the
 * depth) and bright rails. Tunnels are redrawn only when the subway layer changes (map.subwayVer).
 */
export class UndergroundView {
  /** Dark haze over the surface (a world-space rectangle that follows the view) */
  readonly shade = new Graphics();
  /** The earth: a repeating pattern that follows the view. It is a little see-through, so the surface is still faintly there */
  readonly earth: TilingSprite;
  /** The subway tunnels */
  readonly tracks = new Graphics();
  private ver = -1;
  private on = false;

  constructor(private readonly map: GameMap) {
    this.earth = new TilingSprite({ texture: makeEarthTexture(), width: 1, height: 1 });
    this.earth.alpha = 0.93;
    this.shade.visible = false;
    this.earth.visible = false;
    this.tracks.visible = false;
  }

  set active(v: boolean) {
    if (v === this.on) return;
    this.on = v;
    this.shade.visible = v;
    this.earth.visible = v;
    this.tracks.visible = v;
    this.ver = -1;
    if (!v) {
      this.shade.clear();
      this.tracks.clear();
    }
  }

  get active(): boolean {
    return this.on;
  }

  draw(view: View): void {
    if (!this.on) return;
    const w = view.right - view.left;
    const h = view.bottom - view.top;
    this.shade.clear().rect(view.left, view.top, w, h).fill({ color: 0x020409, alpha: 0.7 });
    // The earth's tile diamonds are centred 16 px below the tile's top vertex
    this.earth.position.set(view.left, view.top);
    this.earth.width = w;
    this.earth.height = h;
    this.earth.tilePosition.set(-view.left, 16 - view.top);
    if (this.ver === this.map.subwayVer) return;
    this.ver = this.map.subwayVer;
    const m = this.map;
    const tiles: { cx: number; cy: number; v: number }[] = [];
    m.subway.forEachNonZero((i, v) => {
      if (!hasSub(v) || tiles.length >= MAX_TILES) return;
      const x = i % m.size;
      const y = (i - x) / m.size;
      tiles.push({ cx: (x - y) * 32, cy: (x + y) * 16 - m.levelAt(x, y) * LEVEL_PX + 16, v });
    });
    const g = this.tracks.clear();
    const arms = (cx: number, cy: number, conn: number, fn: (ex: number, ey: number) => void) => {
      for (let d = 0; d < 8; d++) {
        if (!(conn & (1 << d))) continue;
        fn(cx + ((DX8[d] - DY8[d]) * 32) / 2, cy + ((DX8[d] + DY8[d]) * 16) / 2);
      }
    };
    // Pass 1: a lit patch of ground around each tunnel tile, then the lining and the black bore (so neighbours never paint over a finished rail)
    for (const { cx, cy, v } of tiles) {
      const color = DEPTH_COLORS[subDepth(v) - 1];
      g.poly([cx, cy - 16, cx + 32, cy, cx, cy + 16, cx - 32, cy])
        .fill({ color, alpha: 0.1 })
        .stroke({ width: 1, color, alpha: 0.35 });
    }
    for (const { cx, cy, v } of tiles) {
      const color = DEPTH_COLORS[subDepth(v) - 1];
      arms(cx, cy, subConn(v), (ex, ey) => g.moveTo(cx, cy).lineTo(ex, ey).stroke({ width: 19, color, alpha: 0.4 }));
    }
    for (const { cx, cy, v } of tiles) {
      arms(cx, cy, subConn(v), (ex, ey) => g.moveTo(cx, cy).lineTo(ex, ey).stroke({ width: 14, color: 0x07060a, alpha: 0.96 }));
      g.circle(cx, cy, 7).fill({ color: 0x07060a, alpha: 0.96 });
    }
    // Pass 2: the rails, bright, with a white dot at every tile
    for (const { cx, cy, v } of tiles) {
      const color = DEPTH_COLORS[subDepth(v) - 1];
      arms(cx, cy, subConn(v), (ex, ey) => g.moveTo(cx, cy).lineTo(ex, ey).stroke({ width: 4, color, alpha: 1 }));
      g.circle(cx, cy, 3.5).fill({ color: 0xffffff, alpha: 0.95 });
    }
  }
}
