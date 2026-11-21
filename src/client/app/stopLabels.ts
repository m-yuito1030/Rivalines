import { type Container, Text } from 'pixi.js';
import { Camera } from '../render/camera';
import type { Mode } from '../../shared/data/models';
import type { Transit } from '../../shared/sim/network/transit';
import type { GameMap } from '../../shared/world/gameMap';
import { LEVEL_PX } from '../../shared/world/constants';

const KEY = 'simulator-stopnames';
/** 駅名・停留所名を出す最小のズーム(引きすぎると文字だらけになるので、小さい停留所ほど寄ったときだけ) */
const MIN_ZOOM: Record<Mode, number> = { rail: 0.15, air: 0.15, road: 0.3 };
const FILL: Record<Mode, number> = { road: 0xfff0b3, rail: 0xb8e0ff, air: 0xd7ffd0 };

/** ズーム zoom で、種別 kind の名前を出すか */
export const stopLabelVisibleAt = (kind: Mode, zoom: number): boolean => zoom >= MIN_ZOOM[kind];

/** 駅・バス停・空港の名前を地図の上に表示する(表示/非表示は切り替えられ、設定は保存される) */
export class StopLabels {
  private texts = new Map<number, Text>();
  private on: boolean;

  constructor(
    private layer: Container,
    private transit: Transit,
    private map: GameMap,
    private button: HTMLElement,
  ) {
    this.on = localStorage.getItem(KEY) !== '0';
    this.sync();
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
    this.button.textContent = this.on ? '🚏 駅名を隠す' : '🚏 駅名を表示';
    if (!this.on) for (const t of this.texts.values()) t.visible = false;
  }

  /** 毎フレーム: 画面に入っている停留所の名前を置く(w,h=画面の大きさ) */
  update(camera: { x: number; y: number; zoom: number }, w: number, h: number): void {
    // 撤去された停留所のラベルを片付ける
    for (const [id, t] of this.texts) {
      if (!this.transit.stops.has(id)) {
        t.destroy();
        this.texts.delete(id);
      }
    }
    if (!this.on) return;
    for (const s of this.transit.stops.values()) {
      let label = this.texts.get(s.id);
      if (s.waypoint || !s.name || !stopLabelVisibleAt(s.kind, camera.zoom)) {
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
