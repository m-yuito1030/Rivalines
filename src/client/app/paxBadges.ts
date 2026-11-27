import type { Transit, Vehicle } from '../../shared/sim/network/transit';
import type { ToScreen } from './moneyFloat';

/** Cap on how many are shown (so a crowded town does not fill the screen with text) */
const MAX_BADGES = 40;
/** Not shown when zoomed out beyond this (small display) */
const MIN_ZOOM = 0.3;

/**
 * Above a vehicle stopped at a station or stop, show in real time the number who got off (down arrow) and got on (up arrow) at the current stop.
 * It disappears when the stop ends and the vehicle sets off. The server counts the numbers per vehicle and sends them every time.
 */
export class PaxBadges {
  private pool: HTMLElement[] = [];

  constructor(
    private transit: Transit,
    private toScreen: ToScreen,
    private zoom: () => number,
  ) {}

  /** Call every frame */
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

  /** While stopped (boarding and alighting in progress) and someone got off or on */
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
