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
import { planSpan } from '../../shared/world/spans';
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
/** 新規の開発(建設)を伴うツール。会社の評価が最悪のときは使えない(撤去・移動・路線作成は可) */
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

/** 建設ツール: ドラッグで直線の道路/一方通行/撤去を行い、プレビューを表示する */
export class ToolController {
  tool: Tool = 'pan';
  readonly overlay = new Graphics();
  /** 資金: 払えるか / 支払う(足りなければ false)。main が会社につなぐ */
  afford: (cost: number) => boolean = () => true;
  pay: (cost: number) => boolean = () => true;
  /** 新規の開発ができるか(会社の評価が最悪だと false) */
  canBuild: () => boolean = () => true;
  /** 駅ツールの設置範囲の検討(main が設定する) */
  stationPlanner: ((x: number, y: number) => StationPlan) | null = null;
  /** 大型施設の設置範囲の検討(main が設定する) */
  facilityPlanner: ((x: number, y: number, type: FacilityType) => FacilityPlan) | null = null;
  private start: Tile | null = null;
  private hover: Tile | null = null;

  constructor(
    private map: GameMap,
    private camera: Camera,
    canvas: HTMLElement,
    private pick: (sx: number, sy: number) => Tile | null,
    /** 停留所/路線ツールのクリック */
    private onClickTile: (tool: Tool, tile: Tile) => void,
    /** 操作結果のメッセージ(橋・トンネルの可否など) */
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
        // 2本指ジェスチャー中は建設しない
        this.start = null;
        return;
      }
      if (BUILD.includes(this.tool) && !this.canBuild()) {
        this.onMessage?.(tr('会社の評価が最悪のため、新規の開発はできません。待ち人数や渋滞を減らして評価を上げてください(撤去・路線編集・車両購入は可能です)'));
        this.start = null;
        return;
      }
      const end = this.pick(e.clientX, e.clientY) ?? this.start;
      if (SINGLE.includes(this.tool)) this.onClickTile(this.tool, this.tool === 'airport' ? { x: end.x - 1, y: end.y - 1 } : end);
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

  /** 矩形ドラッグ範囲(上限あり) */
  private rect(a: Tile, b: Tile): Tile[] {
    return dragRect(a, b);
  }

  /** 通信(マルチプレイ)時: ドラッグ操作はサーバーへ送る。なければ手元で実行する */
  remoteBuild: ((tool: DragTool, a: Tile, b: Tile) => void) | null = null;

  private apply(a: Tile, b: Tile): void {
    if (this.remoteBuild) return this.remoteBuild(this.tool as DragTool, a, b);
    applyBuild(this.map, this.tool as DragTool, a, b, { afford: (c) => this.afford(c), pay: (c) => this.pay(c), msg: (m) => this.onMessage?.(m) });
  }

  /** 毎フレーム: ホバー/ドラッグ範囲を描く */
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
        // この辺(または末尾なら手前の辺)が敷設可能か
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
    const x0 = this.hover.x - 1;
    const y0 = this.hover.y - 1;
    const ok = canPlaceAirport(this.map, x0, y0);
    const color = ok ? 0x66ff99 : 0xff4455;
    const w = 2.5 / this.camera.zoom;
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const tx = x0 + i;
        const ty = y0 + j;
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
