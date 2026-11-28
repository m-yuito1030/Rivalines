import { tr } from '../i18n';
import { Graphics } from 'pixi.js';
import type { Camera } from '../render/camera';
import { LEVEL_PX } from '../../shared/world/constants';
import type { GameMap } from '../../shared/world/gameMap';
import { canConnect, lineTiles } from '../../shared/world/roads';
import { type DragTool, applyBuild, dragRect } from '../../shared/world/buildApply';
import { canConnectRail, railLineTiles } from '../../shared/world/rails';
import { DX8, DY8 } from '../../shared/world/directions';
import { canPlaceAirport } from '../../shared/world/airports';
import { type AirportAxis, type AirportSize, airportFootprint } from '../../shared/world/airportLayout';
import { planSpan } from '../../shared/world/spans';
import { canDigAt, subwayLine } from '../../shared/world/subway';
import { DEPTH_COLORS } from '../render/undergroundView';
import type { StationPlan } from '../../shared/world/stations';
import { FACILITY_TYPES, NEW_FACILITY_TYPES, type FacilityPlan, type FacilityType, type NewFacilityType } from '../../shared/world/facilities';

export type Tool =
  | 'pan'
  | 'road'
  | 'oneway'
  | 'twoway'
  | 'bulldoze'
  | 'stop'
  | 'route'
  | 'rail'
  | 'railauto'
  | 'signalline'
  | 'station'
  | 'airport'
  | 'raise'
  | 'lower'
  | 'level'
  | 'roadspan'
  | 'railspan'
  | 'subway'
  | 'subwaydel'
  | 'portal'
  | 'signal'
  | 'waypoint'
  | 'depot'
  | 'stadium'
  | 'amusement'
  | 'mall'
  | 'park'
  | 'department'
  | 'hotel'
  | NewFacilityType;
const RECT: Tool[] = ['raise', 'lower', 'level', 'bulldoze'];
/** Tools that involve new development (construction). Unavailable when the company's rating is the worst (demolition, move, and route creation are allowed) */
const BUILD: Tool[] = [
  'road',
  'oneway',
  'rail',
  'railauto',
  'signalline',
  'station',
  'airport',
  'raise',
  'lower',
  'level',
  'roadspan',
  'railspan',
  'subway',
  'portal',
  'signal',
  'waypoint',
  'stop',
  'depot',
  'stadium',
  'amusement',
  'mall',
  'park',
  'department',
  'hotel',
  ...NEW_FACILITY_TYPES,
];
const SINGLE: Tool[] = ['stop', 'route', 'station', 'airport', 'signal', 'waypoint', 'depot', 'stadium', 'amusement', 'mall', 'park', 'department', 'hotel', ...NEW_FACILITY_TYPES];
type Tile = { x: number; y: number };
const isFacilityTool = (t: string): t is FacilityType => (FACILITY_TYPES as string[]).includes(t);

/** Construction tool: drag to lay a straight road / one-way / demolition, and show a preview */
export class ToolController {
  tool: Tool = 'pan';
  readonly overlay = new Graphics();
  /** Funds: whether it can be paid / pay (false if short). main connects it to the company */
  afford: (cost: number) => boolean = () => true;
  pay: (cost: number) => boolean = () => true;
  /** Whether new development is possible (false when the company's rating is the worst) */
  canBuild: () => boolean = () => true;
  /** Checking the placement area of the station tool (set by main) */
  stationPlanner: ((x: number, y: number) => StationPlan) | null = null;
  /** The chosen airport size and direction, and where its top-left tile is for a click at (x,y) (the airport is centred on the click) */
  airportSel: { sel: { size: AirportSize; axis: AirportAxis }; origin: (x: number, y: number) => { x: number; y: number } } | null = null;
  /** Checking the placement area of large facilities (set by main) */
  facilityPlanner: ((x: number, y: number, type: FacilityType) => FacilityPlan) | null = null;
  private start: Tile | null = null;
  private hover: Tile | null = null;

  constructor(
    private map: GameMap,
    private camera: Camera,
    canvas: HTMLElement,
    private pick: (sx: number, sy: number) => Tile | null,
    /** Clicks of the stop/route tools */
    private onClickTile: (tool: Tool, tile: Tile) => void,
    /** A message about an action's result (whether a bridge or tunnel is possible, etc.) */
    public onMessage?: (msg: string) => void,
  ) {
    canvas.addEventListener('pointerdown', (e) => {
      if (this.camera.multiTouch) this.start = null;
      if (e.button !== 0 || this.tool === 'pan' || this.camera.multiTouch) return;
      this.start = this.pick(e.clientX, e.clientY);
      this.hover = this.start;
    });
    canvas.addEventListener('pointermove', (e) => {
      this.hover = this.pick(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.start) return;
      if (this.camera.multiTouch) {
        // Do not build during a two-finger gesture
        this.start = null;
        return;
      }
      if (BUILD.includes(this.tool) && !this.canBuild()) {
        this.onMessage?.(tr('会社の評価が最悪のため、新規の開発はできません。待ち人数や渋滞を減らして評価を上げてください(撤去・路線編集・車両購入は可能です)'));
        this.start = null;
        return;
      }
      const end = this.pick(e.clientX, e.clientY) ?? this.start;
      if (SINGLE.includes(this.tool)) this.onClickTile(this.tool, this.tool === 'airport' && this.airportSel ? this.airportSel.origin(end.x, end.y) : end);
      else this.apply(this.start, end);
      this.start = null;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.start = null;
    });
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.camera.leftPans = t === 'pan';
    this.start = null;
  }

  /** Rectangle drag range (with a cap) */
  private rect(a: Tile, b: Tile): Tile[] {
    return dragRect(a, b);
  }

  /** In communication (multiplayer): drag actions are sent to the server. Otherwise run locally */
  remoteBuild: ((tool: DragTool, a: Tile, b: Tile) => void) | null = null;
  /** The subway tool: depth at the start and at the end of the line */
  subwayZ: [number, number] = [1, 1];

  private apply(a: Tile, b: Tile): void {
    if (this.remoteBuild) return this.remoteBuild(this.tool as DragTool, a, b);
    applyBuild(this.map, this.tool as DragTool, a, b, { z: this.subwayZ, afford: (c) => this.afford(c), pay: (c) => this.pay(c), msg: (m) => this.onMessage?.(m) });
  }

  /** Every frame: draw the hover/drag range */
  draw(): void {
    const g = this.overlay;
    g.clear();
    if (this.tool === 'pan' || !this.hover) return;
    const w = 2.5 / this.camera.zoom;
    if (RECT.includes(this.tool)) {
      const tl = this.start ? this.rect(this.start, this.hover) : [this.hover];
      const col = this.tool === 'raise' ? 0xffd24a : this.tool === 'lower' ? 0x9a7cff : this.tool === 'bulldoze' ? 0xff8844 : 0x66ddff;
      const draw = tl.length <= 1500;
      for (const t of tl) {
        const lvl = this.map.inBounds(t.x, t.y) ? this.map.levelAt(t.x, t.y) : 0;
        const wx = (t.x - t.y) * 32;
        const wy = (t.x + t.y) * 16 - lvl * LEVEL_PX;
        if (draw)
          g.poly([wx, wy, wx + 32, wy + 16, wx, wy + 32, wx - 32, wy + 16])
            .fill({ color: col, alpha: 0.22 })
            .stroke({ width: w, color: col, alpha: 0.7 });
      }
      return;
    }
    if (this.tool === 'roadspan' || this.tool === 'railspan') return this.drawSpanPreview(g, w);
    if (this.tool === 'subway' || this.tool === 'subwaydel') return this.drawSubwayPreview(g, w);
    if (isFacilityTool(this.tool) && this.facilityPlanner) {
      const plan = this.facilityPlanner(this.hover.x, this.hover.y, this.tool);
      const color = plan.ok ? 0x66ff99 : 0xff4455;
      for (const [x, y] of plan.tiles) {
        const lvl = this.map.inBounds(x, y) ? this.map.levelAt(x, y) : 0;
        const wx = (x - y) * 32;
        const wy = (x + y) * 16 - lvl * LEVEL_PX;
        g.poly([wx, wy, wx + 32, wy + 16, wx, wy + 32, wx - 32, wy + 16])
          .fill({ color, alpha: 0.25 })
          .stroke({ width: w, color, alpha: 0.9 });
      }
      return;
    }
    if (this.tool === 'station' && this.stationPlanner) {
      const plan = this.stationPlanner(this.hover.x, this.hover.y);
      const color = plan.ok ? 0x66ff99 : 0xff4455;
      for (const [x, y] of plan.tiles) {
        const lvl = this.map.inBounds(x, y) ? this.map.levelAt(x, y) : 0;
        const wx = (x - y) * 32;
        const wy = (x + y) * 16 - lvl * LEVEL_PX;
        g.poly([wx, wy, wx + 32, wy + 16, wx, wy + 32, wx - 32, wy + 16])
          .fill({ color, alpha: 0.25 })
          .stroke({ width: w, color, alpha: 0.9 });
      }
      return;
    }
    const single = SINGLE.includes(this.tool);
    if (this.tool === 'airport') return this.drawAirportPreview(g);
    const tiles =
      this.start && !single
        ? (this.tool === 'rail' || this.tool === 'signalline' || this.tool === 'bulldoze' ? railLineTiles : lineTiles)(this.start.x, this.start.y, this.hover.x, this.hover.y)
        : [{ ...this.hover, d: 0 }];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      let ok = true;
      if (this.start && (this.tool === 'road' || this.tool === 'oneway' || this.tool === 'rail')) {
        const can = this.tool === 'rail' ? canConnectRail : canConnect;
        // Whether this edge (or, at the end, the edge before it) can be laid
        if (tiles.length > 1) ok = i < tiles.length - 1 ? can(this.map, t.x, t.y, t.d, true) : can(this.map, t.x - DX8[t.d], t.y - DY8[t.d], t.d, true);
      }
      const lvl = this.map.inBounds(t.x, t.y) ? this.map.levelAt(t.x, t.y) : 0;
      const wx = (t.x - t.y) * 32;
      const wy = (t.x + t.y) * 16 - lvl * LEVEL_PX;
      const color = this.tool === 'bulldoze' ? 0xff8844 : single ? 0x66bbff : ok ? 0x66ff99 : 0xff4455;
      g.poly([wx, wy, wx + 32, wy + 16, wx, wy + 32, wx - 32, wy + 16])
        .fill({ color, alpha: 0.25 })
        .stroke({ width: w, color, alpha: 0.9 });
    }
  }

  /** Preview of a subway line: tiles take the colour of their depth (red if the line cannot be built) */
  private drawSubwayPreview(g: Graphics, w: number): void {
    const hover = this.hover;
    if (!hover) return;
    const a = this.start ?? hover;
    const del = this.tool === 'subwaydel';
    const line = this.start && !del ? subwayLine(a, hover, this.subwayZ[0], this.subwayZ[1]) : null;
    const tiles = this.start ? lineTiles(a.x, a.y, hover.x, hover.y) : [{ x: a.x, y: a.y }];
    tiles.forEach((t, i) => {
      const lvl = this.map.inBounds(t.x, t.y) ? this.map.levelAt(t.x, t.y) : 0;
      const wx = (t.x - t.y) * 32;
      const wy = (t.x + t.y) * 16 - lvl * LEVEL_PX;
      const ok = this.map.inBounds(t.x, t.y) && (del || canDigAt(this.map, t.x, t.y));
      const depth = line?.[i]?.depth ?? this.subwayZ[0];
      const color = del ? 0xff8844 : !this.start ? DEPTH_COLORS[depth - 1] : line && ok ? DEPTH_COLORS[depth - 1] : 0xff4455;
      g.poly([wx, wy, wx + 32, wy + 16, wx, wy + 32, wx - 32, wy + 16])
        .fill({ color, alpha: 0.3 })
        .stroke({ width: w, color, alpha: 0.95 });
    });
  }

  private drawSpanPreview(g: Graphics, w: number): void {
    const a = this.start ?? this.hover;
    const b = this.hover;
    if (!a || !b) return;
    const mode = this.tool === 'roadspan' ? 'road' : 'rail';
    const plan = planSpan(this.map, a.x, a.y, b.x, b.y, mode);
    const color = !this.start ? 0x66bbff : plan.ok ? (plan.kind === 'bridge' ? 0x66ff99 : 0xffcc55) : 0xff4455;
    const tiles = this.start ? lineTiles(a.x, a.y, b.x, b.y) : [{ x: a.x, y: a.y }];
    for (const t of tiles) {
      const lvl = this.map.inBounds(t.x, t.y) ? this.map.levelAt(t.x, t.y) : 0;
      const wx = (t.x - t.y) * 32;
      const wy = (t.x + t.y) * 16 - lvl * LEVEL_PX;
      g.poly([wx, wy, wx + 32, wy + 16, wx, wy + 32, wx - 32, wy + 16])
        .fill({ color, alpha: 0.25 })
        .stroke({ width: w, color, alpha: 0.9 });
    }
  }

  private drawAirportPreview(g: Graphics): void {
    if (!this.hover) return;
    const sel = this.airportSel?.sel ?? { size: 'S' as AirportSize, axis: 'x' as AirportAxis };
    const o = this.airportSel ? this.airportSel.origin(this.hover.x, this.hover.y) : { x: this.hover.x - 1, y: this.hover.y - 1 };
    const { w: fw, h: fh } = airportFootprint(sel.size, sel.axis);
    const ok = canPlaceAirport(this.map, o.x, o.y, sel.size, sel.axis);
    const color = ok ? 0x66ff99 : 0xff4455;
    const w = 2.5 / this.camera.zoom;
    for (let j = 0; j < fh; j++) {
      for (let i = 0; i < fw; i++) {
        const tx = o.x + i;
        const ty = o.y + j;
        const lvl = this.map.inBounds(tx, ty) ? this.map.levelAt(tx, ty) : 0;
        const wx = (tx - ty) * 32;
        const wy = (tx + ty) * 16 - lvl * LEVEL_PX;
        g.poly([wx, wy, wx + 32, wy + 16, wx, wy + 32, wx - 32, wy + 16])
          .fill({ color, alpha: 0.25 })
          .stroke({ width: w, color, alpha: 0.9 });
      }
    }
  }
}
