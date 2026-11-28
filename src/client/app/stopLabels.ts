import { type Container, Text } from 'pixi.js';
import { Camera } from '../render/camera';
import { onLangChange, tr } from '../i18n';
import type { Mode } from '../../shared/data/models';
import type { Transit } from '../../shared/sim/network/transit';
import type { GameMap } from '../../shared/world/gameMap';
import { LEVEL_PX } from '../../shared/world/constants';

const KEY = 'simulator-stopnames';
/** The minimum zoom to show station and stop names (zoomed out too far it would be all text, so smaller stops show only when close) */
const MIN_ZOOM: Record<Mode, number> = { rail: 0.15, air: 0.15, road: 0.3 };
const FILL: Record<Mode, number> = { road: 0xfff0b3, rail: 0xb8e0ff, air: 0xd7ffd0 };

/** Whether to show the name of kind `kind` at zoom `zoom` */
export const stopLabelVisibleAt = (kind: Mode, zoom: number): boolean => zoom >= MIN_ZOOM[kind];

/** Show the names of stations, bus stops, and airports over the map (can be toggled, and the setting is saved) */
export class StopLabels {
  private texts = new Map<number, Text>();
  private on: boolean;

  constructor(
    private layer: Container,
    private transit: Transit,
    private map: GameMap,
    private button: HTMLElement,
    /** Whether the underground view is on: then only the names of underground stops are shown (and in the normal view, none of them) */
    private underground: () => boolean = () => false,
    /** While a rail route is being made, the names of all stops are shown */
    private showAll: () => boolean = () => false,
  ) {
    this.on = localStorage.getItem(KEY) !== '0';
    this.sync();
    onLangChange(() => this.sync());
    button.addEventListener('click', () => this.toggle());
  }

  get visible(): boolean {
    return this.on;
  }

  toggle(): void {
    this.on = !this.on;
    localStorage.setItem(KEY, this.on ? '1' : '0');
    this.sync();
  }

  private sync(): void {
    this.button.classList.toggle('on', this.on);
    this.button.textContent = this.on ? tr('🚏 駅名を隠す') : tr('🚏 駅名を表示');
    if (!this.on) for (const t of this.texts.values()) t.visible = false;
  }

  /** Every frame: place the names of stops that are on screen (w,h = the screen size) */
  update(camera: { x: number; y: number; zoom: number }, w: number, h: number): void {
    // Clean up labels of demolished stops
    for (const [id, t] of this.texts) {
      if (!this.transit.stops.has(id)) {
        t.destroy();
        this.texts.delete(id);
      }
    }
    if (!this.on) return;
    for (const s of this.transit.stops.values()) {
      let label = this.texts.get(s.id);
      const under = this.map.subwayVer !== 0 && (this.map.subway.get(s.idx) & 0x80) !== 0 && this.map.rail.get(s.idx) === 0;
      if (s.waypoint || !s.name || (!this.showAll() && under !== this.underground()) || !stopLabelVisibleAt(s.kind, camera.zoom)) {
        if (label) label.visible = false;
        continue;
      }
      const lvl = this.map.levelAt(s.x, s.y);
      const wp = Camera.tileToWorld(s.x + 0.5, s.y + 0.5);
      const x = (wp.x - camera.x) * camera.zoom + w / 2;
      const y = (wp.y - lvl * LEVEL_PX - camera.y) * camera.zoom + h / 2 - (s.kind === 'rail' ? 22 : 14);
      if (x < -120 || x > w + 120 || y < -40 || y > h + 40) {
        if (label) label.visible = false;
        continue;
      }
      if (!label) {
        label = new Text({ text: '', style: { fontSize: 12, fill: FILL[s.kind], stroke: { color: 0x000000, width: 3 }, fontFamily: 'sans-serif' } });
        label.anchor.set(0.5, 1);
        this.layer.addChild(label);
        this.texts.set(s.id, label);
      }
      if (label.text !== s.name) label.text = s.name;
      label.visible = true;
      label.position.set(x, y);
    }
  }
}
