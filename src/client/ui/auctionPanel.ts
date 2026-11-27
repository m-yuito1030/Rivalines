import { tr } from '../i18n';
import { ModalPanel } from './modalPanel';
import type { AuctionState, Lot } from '../../shared/sim/economy/auctions';
import { yen } from '../../shared/sim/economy/economy';
import { FACILITY_SPECS } from '../../shared/world/facilities';
import type { Town } from '../../shared/world/town';
import type { PlayerInfo } from '../../shared/protocol';
import { net } from '../connection/net';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Auctions: bidding for monopoly rights per town. Only the winning company may build that kind of facility within the town's area */
export class AuctionPanel extends ModalPanel {
  private pressed = false;
  /** The bid amount input (in 10,000 yen). Kept across redraws */
  private inputs = new Map<number, string>();

  constructor(
    modal: HTMLElement,
    private body: HTMLElement,
    private state: () => AuctionState,
    private towns: () => Town[],
    private players: () => PlayerInfo[],
    private onJump: (x: number, y: number) => void,
    private onMessage: (msg: string) => void,
  ) {
    super(modal, 2000);
    modal.querySelector('#aucClose')?.addEventListener('click', () => this.close());
    modal.addEventListener('pointerdown', () => (this.pressed = true));
    window.addEventListener('pointerup', () => setTimeout(() => (this.pressed = false), 0));
    window.addEventListener('pointercancel', () => (this.pressed = false));
    modal.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.lotin) this.inputs.set(Number(el.dataset.lotin), el.value);
    });
    modal.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === modal) return this.close();
      const j = t.closest<HTMLElement>('[data-jx]');
      if (j) {
        this.onJump(Number(j.dataset.jx), Number(j.dataset.jy));
        return this.close();
      }
      const b = t.closest<HTMLElement>('[data-bid]');
      if (b) {
        const id = Number(b.dataset.bid);
        const typed = Number(this.inputs.get(id));
        const amount = Number.isFinite(typed) && typed > 0 ? Math.round(typed * 10_000) : Number(b.dataset.min);
        void net.cmd({ t: 'bid', lotId: id, amount }).then((r) => this.onMessage(r.msg ?? (r.ok ? tr('入札しました') : tr('失敗しました'))));
      }
    });
  }

  protected render(): void {
    if (this.pressed || (this.body.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT')) return;
    const st = this.state();
    const towns = this.towns();
    const ps = this.players();
    const nameOf = (id: number) => esc(ps.find((p) => p.id === id)?.name ?? tr('会社{id}', { id }));
    const townOf = (id: number) => towns[id - 1];
    const townLink = (id: number) => {
      const t = townOf(id);
      return t ? `<a href="#" data-jx="${t.x}" data-jy="${t.y}">${esc(t.name)}</a>` : tr('街{id}', { id });
    };
    const row = (l: Lot) => {
      const min = l.bid ? Math.ceil((l.bid.amount * 1.05) / 10_000) * 10_000 : l.minBid;
      const mine = l.bid?.who === net.id;
      return `<tr><td>${townLink(l.townId)}</td><td>${FACILITY_SPECS[l.type].icon} ${FACILITY_SPECS[l.type].name}</td><td>${l.bid ? `${yen(l.bid.amount)}(${mine ? `<b>${tr('自社')}</b>` : nameOf(l.bid.who)})` : tr('入札なし')}</td><td>${yen(min)}</td><td>${tr('あと{left}日', { left: l.left })}</td><td>${mine ? tr('最高額') : `<input type="number" data-lotin="${l.id}" min="${Math.ceil(min / 10_000)}" step="1" value="${this.inputs.get(l.id) ?? Math.ceil(min / 10_000)}" style="width:80px">${tr('万円')} <button data-bid="${l.id}" data-min="${min}">${tr('入札')}</button>`}</td></tr>`;
    };
    let h = `<div class="muted">${tr('街ごとの独占権を競りにかけます。落札すると、その街の範囲(街の規模で決まる半径)に、その種類の施設を建てられるのは自社だけになります。入札額は落札した時点で支払います(現金が足りないと流札)。')}</div>`;
    h += `<h3>${tr('開催中の競り(締め切りまで3日・2日ごとに新規)')}</h3>`;
    h += st.lots.length
      ? `<table><tr><th>${tr('街')}</th><th>${tr('独占権')}</th><th>${tr('現在の最高額')}</th><th>${tr('次の最低額')}</th><th>${tr('残り')}</th><th>${tr('入札')}</th></tr>${st.lots.map(row).join('')}</table>`
      : `<div>${tr('開催中の競りはありません')}</div>`;
    h += `<h3>${tr('独占権を持つ会社')}</h3>`;
    h += st.rights.length
      ? `<table><tr><th>${tr('街')}</th><th>${tr('独占権')}</th><th>${tr('持ち主')}</th><th>${tr('落札額')}</th></tr>${st.rights.map((r) => `<tr><td>${townLink(r.townId)}</td><td>${FACILITY_SPECS[r.type].icon} ${FACILITY_SPECS[r.type].name}</td><td>${r.owner === net.id ? `<b>${tr('自社')}</b>` : nameOf(r.owner)}</td><td>${yen(r.paid)}</td></tr>`).join('')}</table>`
      : `<div>${tr('まだありません')}</div>`;
    this.body.innerHTML = h;
  }
}
