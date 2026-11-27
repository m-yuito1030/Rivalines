import { FrontOverlay } from './frontOverlay';
import { StationSprites, stationSpritesReady } from './stationSprites';
import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import { AIR_ALT, CAR_LEN, type Transit, WAIT_CAP } from '../../shared/sim/network/transit';
import { modelOf } from '../../shared/data/models';
import { LEVEL_PX } from '../../shared/world/constants';
import type { GameMap } from '../../shared/world/gameMap';
import { CONN, DX8, DY8 } from '../../shared/world/directions';
import { designParts, isKitDesign } from '../../shared/world/stations';
import type { View } from './chunkRenderer';
import { AIR_SCALE, BUS_SCALE, setVehicleSmoothing, trainFrame, vehicleFrame } from './vehicleSprites';
import { type Facility, isSpriteFacility } from '../../shared/world/facilities';

const shade = (c: number, k: number) => {
  const r = Math.min(255, ((c >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((c >> 8) & 255) * k) | 0;
  const b = Math.min(255, (c & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
};

/** The layer that draws stops, stations, vehicles, trains, and aircraft (world coordinates, above the chunks) */
/** Unit vectors of the 8 drawing directions */
const S2 = Math.SQRT1_2;
const DIRS: [number, number][] = [
  [1, 0],
  [S2, S2],
  [0, 1],
  [-S2, S2],
  [-1, 0],
  [-S2, -S2],
  [0, -1],
  [S2, -S2],
];
const dirIndex = (dx: number, dy: number) => (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) & 7;

/**
 * The layer that draws stops, stations, vehicles, trains, and aircraft (world coordinates, above the chunks).
 * Static things such as stations and signals (infra) are redrawn only at 4 Hz or when the view leaves the drawn area,
 * and vehicles are drawn as sprites of textures built once per "model, color, direction" (polygons are not rebuilt every frame).
 */
export class TransitLayer {
  readonly g = new Container();
  private infra = new Graphics();
  private veh = new Container();
  private air = new Graphics();
  /** The selected vehicle's path (arrows) */
  private routeG = new Graphics();
  /** Ground shadows of aircraft (drawn below vehicles) */
  private shad = new Graphics();
  /** Drawing target of box() and the like (normally infra. Temporarily swapped while building a vehicle texture) */
  private gfx: Graphics = this.infra;
  private sprites: Sprite[] = [];
  private spritesUsed = 0;
  /** Town buildings in front of stations and depots (redrawn over the station so the front/back order is right) */
  private front: FrontOverlay;
  /** Stations of the new design (sprites). The ground is below trains, roofs and the like above trains */
  private stations = new StationSprites();
  /** Station roofs and buildings (drawn above vehicles, so trains appear to go under the roof) */
  private roofG = new Graphics();
  private texCache = new Map<string, { tex: Texture; ax: number; ay: number }>();
  private infraView: View | null = null;
  private infraAt = 0;
  /** Seconds since the last redraw (for the animation of people appearing and disappearing) */
  private shownDt = 0;
  private infraVer = -1;
  private infraKey = '';
  /** For each stop, the number of people currently drawn (they increase and decrease smoothly to follow the waiting count) */
  private shown = new Map<number, number>();
  private shownAt = 0;

  constructor(
    private map: GameMap,
    private transit: Transit,
    private renderer: Renderer | null = null,
  ) {
    this.front = new FrontOverlay(map, transit);
    this.veh.sortableChildren = true;
    this.g.addChild(this.stations.ground, this.infra, this.shad, this.veh, this.roofG, this.stations.objects, this.front.container, this.air, this.routeG);
  }

  /**
   * Draw the selected vehicle's path joined with arrows. legs[0] is the leg it is heading for now (thick), the rest are planned (thin). stops are the tiles of the stopping stops. null clears it.
   */
  setRoute(legs: number[][] | null, color = 0xffd24a, stops: number[] = [], reserved: number[] = []): void {
    const g = this.routeG;
    g.clear();
    if (!legs) return;
    const s = this.map.size;
    const P = (i: number): [number, number] => {
      const x = i % s;
      const y = Math.floor(i / s);
      return [this.wx(x + 0.5, y + 0.5), this.wy(x + 0.5, y + 0.5, this.map.surfaceLevel(x, y), 3)];
    };
    // Reserved blocks (the range other trains cannot enter) as a green band
    if (reserved.length > 1) {
      const rp: number[] = [];
      for (const i of reserved) {
        const [x, y] = P(i);
        rp.push(x, y);
      }
      g.poly(rp, false).stroke({ width: 11, color: 0x35d36a, alpha: 0.45, join: 'round', cap: 'round' });
    }
    legs.forEach((leg, li) => {
      if (leg.length < 2) return;
      const pts = leg.map(P);
      const main = li === 0;
      const poly: number[] = [];
      for (const [x, y] of pts) poly.push(x, y);
      g.poly(poly, false).stroke({ width: main ? 8 : 6, color: 0x000000, alpha: 0.35, join: 'round', cap: 'round' });
      g.poly(poly, false).stroke({ width: main ? 4.5 : 3, color, alpha: main ? 0.95 : 0.7, join: 'round', cap: 'round' });
      // Arrowheads in the direction of travel (every few tiles)
      for (let i = 2; i < pts.length - 1; i += 3) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i + 1];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L;
        const uy = dy / L;
        const [cx, cy] = pts[i];
        const a = main ? 8 : 6;
        g.poly([cx + ux * a, cy + uy * a, cx - ux * a * 0.6 - uy * a * 0.8, cy - uy * a * 0.6 + ux * a * 0.8, cx - ux * a * 0.6 + uy * a * 0.8, cy - uy * a * 0.6 - ux * a * 0.8])
          .fill({ color, alpha: main ? 1 : 0.8 })
          .stroke({ width: 1.5, color: 0x000000, alpha: 0.5 });
      }
    });
    // Markers for the stopping stops
    stops.forEach((idx, k) => {
      const [x, y] = P(idx);
      g.circle(x, y, 7).fill({ color: 0xffffff, alpha: 0.95 }).stroke({ width: 2, color: 0x000000, alpha: 0.7 });
      void k;
    });
  }

  /** Continuous tile coordinates (U,V) + height -> world coordinates */
  private wx = (u: number, v: number) => (u - v) * 32;
  private wy = (u: number, v: number, lvl: number, z = 0) => (u + v) * 16 - lvl * LEVEL_PX - z;

  /** An oriented box. (cu,cv) = centre, (ax,ay) = unit vector of the long axis, len/wid = ratios in tiles, h = height in px, z0 = height of the bottom */
  private box(cu: number, cv: number, lvl: number, ax: number, ay: number, len: number, wid: number, h: number, color: number, z0 = 0, alpha = 1): void {
    const g = this.gfx;
    const bx = -ay;
    const by = ax;
    const pts = [
      [cu + (ax * len) / 2 + (bx * wid) / 2, cv + (ay * len) / 2 + (by * wid) / 2],
      [cu + (ax * len) / 2 - (bx * wid) / 2, cv + (ay * len) / 2 - (by * wid) / 2],
      [cu - (ax * len) / 2 - (bx * wid) / 2, cv - (ay * len) / 2 - (by * wid) / 2],
      [cu - (ax * len) / 2 + (bx * wid) / 2, cv - (ay * len) / 2 + (by * wid) / 2],
    ];
    for (let i = 0; i < 4; i++) {
      const [u0, v0] = pts[i];
      const [u1, v1] = pts[(i + 1) % 4];
      const mu = (u0 + u1) / 2 - cu;
      const mv = (v0 + v1) / 2 - cv;
      if (mu + mv <= 0) continue;
      g.poly([
        this.wx(u0, v0),
        this.wy(u0, v0, lvl, z0),
        this.wx(u1, v1),
        this.wy(u1, v1, lvl, z0),
        this.wx(u1, v1),
        this.wy(u1, v1, lvl, z0 + h),
        this.wx(u0, v0),
        this.wy(u0, v0, lvl, z0 + h),
      ]).fill({ color: shade(color, mu > mv ? 0.8 : 0.6), alpha });
    }
    g.poly(pts.flatMap(([u, v]) => [this.wx(u, v), this.wy(u, v, lvl, z0 + h)])).fill({ color, alpha });
  }

  /** Ground shadow (a flat box shifted toward +u+v of the vehicle) */
  private shadow(cu: number, cv: number, lvl: number, ax: number, ay: number, len: number, wid: number): void {
    this.box(cu + 0.05, cv + 0.05, lvl, ax, ay, len + 0.04, wid + 0.06, 0.2, 0x000000, 0, 0.28);
  }

  /** Wheels (two pairs, front and back, along the axis of travel) */
  private wheels(cu: number, cv: number, lvl: number, ax: number, ay: number, len: number, wid: number): void {
    const bx = -ay;
    const by = ax;
    for (const f of [-0.32, 0.32]) {
      for (const sd of [-0.5, 0.5]) {
        this.box(cu + ax * len * f + bx * wid * sd, cv + ay * len * f + by * wid * sd, lvl, ax, ay, 0.1, 0.05, 3.2, 0x1e1f22, 0);
      }
    }
  }

  /** Waiting count -> the target number of people to draw (proportional to the waiting count. The cap is the size of the facility) */
  private crowdTarget(s: import('../../shared/sim/network/transit').Stop, cap: number, perPerson: number): number {
    return Math.min(cap, Math.ceil(s.waiting / perPerson));
  }

  /** The number of people drawn now (they rise or fall toward the target by about 6 per second, so you can see people arriving and clearing) */
  private crowdShown(s: import('../../shared/sim/network/transit').Stop, target: number, dtSec: number): number {
    const cur = this.shown.get(s.id) ?? target;
    const step = Math.max(0.01, dtSec * 6);
    const next = cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
    this.shown.set(s.id, next);
    return Math.round(next);
  }

  /** One person (body + head). The color is decided by the index */
  private person(u: number, v: number, lvl: number, z: number, idx: number, salt: number): void {
    const colors = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0x34495e, 0xe67e22, 0xecf0f1];
    const c = colors[((idx * 2654435761 + salt * 40503) >>> 8) % colors.length];
    this.box(u, v, lvl, 1, 0, 0.07, 0.07, 7.5, c, z);
    this.box(u, v, lvl, 1, 0, 0.056, 0.056, 3.2, 0xf1c9a5, z + 7.5);
  }

  /** Draw large facilities (stadium, amusement park, mall, park) with boxes and shapes */
  private drawFacility(f: Facility, lvl: number, selected: boolean): void {
    const g = this.gfx;
    const { x0, y0, w, h } = f;
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    const sel = selected ? 0xff9a2f : 0;
    const P = (u: number, v: number, z = 0): [number, number] => [this.wx(u, v), this.wy(u, v, lvl, z)];
    if (f.type === 'stadium') {
      const team = sel || 0x2f7dd1;
      this.box(cx, cy, lvl, 1, 0, w, h, 1, 0xb9b5ab); // plaza
      // Drawn in the order: back walls (north, west) -> the ground -> front walls (south, east)
      this.box(cx, y0 + 0.3, lvl, 1, 0, w - 0.2, 0.6, 15, 0xd9d6cf);
      this.box(x0 + 0.3, cy, lvl, 0, 1, h - 1.2, 0.6, 15, 0xd9d6cf);
      this.box(cx, cy, lvl, 1, 0, w - 1.7, h - 1.7, 2, 0x45a35c, 1); // pitch
      this.box(cx, cy, lvl, 1, 0, w - 1.7, 0.05, 2.3, 0xf4f4f4, 1);
      this.box(cx, cy, lvl, 1, 0, 0.9, 0.9, 2.3, 0x3d9150, 1);
      this.box(cx, y0 + h - 0.3, lvl, 1, 0, w - 0.2, 0.6, 15, 0xe4e1da);
      this.box(x0 + w - 0.3, cy, lvl, 0, 1, h - 1.2, 0.6, 15, 0xe4e1da);
      this.box(cx, y0 + h - 0.3, lvl, 1, 0, w - 0.2, 0.62, 2, team, 15);
      this.box(x0 + w - 0.3, cy, lvl, 0, 1, h - 1.2, 0.62, 2, team, 15);
      for (const [u, v] of [
        [x0 + 0.25, y0 + 0.25],
        [x0 + w - 0.25, y0 + 0.25],
        [x0 + 0.25, y0 + h - 0.25],
        [x0 + w - 0.25, y0 + h - 0.25],
      ]) {
        this.box(u, v, lvl, 1, 0, 0.1, 0.1, 34, 0x5a5f68);
        this.box(u, v, lvl, 1, 0, 0.3, 0.3, 3, 0xfff3b0, 34);
      }
    } else if (f.type === 'amusement') {
      this.box(cx, cy, lvl, 1, 0, w, h, 1, 0xe6d5c3); // plaza
      this.box(cx, y0 + 0.5, lvl, 1, 0, w - 0.4, 0.12, 1.5, 0xc9b8a6);
      // Tents (from the back)
      const tents: [number, number, number][] = [
        [x0 + 0.9, y0 + 0.9, 0xe74c3c],
        [x0 + w - 1.0, y0 + 0.9, 0x3498db],
        [x0 + 0.9, y0 + h - 1.0, 0xf1c40f],
      ];
      for (const [u, v, c] of tents) {
        this.box(u, v, lvl, 1, 0, 0.9, 0.9, 9, 0xf3efe6);
        this.box(u, v, lvl, 1, 0, 1.0, 1.0, 3, c, 9);
        this.box(u, v, lvl, 1, 0, 0.5, 0.5, 4, shade(c, 1.15), 12);
      }
      // Carousel
      this.box(x0 + w - 1.2, y0 + h - 1.2, lvl, 1, 0, 1.3, 1.3, 2, 0xd1b48c);
      this.box(x0 + w - 1.2, y0 + h - 1.2, lvl, 1, 0, 0.12, 0.12, 12, 0xf5f0e6, 2);
      this.box(x0 + w - 1.2, y0 + h - 1.2, lvl, 1, 0, 1.3, 1.3, 2, 0xe84393, 14);
      // Ferris wheel: a big ring on screen (centre raised)
      const [wx, wy] = P(cx, y0 + 1.7, 0);
      const R = 30;
      const hubY = wy - 40;
      g.moveTo(wx - 14, wy)
        .lineTo(wx, hubY)
        .lineTo(wx + 14, wy)
        .stroke({ width: 3, color: 0x6b7280 });
      g.circle(wx, hubY, R).stroke({ width: 3, color: sel || 0xe74c3c });
      g.circle(wx, hubY, R * 0.5).stroke({ width: 1.5, color: 0xf1f5f9 });
      for (let a = 0; a < 6; a++) {
        const ang = (a * Math.PI) / 3;
        g.moveTo(wx, hubY)
          .lineTo(wx + Math.cos(ang) * R, hubY + Math.sin(ang) * R)
          .stroke({ width: 1.5, color: 0xf1f5f9 });
        g.circle(wx + Math.cos(ang) * R, hubY + Math.sin(ang) * R, 3.4).fill(([0xf1c40f, 0x3498db, 0xe74c3c, 0x2ecc71, 0x9b59b6, 0xe67e22] as number[])[a]);
      }
      g.circle(wx, hubY, 3.5).fill(0x374151);
    } else if (f.type === 'mall') {
      this.box(cx, cy, lvl, 1, 0, w, h, 0.8, 0x5a5d64); // parking lot
      for (let i = 0; i < w - 0.5; i += 0.6) this.box(x0 + 0.4 + i, y0 + h - 0.55, lvl, 0, 1, 0.5, 0.03, 1, 0xe9e9e9, 0.8);
      const cars = [0xe74c3c, 0x3498db, 0xecf0f1, 0xf1c40f, 0x2ecc71];
      for (let i = 0; i < 5; i++) this.box(x0 + 0.7 + i * 0.7, y0 + h - 0.3, lvl, 1, 0, 0.4, 0.2, 3, cars[i % 5], 0.8);
      this.box(cx, y0 + 1.1, lvl, 1, 0, w - 0.4, 1.9, 22, 0xe9e1d1); // main building
      this.box(cx, y0 + 1.1, lvl, 1, 0, w - 0.3, 2.0, 2, 0x8d8f96, 22);
      this.box(cx, y0 + 2.05, lvl, 1, 0, w - 0.5, 0.06, 6, sel || 0xd9514e, 14); // sign band
      this.box(cx, y0 + 2.08, lvl, 1, 0, 1.4, 0.06, 10, 0x7fb7e6, 1); // entrance glass
    } else if (f.type === 'department') {
      this.box(cx, cy, lvl, 1, 0, w, h, 0.8, 0xbdb7ab); // site
      this.box(cx, cy, lvl, 1, 0, w - 0.3, h - 0.3, 12, 0xe8dcc6); // low-rise part (sales floor)
      this.box(cx, cy, lvl, 1, 0, w - 0.2, h - 0.2, 2, 0x8d8f96, 12);
      this.box(cx, cy, lvl, 1, 0, w - 1.1, h - 1.1, 22, 0xd5c3a5, 14); // upper floors
      for (const z of [18, 24, 30]) this.box(cx, cy, lvl, 1, 0, w - 1.05, h - 1.05, 2.2, 0x6a8fb5, z);
      this.box(cx, cy, lvl, 1, 0, w - 1.0, h - 1.0, 2, sel || 0xc0392b, 36); // rooftop band
      this.box(cx, y0 + h - 0.2, lvl, 1, 0, w - 0.8, 0.3, 3, sel || 0xc0392b, 9); // entrance canopy
      this.box(cx, y0 + h - 0.17, lvl, 1, 0, 1.2, 0.06, 8, 0x7fb7e6, 0.8); // entrance glass
    } else if (f.type === 'hotel') {
      this.box(cx, cy, lvl, 1, 0, w, h, 0.8, 0x72c05c); // garden
      this.box(cx, cy, lvl, 1, 0, w - 0.9, h - 0.9, 40, 0xcfd8e6); // guest-room block
      for (const z of [6, 12, 18, 24, 30]) this.box(cx, cy, lvl, 1, 0, w - 0.85, h - 0.85, 2.6, 0x3b5f86, z);
      this.box(cx, cy, lvl, 1, 0, w - 0.8, h - 0.8, 3, sel || 0x8e44ad, 40);
      this.box(cx, y0 + h - 0.3, lvl, 1, 0, 1.4, 0.4, 3, sel || 0x8e44ad, 8); // porte-cochere
    } else {
      this.box(cx, cy, lvl, 1, 0, w, h, 0.8, 0x72c05c); // lawn
      this.box(cx, cy, lvl, 1, 0, w, 0.35, 1, 0xdcd2b8, 0.8); // garden path
      const [px, py] = P(x0 + w - 0.9, y0 + h - 0.9, 0);
      g.ellipse(px, py, 20, 10).fill(0x6cb6e3);
      g.ellipse(px, py, 20, 10).stroke({ width: 1.5, color: 0xdcd2b8 });
      for (const [u, v] of [
        [x0 + 0.5, y0 + 0.5],
        [x0 + 1.5, y0 + 0.4],
        [x0 + 0.5, y0 + 1.7],
        [x0 + w - 0.5, y0 + 0.6],
        [x0 + 1.8, y0 + h - 0.4],
      ]) {
        const [tx, ty] = P(u, v, 0);
        this.box(u, v, lvl, 1, 0, 0.08, 0.08, 8, 0x7a5a3a);
        g.circle(tx, ty - 13, 9).fill(0x3f9a58);
        g.circle(tx - 3, ty - 16, 5).fill(0x58b36e);
      }
    }
  }

  /** Waypoint: a small sign beside the track (just a marker for passing through) */
  private drawWaypoint(x: number, y: number, lvl: number, col: number): void {
    this.box(x + 0.84, y + 0.16, lvl, 1, 0, 0.05, 0.05, 14, 0x3a3d44);
    this.box(x + 0.84, y + 0.16, lvl, 1, 0, 0.22, 0.22, 4, col === 0xff9a2f ? col : 0x6f8aa6, 14);
  }

  /**
   * A station (group of platforms). Each platform track has a line; between tracks is an island platform, and the two outer sides are side platforms.
   * Design (0..99) = 5 roofs x 5 color schemes x 4 station buildings (designParts in world/stations.ts)
   */
  private drawStation(s: import('../../shared/sim/network/transit').Stop, lvl: number, selected: boolean): void {
    const m = this.map;
    let info = s.station;
    if (!info) {
      const alongX = !!(m.rail.get(s.idx) & (CONN(1) | CONN(3)));
      info = { axis: alongX ? 1 : 0, len: 1, tracks: 1, design: 6, x0: s.x, y0: s.y };
    }
    const { axis, len, tracks, x0, y0 } = info;
    // New designs (100+) are sprites. If not loaded, substitute the earlier drawing method
    const kitMode = isKitDesign(info.design) && stationSpritesReady();
    const { roof, palette, building } = designParts(isKitDesign(info.design) ? info.design % 100 : info.design);
    if (kitMode) this.stations.add(info, lvl, selected);
    const col = selected ? 0xff9a2f : palette.roof;
    const ax = axis === 1 ? 1 : 0;
    const ay = axis === 1 ? 0 : 1;
    // Position i along the long axis (0..len), position w across the width (0..tracks; the centre of track t is t+0.5) -> tile coordinates
    const U = (i: number, w: number) => (axis === 1 ? x0 + i : x0 + w);
    const V = (i: number, w: number) => (axis === 1 ? y0 + w : y0 + i);
    const slabH = kitMode ? 3 : roof === 0 ? 3 : 5;
    // Where the roof is supported (0.34 from the track centre for outer platforms, between tracks for island platforms)
    const platW = (w: number) => (w === 0 ? 0.16 : w === tracks ? tracks - 0.16 : w);
    for (let w = 0; w <= tracks && !kitMode; w++) {
      const outer = w === 0 || w === tracks;
      for (let i = 0; i < len; i++) {
        this.box(U(i + 0.5, platW(w)), V(i + 0.5, platW(w)), lvl, ax, ay, 1, outer ? 0.16 : 0.5, slabH, palette.slab);
        if (roof !== 0) {
          // Edge on the track side (yellow line)
          const es = outer ? [w === 0 ? 0.23 : tracks - 0.23] : [w - 0.2, w + 0.2];
          for (const e of es) this.box(U(i + 0.5, e), V(i + 0.5, e), lvl, ax, ay, 1, 0.025, slabH + 0.4, 0xe9c33a);
        }
      }
    }
    // People waiting on the platform: increase and decrease with the waiting count (scattered along the length by the golden ratio)
    if (this.shownDt >= 0 && s.waiting >= 0) {
      const n = this.crowdShown(s, this.crowdTarget(s, Math.max(6, len * (tracks + 1) * 3), 6), this.shownDt);
      for (let i = 0; i < n; i++) {
        const w = i % (tracks + 1);
        const along = ((i * 0.6180339887) % 1) * Math.max(0.3, len - 0.4) + 0.2;
        const jitter = (((i * 7919 + s.id * 31) % 11) - 5) * 0.009;
        this.person(U(along, platW(w) + jitter), V(along, platW(w) + jitter), lvl, slabH, i, s.id);
      }
    }
    if (kitMode) return; // for sprite stations the roof and station building are part of the tile art
    // From here, roofs and station buildings: drawn on the layer above vehicles
    const gfxBefore = this.gfx;
    this.gfx = this.roofG;
    const mid = len / 2;
    const pillar = (i: number, w: number, h: number) => this.box(U(i, platW(w)), V(i, platW(w)), lvl, ax, ay, 0.05, 0.05, h, palette.post, slabH);
    if (roof === 0) {
      // No roof: a small roofed waiting shelter on the outer platforms
      this.box(U(mid, 0.16), V(mid, 0.16), lvl, ax, ay, 0.7, 0.16, 3, 0x8b6f4e, slabH + 8);
      this.box(U(mid, 0.16), V(mid, 0.16), lvl, ax, ay, 0.7, 0.2, 1.2, col, slabH + 11);
    } else if (roof === 1 || roof === 2) {
      // Partial roof (central 60%) / full-length roof: an eave and posts on each platform
      const from = roof === 1 ? Math.max(0, Math.floor(len * 0.2)) : 0;
      const to = roof === 1 ? Math.max(from + 1, Math.ceil(len * 0.8)) : len;
      for (let w = 0; w <= tracks; w++) {
        const outer = w === 0 || w === tracks;
        for (let i = from; i < to; i++) if ((i - from) % 3 === 0) pillar(i + 0.5, w, 15);
        this.box(U((from + to) / 2, platW(w)), V((from + to) / 2, platW(w)), lvl, ax, ay, to - from, outer ? 0.3 : 0.62, 1.6, col, slabH + 15);
        if (roof === 2) this.box(U((from + to) / 2, platW(w)), V((from + to) / 2, platW(w)), lvl, ax, ay, to - from, outer ? 0.34 : 0.66, 0.8, palette.post, slabH + 14.2);
      }
    } else if (roof === 3) {
      // Big glass roof: a translucent roof and beams over everything
      for (let i = 0; i <= len; i += 3) for (let w = 0; w <= tracks; w++) pillar(Math.min(i + 0.5, len - 0.5), w, 20);
      this.box(U(mid, tracks / 2), V(mid, tracks / 2), lvl, ax, ay, len, tracks + 0.1, 2, 0x9ccbe6, slabH + 20, 0.5);
      this.box(U(mid, tracks / 2), V(mid, tracks / 2), lvl, ax, ay, len, 0.12, 3, col, slabH + 22);
    } else {
      // Arched roof: a rounded roof of stacked tiers covers everything
      for (let i = 0; i <= len; i += 4) for (const w of [0, tracks]) pillar(Math.min(i + 0.5, len - 0.5), w, 17);
      const W = tracks + 0.1;
      this.box(U(mid, tracks / 2), V(mid, tracks / 2), lvl, ax, ay, len, W, 1.6, col, slabH + 17, 0.72);
      this.box(U(mid, tracks / 2), V(mid, tracks / 2), lvl, ax, ay, len, W * 0.75, 1.6, shade(col, 1.08), slabH + 18.6, 0.72);
      this.box(U(mid, tracks / 2), V(mid, tracks / 2), lvl, ax, ay, len, W * 0.45, 1.6, shade(col, 1.16), slabH + 20.2, 0.72);
    }
    // Station building (outside the platforms, set toward the end)
    if (building > 0) {
      const bl = building === 1 ? 0.5 : building === 2 ? Math.min(2, len) : Math.min(3.2, len);
      const bw = building === 1 ? 0.22 : building === 2 ? 0.28 : 0.38;
      const bh = building === 1 ? 9 : building === 2 ? 12 : 16;
      const bi = bl / 2 + 0.05;
      this.box(U(bi, -0.15), V(bi, -0.15), lvl, ax, ay, bl, bw, bh, palette.wall, 0);
      this.box(U(bi, -0.15), V(bi, -0.15), lvl, ax, ay, bl + 0.1, bw + 0.05, 2, palette.bldRoof, bh);
      if (building === 3) this.box(U(bi, -0.15), V(bi, -0.15), lvl, ax, ay, 0.16, 0.16, 8, shade(palette.wall, 0.9), bh + 2); // clock tower
    }
    this.gfx = gfxBefore;
  }

  draw(view: View, highlight: Set<number>): void {
    this.air.clear();
    this.shad.clear();
    setVehicleSmoothing(view.zoom);
    if (view.zoom < 0.12) {
      this.infra.clear();
      this.roofG.clear();
      this.infraView = null;
      this.hideSprites(0);
      this.front.clear();
      this.stations.clear();
      return;
    }
    // The static part is redrawn only when the view leaves the drawn area, the structure changes, the selection changes, or 0.25 s passes
    const now = performance.now();
    const key = [...highlight].join(',');
    const iv = this.infraView;
    const inside = iv && view.zoom === iv.zoom && view.left >= iv.left && view.right <= iv.right && view.top >= iv.top && view.bottom <= iv.bottom;
    if (!inside || now - this.infraAt > 250 || this.infraVer !== this.transit.version || key !== this.infraKey) {
      const w = view.right - view.left;
      const h = view.bottom - view.top;
      const wide: View = { left: view.left - w * 0.5, right: view.right + w * 0.5, top: view.top - h * 0.5, bottom: view.bottom + h * 0.5, zoom: view.zoom };
      this.shownDt = Math.min(1, (now - this.shownAt) / 1000);
      this.shownAt = now;
      this.infra.clear();
      this.roofG.clear();
      this.gfx = this.infra;
      this.drawInfra(wide, highlight);
      this.front.computeStatic(wide);
      this.infraView = wide;
      this.infraAt = now;
      this.infraVer = this.transit.version;
      this.infraKey = key;
    }
    this.drawVehicles(view);
    this.front.render();
  }

  private drawInfra(view: View, highlight: Set<number>): void {
    const m = this.map;
    const margin = 160;
    const inView = (wx: number, wy: number) => wx > view.left - margin && wx < view.right + margin && wy > view.top - margin * 2 && wy < view.bottom + margin;
    this.stations.begin();
    for (const s of this.transit.stops.values()) {
      const wx = this.wx(s.x + 0.5, s.y + 0.5);
      const wy = this.wy(s.x + 0.5, s.y + 0.5, 0);
      if (!inView(wx, wy)) continue;
      const lvl = m.surfaceLevel(s.x, s.y);
      if (s.waiting >= 1) {
        // Waiting-count bar: green -> yellow -> red
        const r = Math.min(1, s.waiting / (WAIT_CAP[s.kind] * 0.5));
        this.box(s.x + 0.14, s.y + 0.86, lvl, 1, 0, 0.1, 0.1, 4 + r * 34, r < 0.34 ? 0x4bd36a : r < 0.67 ? 0xf2c230 : 0xe5483a);
      }
      const sel = highlight.has(s.id);
      const col = sel ? 0xff9a2f : 0x2f7dd1;
      if (s.kind === 'road') {
        this.box(s.x + 0.86, s.y + 0.14, lvl, 1, 0, 0.12, 0.12, 22, col);
        this.box(s.x + 0.86, s.y + 0.14, lvl, 1, 0, 0.3, 0.3, 4, 0xffffff);
        // People waiting at a bus stop (lined up on the sidewalk)
        const n = this.crowdShown(s, this.crowdTarget(s, 10, 4), this.shownDt);
        for (let i = 0; i < n; i++) this.person(s.x + 0.52 + (i % 5) * 0.085, s.y + 0.08 + Math.floor(i / 5) * 0.1, lvl, 0, i, s.id);
      } else if (s.kind === 'rail') {
        if (s.waypoint) this.drawWaypoint(s.x, s.y, lvl, col);
        else this.drawStation(s, lvl, sel);
      } else {
        this.box(s.x + 0.5, s.y + 0.5, lvl, 1, 0, 0.1, 0.1, 40, col, 24);
        // People waiting in front of an airport terminal
        const n = this.crowdShown(s, this.crowdTarget(s, 14, 12), this.shownDt);
        for (let i = 0; i < n; i++) this.person(s.x + 0.12 + (i % 7) * 0.11, s.y + 0.86 + Math.floor(i / 7) * 0.08, lvl, 0, i, s.id);
      }
    }

    this.stations.end();

    // Large facilities
    // Draw from the back (so the plaza or garden of a front facility does not overlap the building of a facility behind it. In order of smallest x+y of the front corner)
    const visFacs: Facility[] = [];
    for (const f of m.facilities) {
      if (isSpriteFacility(f)) continue; // drawn as sprites (on the chunk side)
      const cx = f.x0 + f.w / 2;
      const cy = f.y0 + f.h / 2;
      if (!inView(this.wx(cx, cy), this.wy(cx, cy, 0))) continue;
      visFacs.push(f);
    }
    visFacs.sort((a, b) => a.x0 + a.w + a.y0 + a.h - (b.x0 + b.w + b.y0 + b.h));
    for (const f of visFacs) this.drawFacility(f, m.levelAt(f.x0, f.y0), highlight.has(-100000 - f.id));

    // Depots: draw a garage beside the road/rail/airport tile
    for (const d of this.transit.depots.values()) {
      if (!inView(this.wx(d.x + 0.5, d.y + 0.5), this.wy(d.x + 0.5, d.y + 0.5, 0))) continue;
      const lvl = m.surfaceLevel(d.x, d.y);
      const sel = highlight.has(-d.id);
      const roof = sel ? 0xff9a2f : d.kind === 'rail' ? 0x5d7a99 : d.kind === 'air' ? 0x8896a6 : 0x6a8a6a;
      // Long axis: the direction of the road/rail (the u direction for east-west, the v direction for north-south)
      const bits = d.kind === 'road' ? m.road.get(d.idx) : m.rail.get(d.idx);
      const alongX = d.kind === 'air' ? true : !!(bits & (CONN(1) | CONN(3))) && !(bits & (CONN(0) | CONN(2)));
      const ax = alongX ? 1 : 0;
      const ay = alongX ? 0 : 1;
      const len = d.kind === 'rail' ? 1.0 : d.kind === 'air' ? 0.8 : 0.6;
      const off = d.kind === 'air' ? 0 : 0.34;
      const cu = d.x + 0.5 + (alongX ? 0 : off);
      const cv = d.y + 0.5 + (alongX ? off : 0);
      this.box(cu, cv, lvl, ax, ay, len, 0.34, d.kind === 'air' ? 14 : 11, 0xd6cfc0);
      this.box(cu, cv, lvl, ax, ay, len + 0.08, 0.4, 3, roof, d.kind === 'air' ? 14 : 11);
      // Entrance (the door on the track side)
      this.box(cu - (alongX ? 0 : 0.17 * (off > 0 ? 1 : -1)) * 0, cv, lvl, ax, ay, Math.min(0.4, len * 0.5), 0.02, 7, 0x3a3d44, 0);
    }

    // Signals: a post and lamp on the left of the direction of travel (left-hand traffic). Red if the block being entered is in use
    if (this.transit.signals.size && view.zoom >= 0.3) {
      for (const idx of [...this.transit.signals.keys()]) {
        const mask = this.transit.signalMask(idx);
        if (!mask) continue;
        const sx0 = idx % m.size;
        const sy0 = Math.floor(idx / m.size);
        if (!inView(this.wx(sx0 + 0.5, sy0 + 0.5), this.wy(sx0 + 0.5, sy0 + 0.5, 0))) continue;
        const lvl = m.surfaceLevel(sx0, sy0);
        const red = this.transit.signalIsRed(idx);
        for (let d = 0; d < 8; d++) {
          if (!(mask & (1 << d))) continue;
          // Direction of travel (a unit vector for diagonals): put the post on the front left
          const k = d < 4 ? 1 : Math.SQRT1_2;
          const fx = DX8[d] * k;
          const fy = DY8[d] * k;
          const cu = sx0 + 0.5 - fx * 0.38 + fy * 0.3;
          const cv = sy0 + 0.5 - fy * 0.38 - fx * 0.3;
          this.box(cu, cv, lvl, 1, 0, 0.05, 0.05, 15, 0x3a3d44);
          this.box(cu, cv, lvl, 1, 0, 0.09, 0.09, 4, red ? 0xff3b30 : 0x35d36a, 15);
        }
      }
    }
  }

  private hideSprites(from: number): void {
    for (let i = from; i < this.sprites.length; i++) this.sprites[i].visible = false;
  }

  /** Take out one vehicle sprite (build it if there are not enough) */
  private nextSprite(): Sprite {
    let sp = this.sprites[this.spritesUsed];
    if (!sp) {
      sp = new Sprite();
      this.veh.addChild(sp);
      this.sprites.push(sp);
    }
    this.spritesUsed++;
    sp.visible = true;
    return sp;
  }

  /** Textures per model, color, and direction (drawn and built only the first time) */
  private texFor(key: string, draw: () => void): { tex: Texture; ax: number; ay: number } | null {
    let e = this.texCache.get(key);
    if (e) return e;
    if (!this.renderer) return null;
    if (this.texCache.size > 1500) {
      for (const t of this.texCache.values()) t.tex.destroy(true);
      this.texCache.clear();
    }
    const tmp = new Graphics();
    const prev = this.gfx;
    this.gfx = tmp;
    draw();
    this.gfx = prev;
    const b = tmp.getLocalBounds();
    const tex = this.renderer.generateTexture({ target: tmp, resolution: 2 });
    e = { tex, ax: -b.x / Math.max(1, b.width), ay: -b.y / Math.max(1, b.height) };
    tmp.destroy();
    this.texCache.set(key, e);
    return e;
  }

  /** Place a sprite at (u,v,lvl). Depth is ordered by u+v */
  private put(key: string, draw: () => void, u: number, v: number, lvl: number, zBias = 0, lift = 0): void {
    const e = this.texFor(key, draw);
    if (!e) return;
    this.putTex(e, u, v, lvl, zBias, lift);
  }

  /** Place a built texture (vehicle sprite, etc.) at (u,v,lvl). lift is the height from the ground (px) */
  private putTex(e: { tex: Texture; ax: number; ay: number }, u: number, v: number, lvl: number, zBias = 0, lift = 0, scale = 1): void {
    this.front.addVehicleTile(u, v);
    const sp = this.nextSprite();
    sp.texture = e.tex;
    sp.anchor.set(e.ax, e.ay);
    sp.scale.set(scale);
    sp.position.set(this.wx(u, v), this.wy(u, v, lvl) - lift);
    sp.zIndex = (u + v) * 64 + zBias;
  }

  private drawVehicles(view: View): void {
    const m = this.map;
    const margin = 160;
    const inView = (wx: number, wy: number) => wx > view.left - margin && wx < view.right + margin && wy > view.top - margin * 2 && wy < view.bottom + margin;
    this.spritesUsed = 0;
    this.gfx = this.air;
    for (const v of this.transit.vehicles) {
      const route = this.transit.routes.get(v.routeId);
      if (!route) continue;
      if (v.mode === 'road') this.drawBus(v, m, inView);
      else if (v.mode === 'rail') this.drawTrain(v, m, inView);
      else this.drawPlane(v, m, inView);
    }
    this.gfx = this.infra;
    this.hideSprites(this.spritesUsed);
  }

  /** Draw one bus at (cu,cv,lvl) (at the origin when building a texture). (dx,dy) = unit vector of the direction of travel */
  private drawBusAt(cu: number, cv: number, lvl: number, dx: number, dy: number, color: number): void {
    const L = 0.5;
    const Wd = 0.25;
    this.shadow(cu, cv, lvl, dx, dy, L, Wd);
    this.wheels(cu, cv, lvl, dx, dy, L, Wd);
    this.box(cu, cv, lvl, dx, dy, L, Wd, 6, color, 2.5); // lower body
    this.box(cu, cv, lvl, dx, dy, L - 0.02, Wd + 0.004, 2, 0xffffff, 6); // stripe
    this.box(cu, cv, lvl, dx, dy, L - 0.05, Wd - 0.006, 4.5, 0xbfe3ff, 8.5); // windows
    this.box(cu, cv, lvl, dx, dy, L - 0.01, Wd, 1.6, shade(color, 1.18), 13); // roof
    // Windshield and lights
    const fx = cu + dx * (L / 2 - 0.01);
    const fy = cv + dy * (L / 2 - 0.01);
    this.box(fx, fy, lvl, dx, dy, 0.03, Wd - 0.04, 5, 0x35506e, 8.5);
    for (const sd of [-0.5, 0.5]) this.box(fx - dy * Wd * sd * 0.8, fy + dx * Wd * sd * 0.8, lvl, dx, dy, 0.03, 0.04, 2, 0xfff3b0, 3.5);
  }

  /** A marker for being stuck (a small red box) */
  private putStuck(u: number, v: number, lvl: number, lift = 0): void {
    this.put('stuck', () => this.box(0, 0, 0, 1, 0, 0.14, 0.14, 6, 0xff3030, 13), u, v, lvl, 3, lift);
  }

  private drawBus(v: import('../../shared/sim/network/transit').Vehicle, m: GameMap, inView: (x: number, y: number) => boolean): void {
    const p = this.transit.position(v);
    if (!inView(this.wx(p.x + 0.5, p.y + 0.5), this.wy(p.x + 0.5, p.y + 0.5, 0))) return;
    const bx = Math.round(p.x);
    const by = Math.round(p.y);
    if (m.inBounds(bx, by) && m.span.get(m.idx(bx, by)) & 32) return; // not visible inside a tunnel
    const lvl = m.smoothLevel(bx, by, p.x - bx + 0.5, p.y - by + 0.5);
    const route = this.transit.routes.get(v.routeId)!;
    // Left-hand traffic: keep to the left of the direction of travel
    const off = 0.2;
    const cu = p.x + 0.5 + p.dy * off;
    const cv = p.y + 0.5 - p.dx * off;
    const di = dirIndex(p.dx, p.dy);
    const fr = vehicleFrame('bus', modelOf(v.modelId).sprite ?? 0, di);
    if (fr) {
      // Shadow -> body (sprite) -> a marker in the route color (a small dot)
      this.put(`sh|bus|${di}`, () => this.shadow(0, 0, 0, DIRS[di][0], DIRS[di][1], BUS_SCALE * 1.05, BUS_SCALE * 0.3), cu, cv, lvl, -2);
      this.putTex(fr, cu, cv, lvl, 0, 0, BUS_SCALE);
      this.put(`pip|${route.color}`, () => this.box(0, 0, 0, 1, 0, 0.07, 0.07, 2.5, route.color, 9.5), cu, cv, lvl, 2);
    } else this.put(`b|${route.color}|${di}`, () => this.drawBusAt(0, 0, 0, DIRS[di][0], DIRS[di][1], route.color), cu, cv, lvl);
    if (v.stuck > 20) this.putStuck(cu, cv, lvl, fr ? 6 : 0); // for a sprite bus, put it above the roof
  }

  /** The point at distance s from the head along a polyline, and its direction */
  private pointAt(pts: [number, number][], s: number): { x: number; y: number; dx: number; dy: number } {
    let rem = s;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len === 0) continue;
      if (rem <= len) return { x: x0 + ((x1 - x0) * rem) / len, y: y0 + ((y1 - y0) * rem) / len, dx: (x0 - x1) / len, dy: (y0 - y1) / len };
      rem -= len;
    }
    const n = pts.length;
    const [x, y] = pts[n - 1];
    const [px, py] = n > 1 ? pts[n - 2] : [x + 1, y];
    const l = Math.hypot(px - x, py - y) || 1;
    return { x, y, dx: (px - x) / l, dy: (py - y) / l };
  }

  /** Draw one car at (cu,cv,lvl). role: 1 = lead (windshield + white lights) 2 = last car (red tail lights) 4 = pantograph. (dx,dy) = unit vector toward the head */
  private drawCarAt(cu: number, cv: number, lvl: number, dx: number, dy: number, model: import('../../shared/data/models').VehicleModel, role: number): void {
    const L = CAR_LEN - 0.03;
    const Wd = 0.23;
    this.shadow(cu, cv, lvl, dx, dy, L, Wd);
    this.box(cu, cv, lvl, dx, dy, L - 0.06, Wd - 0.04, 1.6, 0x303236, 1); // underfloor
    this.box(cu, cv, lvl, dx, dy, L, Wd, 4, model.stripe ?? 0x2f7dd1, 2.6); // skirt in the stripe color
    this.box(cu, cv, lvl, dx, dy, L, Wd, 6.5, model.body, 6.4); // body
    this.box(cu, cv, lvl, dx, dy, L - 0.05, Wd + 0.004, 3.2, 0x7fa8cf, 7.6); // window band
    this.box(cu, cv, lvl, dx, dy, L - 0.04, Wd - 0.03, 1.4, shade(model.body, 0.82), 12.8); // roof
    if (role & 4) this.box(cu, cv, lvl, dx, dy, 0.1, 0.1, 3, 0x55585e, 14); // pantograph
    // Cab: at the end in the direction of travel for the lead car, at the rear end for the last car. A single car (1 car) has them at both ends
    for (const front of [true, false]) {
      if (!(role & (front ? 1 : 2))) continue;
      const end = front ? 1 : -1;
      const ex = cu + dx * end * (L / 2 - 0.01);
      const ey = cv + dy * end * (L / 2 - 0.01);
      this.box(ex, ey, lvl, dx, dy, 0.035, Wd - 0.05, 6, 0x2c3e55, 7);
      const light = front ? 0xfff3b0 : 0xff4a4a;
      for (const sd of [-0.5, 0.5]) this.box(ex - dy * Wd * sd * 0.8, ey + dx * Wd * sd * 0.8, lvl, dx, dy, 0.035, 0.04, 2.2, light, 3.4);
    }
  }

  private drawTrain(v: import('../../shared/sim/network/transit').Vehicle, m: GameMap, inView: (x: number, y: number) => boolean): void {
    const model = modelOf(v.modelId);
    const pts = this.transit.trainPoints(v);
    if (!pts.length) return;
    if (!inView(this.wx(pts[0][0] + 0.5, pts[0][1] + 0.5), this.wy(pts[0][0] + 0.5, pts[0][1] + 0.5, 0))) return;
    const cars = v.cars ?? model.defaultCars;
    const centers: [number, number][] = pts.map(([x, y]) => [x + 0.5, y + 0.5]);
    for (let k = 0; k < cars; k++) {
      const p = this.pointAt(centers, (k + 0.5) * CAR_LEN);
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.y);
      if (m.inBounds(tx, ty) && m.span.get(m.idx(tx, ty)) & 32) continue; // inside a tunnel
      if (!inView(this.wx(p.x, p.y), this.wy(p.x, p.y, 0))) continue;
      const lvl = m.smoothLevel(tx, ty, p.x - tx, p.y - ty);
      const role = (k === 0 ? 1 : 0) | (k === cars - 1 ? 2 : 0) | (k % 3 === 1 ? 4 : 0);
      const di = dirIndex(p.dx, p.dy);
      // Sprites: the lead car faces the direction of travel, the last car uses the lead car facing the opposite way, and the middle ones are middle cars
      const isHead = k === 0;
      const isRear = k === cars - 1 && cars > 1;
      const fr = model.sprite !== undefined ? trainFrame(model.sprite, isHead || isRear, isRear ? (di + 4) & 7 : di) : null;
      if (fr) {
        this.put(`sh|car|${di}`, () => this.shadow(0, 0, 0, DIRS[di][0], DIRS[di][1], CAR_LEN * 1.05, 0.2), p.x, p.y, lvl, -2);
        this.putTex(fr, p.x, p.y, lvl, 0, 0, fr.sc);
      } else this.put(`c|${model.id}|${role}|${di}`, () => this.drawCarAt(0, 0, 0, DIRS[di][0], DIRS[di][1], model, role), p.x, p.y, lvl);
    }
    if (v.stuck > 20) {
      const h = centers[0];
      this.putStuck(h[0], h[1], m.surfaceLevel(Math.floor(h[0]), Math.floor(h[1])));
    }
  }

  private drawPlane(v: import('../../shared/sim/network/transit').Vehicle, m: GameMap, inView: (x: number, y: number) => boolean): void {
    const model = modelOf(v.modelId);
    const p = this.transit.planePos(v);
    const lvl = m.levelAt(Math.floor(p.x), Math.floor(p.y));
    const wx = this.wx(p.x, p.y);
    const wy = this.wy(p.x, p.y, lvl);
    if (!inView(wx, wy - p.alt * AIR_ALT)) return;
    const g = this.air;
    const di = dirIndex(p.dx, p.dy);
    const fr = vehicleFrame('air', model.sprite ?? 0, di);
    // Ground shadow (fainter and smaller the higher it is)
    const sw = (10 + Math.sqrt(model.cap) * 0.9) * AIR_SCALE * (1 - p.alt * 0.25);
    this.shad.ellipse(wx, wy, sw, sw * 0.5).fill({ color: 0x000000, alpha: 0.28 - p.alt * 0.1 });
    if (fr) {
      this.putTex(fr, p.x, p.y, lvl, 1_000_000, p.alt * AIR_ALT, AIR_SCALE); // always in front of other vehicles
      return;
    }
    // A simple airframe for when the sprite could not be loaded
    const sdx = (p.dx - p.dy) * 32;
    const sdy = (p.dx + p.dy) * 16;
    const sl = Math.hypot(sdx, sdy) || 1;
    const fx = sdx / sl;
    const fy = sdy / sl;
    const rx = -fy;
    const ry = fx;
    const size = model.cap > 250 ? 1.5 : model.cap > 100 ? 1.2 : 1;
    const cy = wy - p.alt * AIR_ALT - 4;
    const pt = (f: number, s: number) => [wx + fx * f * size + rx * s * size, cy + fy * f * size + ry * s * size];
    g.poly([...pt(16, 0), ...pt(4, 3), ...pt(-14, 2), ...pt(-16, 0), ...pt(-14, -2), ...pt(4, -3)]).fill(model.body);
    g.poly([...pt(4, 3), ...pt(-3, 18), ...pt(-8, 18), ...pt(-4, 0), ...pt(-8, -18), ...pt(-3, -18), ...pt(4, -3)]).fill(model.body);
  }
}
