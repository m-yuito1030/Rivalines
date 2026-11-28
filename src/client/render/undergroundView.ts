import { Graphics } from 'pixi.js';
import { LEVEL_PX } from '../../shared/world/constants';
import { DX, DY } from '../../shared/world/directions';
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
    this.shade
      .clear()
      .rect(view.left, view.top, view.right - view.left, view.bottom - view.top)
      .fill({ color: 0x05070d, alpha: 0.72 });
    if (this.ver === this.map.subwayVer) return;
    this.ver = this.map.subwayVer;
    const m = this.map;
    const g = this.tracks.clear();
    let n = 0;
    m.subway.forEachNonZero((i, v) => {
      if (!hasSub(v) || n++ >= MAX_TILES) return;
      const x = i % m.size;
      const y = (i - x) / m.size;
      const depth = subDepth(v);
      const color = DEPTH_COLORS[depth - 1];
      const cx = (x - y) * 32;
      const cy = (x + y) * 16 - m.levelAt(x, y) * LEVEL_PX + 16;
      g.poly([cx, cy - 16, cx + 32, cy, cx, cy + 16, cx - 32, cy])
        .fill({ color, alpha: 0.28 })
        .stroke({ width: 1, color, alpha: 0.6 });
      // Rails from the centre to the middle of each connected edge
      const conn = subConn(v);
      for (let d = 0; d < 4; d++) {
        if (!(conn & (1 << d))) continue;
        const ex = cx + ((DX[d] - DY[d]) * 32) / 2;
        const ey = cy + ((DX[d] + DY[d]) * 16) / 2;
        g.moveTo(cx, cy).lineTo(ex, ey).stroke({ width: 5, color, alpha: 0.95 });
      }
      g.circle(cx, cy, 4).fill({ color: 0xffffff, alpha: 0.9 });
    });
  }
}
