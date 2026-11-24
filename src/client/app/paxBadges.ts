import type { Transit, Vehicle } from '../../shared/sim/network/transit';
import type { ToScreen } from './moneyFloat';

/** 画面に出す上限(混み合った街で、画面が文字だらけにならないように) */
const MAX_BADGES = 40;
/** これより引いた(小さい)表示では出さない */
const MIN_ZOOM = 0.3;

/**
 * 駅や停留所に停まっている乗り物の上に、いまの停車で「降りた人数(↓)・乗った人数(↑)」を、リアルタイムで出す。
 * 停車が終わって走り出すと消える。数字は、サーバーが車両ごとに数えて毎回送ってくる。
 */
export class PaxBadges {
  private pool: HTMLElement[] = [];

  constructor(
    private transit: Transit,
    private toScreen: ToScreen,
    private zoom: () => number,
  ) {}

  /** 毎フレーム呼ぶ */
  update(): void {
    let n = 0;
    if (this.zoom() >= MIN_ZOOM) {
      for (const v of this.transit.vehicles) {
        if (n >= MAX_BADGES) break;
        if (!this.show(v)) continue;
        const p = this.transit.position(v);
        const s = this.toScreen(p.x + 0.5, p.y + 0.5);
        if (!s) continue;
        const el = this.el(n++);
        const off = v.off ?? 0;
        const on = v.on ?? 0;
        const html = `<span class="off">↓${off}</span> <span class="on">↑${on}</span>`;
        if (el.dataset.h !== html) {
          el.innerHTML = html;
          el.dataset.h = html;
        }
        el.style.display = '';
        el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y - 26 * Math.min(1.5, this.zoom() + 0.4))}px) translate(-50%, -100%)`;
      }
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }

  /** 停車中(乗降の最中)で、降りた人か乗った人がいるとき */
  private show(v: Vehicle): boolean {
    return v.state === 'load' && !v.hold && ((v.on ?? 0) > 0 || (v.off ?? 0) > 0);
  }

  private el(i: number): HTMLElement {
    let e = this.pool[i];
    if (!e) {
      e = document.createElement('div');
      e.className = 'pax-badge';
      e.title = '↓ 降りた人 / ↑ 乗った人';
      document.body.append(e);
      this.pool[i] = e;
    }
    return e;
  }
}
