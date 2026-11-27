import { tr } from '../i18n';
import { ModalPanel } from './modalPanel';
import { yen } from '../../shared/sim/economy/economy';
import { FACILITY_SPECS, type Facility } from '../../shared/world/facilities';
import type { Town } from '../../shared/world/town';
import { LISTING_DAYS, askingPrice, listedFacilities, listingLeft } from '../../shared/sim/facility/listings';
import { net } from '../connection/net';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Number of items to list (too many would make the screen very long) */
const MAX_ROWS = 50;
/** Translate every time it is read, so it follows a language switch */
const SIZE_NAME = {
  get S() {
    return tr('小');
  },
  get M() {
    return tr('中');
  },
  get L() {
    return tr('大');
  },
};

/** Real estate: a list of facilities for sale that no company owns. You can jump to a place or buy at the valuation */
export class ForSalePanel extends ModalPanel {
  private pressed = false;

  constructor(
    modal: HTMLElement,
    private body: HTMLElement,
    private map: { facilities: Facility[]; towns: Town[] },
    private day: () => number,
    private cash: () => number,
    private onJump: (x: number, y: number) => void,
    private onMessage: (msg: string) => void,
  ) {
    super(modal, 2000);
    modal.querySelector('#saleClose')?.addEventListener('click', () => this.close());
    modal.addEventListener('pointerdown', () => (this.pressed = true));
    window.addEventListener('pointerup', () => setTimeout(() => (this.pressed = false), 0));
    window.addEventListener('pointercancel', () => (this.pressed = false));
    modal.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === modal) return this.close();
      const j = t.closest<HTMLElement>('[data-jx]');
      if (j) {
        this.onJump(Number(j.dataset.jx), Number(j.dataset.jy));
        return this.close();
      }
      const b = t.closest<HTMLElement>('[data-buy]');
      if (b) void net.cmd({ t: 'fin', op: 'acquire', id: Number(b.dataset.buy) }).then((r) => this.onMessage(r.msg ?? (r.ok ? tr('購入しました') : tr('失敗しました'))));
    });
  }

  /** The town nearest the property (a guide to its location) */
  private nearestTown(f: Facility): Town | undefined {
    let best: Town | undefined;
    let bd = Infinity;
    for (const t of this.map.towns) {
      const d = Math.hypot(t.x - f.x0, t.y - f.y0);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  protected render(): void {
    if (this.pressed) return;
    const day = this.day();
    const cash = this.cash();
    const all = listedFacilities(this.map).sort((a, b) => listingLeft(a, day) - listingLeft(b, day) || askingPrice(a) - askingPrice(b));
    const list = all.slice(0, MAX_ROWS);
    let h = `<div class="muted">${tr('どの会社も持っていない売り出し中の施設です。評価額で購入できます。売却された施設や、街が建てた施設が並びます。')}<b>${tr('{LISTING_DAYS}日間', { LISTING_DAYS })}</b>${tr('買い手がつかないと、取り壊されて更地に戻ります。(現金 {cash})', { cash: yen(cash) })}</div>`;
    h += list.length
      ? `<table><tr><th>${tr('物件')}</th><th>${tr('大きさ')}</th><th>${tr('場所')}</th><th>${tr('売上/日')}</th><th>${tr('価格')}</th><th>${tr('残り')}</th><th></th></tr>${list
          .map((f) => {
            const spec = FACILITY_SPECS[f.type];
            const price = askingPrice(f);
            const left = listingLeft(f, day);
            const town = this.nearestTown(f);
            return `<tr><td>${spec.icon} <a href="#" data-jx="${f.x0}" data-jy="${f.y0}" title="${tr('この場所へ移動')}">${esc(f.name)}</a></td><td>${f.size ? SIZE_NAME[f.size] : '-'}(${f.w}×${f.h})</td><td>${town ? esc(town.name) + tr('付近') : '-'}</td><td>${yen(f.income ?? 0)}</td><td>${yen(price)}</td><td class="${left <= 7 ? 'neg' : ''}">${tr('あと{left}日', { left })}</td><td><button data-buy="${f.id}" ${cash < price ? 'disabled' : ''}>${tr('購入')}</button></td></tr>`;
          })
          .join('')}</table>`
      : `<div>${tr('いま売り出し中の物件はありません')}</div>`;
    if (all.length > list.length)
      h += `<div class="muted">${tr('全{length}件のうち、残り日数の短い{length2}件を表示しています', { length: all.length, length2: list.length })}</div>`;
    this.body.innerHTML = h;
  }
}
