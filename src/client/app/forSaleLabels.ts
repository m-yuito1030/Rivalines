import { type Container, Text } from 'pixi.js';
import { Camera } from '../render/camera';
import { LEVEL_PX } from '../../shared/world/constants';
import type { Facility } from '../../shared/world/facilities';
import type { GameMap } from '../../shared/world/gameMap';
import { askingPrice, isForSale, listingLeft } from '../../shared/sim/facility/listings';
import { yen } from '../../shared/sim/economy/economy';

/** 売り出し中だと分かるように、物件の上に「売出 ¥価格 あとN日」を出す(拡大したときだけ。引きすぎると文字だらけになる) */
export const FORSALE_MIN_ZOOM = 0.18;

export class ForSaleLabels {
  private texts = new Map<number, Text>();

  constructor(
    private layer: Container,
    private map: GameMap,
    private day: () => number,
  ) {}

  update(camera: { x: number; y: number; zoom: number }, w: number, h: number): void {
    const seen = new Set<number>();
    const day = this.day();
    if (camera.zoom >= FORSALE_MIN_ZOOM) {
      for (const f of this.map.facilities) {
        if (!isForSale(f)) continue;
        const label = this.labelFor(f);
        // 敷地の中心の少し上(施設の高さぶん)
        const cx = f.x0 + f.w / 2;
        const cy = f.y0 + f.h / 2;
        const wp = Camera.tileToWorld(cx, cy);
        const lvl = this.map.levelAt(Math.floor(cx), Math.floor(cy));
        const x = (wp.x - camera.x) * camera.zoom + w / 2;
        const y = (wp.y - lvl * LEVEL_PX - camera.y) * camera.zoom + h / 2 - (40 + 22 * f.w) * camera.zoom;
        if (x < -140 || x > w + 140 || y < -40 || y > h + 40) {
          label.visible = false;
          continue;
        }
        const text = `売出 ${yen(askingPrice(f))} あと${listingLeft(f, day)}日`;
        if (label.text !== text) label.text = text;
        label.visible = true;
        label.position.set(x, y);
        seen.add(f.id);
      }
    }
    for (const [id, t] of this.texts) {
      if (seen.has(id)) continue;
      // 売り出しが終わった(購入・取り壊し)物件のラベルは片付ける
      if (!this.map.facilities.some((f) => f.id === id && isForSale(f))) {
        t.destroy();
        this.texts.delete(id);
      } else t.visible = false;
    }
  }

  private labelFor(f: Facility): Text {
    let t = this.texts.get(f.id);
    if (!t) {
      t = new Text({ text: '', style: { fontSize: 12, fill: 0xffd34d, stroke: { color: 0x000000, width: 3 }, fontFamily: 'sans-serif', fontWeight: 'bold' } });
      t.anchor.set(0.5, 1);
      this.layer.addChild(t);
      this.texts.set(f.id, t);
    }
    return t;
  }
}
