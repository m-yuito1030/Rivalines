import { Graphics } from 'pixi.js';
import { LEVEL_PX } from '../../shared/world/constants';
import { DX8, DY8 } from '../../shared/world/directions';
import type { GameMap } from '../../shared/world/gameMap';
import { hasSub, subConn, subDepth } from '../../shared/world/subway';
import type { View } from './chunkRenderer';

/** Colour of each depth (1 = shallow ... 4 = deep) */
export const DEPTH_COLORS = [0x5fd3ff, 0x4aa3ff, 0x8a7cff, 0xc45cff] as const;
const MAX_TILES = 40_000;

/**
 * The underground view, shown while a subway tool is selected: the surface is covered with a dark haze and the subway tracks are drawn
 * on top of it, coloured by depth. Tracks are redrawn only when the subway layer changes (map.subwayVer).
 */
export class UndergroundView {
  /** Dark haze over the surface (a world-space rectangle that follows the view) */
  readonly shade = new Graphics();
  /** The subway tracks */
  readonly tracks = new Graphics();
  private ver = -1;
  private on = false;

  constructor(private readonly map: GameMap) {
    this.shade.visible = false;
    this.tracks.visible = false;
  }

  set active(v: boolean) {
    if (v === this.on) return;
    this.on = v;
    this.shade.visible = v;
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
    // The surface is covered with a deep, slightly blue haze: it is still faintly there, but the underground is what the eye goes to
    this.shade
      .clear()
      .rect(view.left, view.top, view.right - view.left, view.bottom - view.top)
      .fill({ color: 0x030610, alpha: 0.86 });
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
    // Pass 1: the tile outlines and a soft glow under every track (so neighbours never paint over a finished rail)
    for (const { cx, cy, v } of tiles) {
      const color = DEPTH_COLORS[subDepth(v) - 1];
      g.poly([cx, cy - 16, cx + 32, cy, cx, cy + 16, cx - 32, cy])
        .fill({ color, alpha: 0.34 })
        .stroke({ width: 1.5, color, alpha: 0.85 });
      const conn = subConn(v);
      for (let d = 0; d < 8; d++) {
        if (!(conn & (1 << d))) continue;
        const ex = cx + ((DX8[d] - DY8[d]) * 32) / 2;
        const ey = cy + ((DX8[d] + DY8[d]) * 16) / 2;
        g.moveTo(cx, cy).lineTo(ex, ey).stroke({ width: 13, color, alpha: 0.22 });
        g.moveTo(cx, cy).lineTo(ex, ey).stroke({ width: 8, color: 0x000000, alpha: 0.7 });
      }
    }
    // Pass 2: the rails themselves, bright, and a white dot at every tile
    for (const { cx, cy, v } of tiles) {
      const color = DEPTH_COLORS[subDepth(v) - 1];
      const conn = subConn(v);
      for (let d = 0; d < 8; d++) {
        if (!(conn & (1 << d))) continue;
        const ex = cx + ((DX8[d] - DY8[d]) * 32) / 2;
        const ey = cy + ((DX8[d] + DY8[d]) * 16) / 2;
        g.moveTo(cx, cy).lineTo(ex, ey).stroke({ width: 5, color, alpha: 1 });
      }
      g.circle(cx, cy, 4).fill({ color: 0xffffff, alpha: 0.95 });
    }
  }
}
