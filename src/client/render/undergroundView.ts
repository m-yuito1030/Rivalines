import { ColorMatrixFilter, type Container, Graphics } from 'pixi.js';
import { LEVEL_PX } from '../../shared/world/constants';
import { DX8, DY8 } from '../../shared/world/directions';
import type { GameMap } from '../../shared/world/gameMap';
import { hasSub, subConn, subDepth } from '../../shared/world/subway';
import type { View } from './chunkRenderer';

/** Colour of each depth (1 = shallow ... 4 = deep) */
export const DEPTH_COLORS = [0x5fd3ff, 0x4aa3ff, 0x8a7cff, 0xc45cff] as const;
const MAX_TILES = 40_000;
/** How strong the surface still shows in the underground view (0 = gone, 1 = as usual) */
const GHOST_ALPHA = 0.42;

/**
 * The underground view (like the underground mode of a city builder): the surface turns into a pale, see-through grey ghost, so you can still tell
 * where the streets and buildings are, and the subway (tunnels, stations, depots, trains) is drawn clearly in colour on top of it.
 * It is on while a subway tool is selected, while a rail route is being made, or when the player switches it on with the button (PageDown / PageUp).
 * The tunnels are redrawn only when the subway layer changes (map.subwayVer).
 */
export class UndergroundView {
  /** A flat, cool grey behind the see-through surface (so the ghost reads as pale, not black) */
  readonly backdrop = new Graphics();
  /** The subway tunnels */
  readonly tracks = new Graphics();
  private ver = -1;
  private on = false;
  private readonly ghostFilter = new ColorMatrixFilter();

  /** ghost: the container that draws the surface (it is faded and drained of colour while the view is on) */
  constructor(
    private readonly map: GameMap,
    private readonly ghost: Container,
  ) {
    this.backdrop.visible = false;
    this.tracks.visible = false;
    // Grey out the surface: a desaturated, slightly darkened and blue-tinted copy
    this.ghostFilter.desaturate();
    this.ghostFilter.brightness(0.85, true);
  }

  set active(v: boolean) {
    if (v === this.on) return;
    this.on = v;
    this.backdrop.visible = v;
    this.tracks.visible = v;
    this.ghost.filters = v ? [this.ghostFilter] : null;
    this.ghost.alpha = v ? GHOST_ALPHA : 1;
    this.ver = -1;
    if (!v) {
      this.backdrop.clear();
      this.tracks.clear();
    }
  }

  get active(): boolean {
    return this.on;
  }

  draw(view: View): void {
    if (!this.on) return;
    this.backdrop
      .clear()
      .rect(view.left, view.top, view.right - view.left, view.bottom - view.top)
      .fill(0x1b2a3a);
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
    // The footprint of each tunnel tile on the ground, then a white edge and the coloured tube (the colour is the depth), then a dot at each tile
    for (const { cx, cy, v } of tiles) {
      const color = DEPTH_COLORS[subDepth(v) - 1];
      g.poly([cx, cy - 16, cx + 32, cy, cx, cy + 16, cx - 32, cy])
        .fill({ color, alpha: 0.16 })
        .stroke({ width: 1, color, alpha: 0.5 });
    }
    for (const { cx, cy, v } of tiles) {
      arms(cx, cy, subConn(v), (ex, ey) => g.moveTo(cx, cy).lineTo(ex, ey).stroke({ width: 15, color: 0x0b1a2a, alpha: 0.9 }));
      g.circle(cx, cy, 7.5).fill({ color: 0x0b1a2a, alpha: 0.9 });
    }
    for (const { cx, cy, v } of tiles) {
      const color = DEPTH_COLORS[subDepth(v) - 1];
      arms(cx, cy, subConn(v), (ex, ey) => g.moveTo(cx, cy).lineTo(ex, ey).stroke({ width: 10, color, alpha: 1 }));
      g.circle(cx, cy, 5).fill({ color, alpha: 1 });
    }
    for (const { cx, cy } of tiles) g.circle(cx, cy, 2.2).fill({ color: 0xffffff, alpha: 0.95 });
  }
}
