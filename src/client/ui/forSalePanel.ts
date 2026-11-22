import { ModalPanel } from './modalPanel';
import { yen } from '../../shared/sim/economy/economy';
import { FACILITY_SPECS, type Facility } from '../../shared/world/facilities';
import type { Town } from '../../shared/world/town';
import { LISTING_DAYS, askingPrice, listedFacilities, listingLeft } from '../../shared/sim/facility/listings';
import { net } from '../connection/net';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** 一覧に出す件数(多すぎると、画面が縦に長くなる) */
const MAX_ROWS = 50;
const SIZE_NAME = { S: '小', M: '中', L: '大' } as const;

/** 不動産物件: どの会社も持っていない売り出し中の施設の一覧。場所へ移動したり、評価額で購入したりできる */
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
      if (b) void net.cmd({ t: 'fin', op: 'acquire', id: Number(b.dataset.buy) }).then((r) => this.onMessage(r.msg ?? (r.ok ? '購入しました' : '失敗しました')));
    });
  }

  /** 物件に最も近い街(場所の目安) */
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
    let h = `<div class="muted">どの会社も持っていない売り出し中の施設です。評価額で購入できます。売却された施設や、街が建てた施設が並びます。<b>${LISTING_DAYS}日間</b>買い手がつかないと、取り壊されて更地に戻ります。(現金 ${yen(cash)})</div>`;
    h += list.length
      ? `<table><tr><th>物件</th><th>大きさ</th><th>場所</th><th>売上/日</th><th>価格</th><th>残り</th><th></th></tr>${list
          .map((f) => {
            const spec = FACILITY_SPECS[f.type];
            const price = askingPrice(f);
            const left = listingLeft(f, day);
            const town = this.nearestTown(f);
            return `<tr><td>${spec.icon} <a href="#" data-jx="${f.x0}" data-jy="${f.y0}" title="この場所へ移動">${esc(f.name)}</a></td><td>${f.size ? SIZE_NAME[f.size] : '-'}(${f.w}×${f.h})</td><td>${town ? esc(town.name) + '付近' : '-'}</td><td>${yen(f.income ?? 0)}</td><td>${yen(price)}</td><td class="${left <= 7 ? 'neg' : ''}">あと${left}日</td><td><button data-buy="${f.id}" ${cash < price ? 'disabled' : ''}>購入</button></td></tr>`;
          })
          .join('')}</table>`
      : '<div>いま売り出し中の物件はありません</div>';
    if (all.length > list.length) h += `<div class="muted">全${all.length}件のうち、残り日数の短い${list.length}件を表示しています</div>`;
    this.body.innerHTML = h;
  }
}
