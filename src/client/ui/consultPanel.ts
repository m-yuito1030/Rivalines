import { tr } from '../i18n';
import { ModalPanel } from './modalPanel';
import { type Company, yen } from '../../shared/sim/economy/economy';
import { CONSULT, type Tip, consultTips } from '../../shared/sim/economy/consult';
import type { Rival } from '../../shared/sim/economy/rivals';
import type { Facility } from '../../shared/world/facilities';
import type { Town } from '../../shared/world/town';
import type { Transit } from '../../shared/sim/network/transit';
import { net } from '../connection/net';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The words of one piece of advice (translated every time it is drawn, so it follows a language switch) */
function words(t: Tip): string {
  const p = t.p;
  const n = esc(String(p.name ?? ''));
  switch (t.kind) {
    case 'start':
      return tr('まだ路線がありません。まず、人の多い街に停留所を2つ作り、バスを走らせてみましょう。左のツールの「バス停」と「道路」を使い、路線を作って車両を買います。');
    case 'cash':
      return tr('現金が少なくなっています({cash})。借入(経営画面)を使うか、赤字の路線を見直しましょう。', { cash: yen(Number(p.cash)) });
    case 'staff':
      return tr('従業員が足りません(必要 {need}人・いま {have}人)。動きが {pct}% に落ちています。経営画面で採用費と広告費の予算を上げましょう。', {
        need: p.need,
        have: p.have,
        pct: p.pct,
      });
    case 'property':
      return tr('優良物件: {name}。価格 {price}、売上 {income}/日で、約{days}日で元が取れます(あと{left}日で取り壊し)。', {
        name: n,
        price: yen(Number(p.price)),
        income: yen(Number(p.income)),
        days: p.days,
        left: p.left,
      });
    case 'rival':
      return tr('買収の候補: {name}。買収額 {price}、利益 {profit}/日で、約{days}日で元が取れます。', {
        name: n,
        price: yen(Number(p.price)),
        profit: yen(Number(p.profit)),
        days: p.days,
      });
    case 'lossRoute':
      return tr('赤字の路線: {name}(1日 {loss} の赤字・乗車率 {load}%)。便を減らすか、行き先や運賃を見直しましょう。', { name: n, loss: yen(Number(p.loss)), load: p.load });
    case 'idleRoute':
      return tr('車両のない路線: {name}。車両を買うか、使わないなら消しましょう。', { name: n });
    case 'crowd':
      return tr('混雑している停留所: {name}(待ち客 {pct}%)。車両を増やすか、路線を足しましょう。', { name: n, pct: p.pct });
    case 'town':
      return tr('交通のない街: {name}(人口 {pop})。近くに停留所を作ると、乗客が見込めます。', { name: n, pop: p.pop });
    case 'dev':
      return tr('沿線開発のおすすめ: {name}。開発費 {cost} で、不動産収入が {gain}/日 増え、約{days}日で元が取れます。', {
        name: n,
        cost: yen(Number(p.cost)),
        gain: yen(Number(p.gain)),
        days: p.days,
      });
    case 'loan':
      return tr('借入が {loan} あり、現金に余裕があります。利息を減らすため、返済を考えましょう。', { loan: yen(Number(p.loan)) });
    case 'train':
      return tr('従業員の研修をまだしていません。研修すると、運行費が下がり、乗客が増えます。');
  }
}

/** The consultant: for a fee every month, it points out good properties, companies to buy, and what to fix, most important first */
export class ConsultPanel extends ModalPanel {
  private pressed = false;

  constructor(
    modal: HTMLElement,
    private body: HTMLElement,
    private company: () => Company,
    private facilities: () => Facility[],
    private towns: () => Town[],
    private transit: Transit,
    private rivals: () => Rival[],
    private day: () => number,
    private onJump: (x: number, y: number) => void,
    private onMessage: (msg: string) => void,
  ) {
    super(modal, 2000);
    modal.querySelector('#consultClose')?.addEventListener('click', () => this.close());
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
      const b = t.closest<HTMLElement>('[data-cmd]');
      if (!b) return;
      const op = b.dataset.cmd as 'consult-on' | 'consult-off' | 'acquire' | 'rival-buy';
      void net.cmd({ t: 'fin', op, id: b.dataset.id ? Number(b.dataset.id) : undefined }).then((r) => this.onMessage(r.msg ?? (r.ok ? tr('完了しました') : tr('失敗しました'))));
    });
  }

  protected render(): void {
    if (this.pressed) return;
    const c = this.company();
    const fee = yen(CONSULT.fee);
    let h = `<div class="muted">${tr('{days}日ごとに {fee} を払うと、いま何をすればよいかを、重要な順に教えてくれます(優良物件・買収の候補・赤字の路線・混雑・交通のない街・沿線開発など)。いつでも解約できます。', { days: CONSULT.days, fee })}</div>`;
    if (!c.consult) {
      h += `<div class="frow"><button data-cmd="consult-on" ${c.cash < CONSULT.fee ? 'disabled' : ''}>${tr('契約する(初回 {fee})', { fee })}</button><span class="muted"> ${tr('現金 {cash}', { cash: yen(c.cash) })}</span></div>`;
      this.body.innerHTML = h;
      return;
    }
    const left = Math.max(0, c.consult.next - this.day());
    h += `<div class="frow">${tr('契約中(次の支払いは {left}日後・{fee})', { left, fee })} <button data-cmd="consult-off">${tr('解約する')}</button></div>`;
    const tips = consultTips({
      facilities: this.facilities(),
      towns: this.towns(),
      transit: this.transit,
      company: c,
      rivals: this.rivals(),
      day: this.day(),
      ownerId: net.id || undefined,
    });
    h += tips.length
      ? `<table><tr><th>${tr('おすすめ')}</th><th></th></tr>${tips
          .map((t, i) => {
            const go = t.x !== undefined && t.y !== undefined ? `<button data-jx="${t.x}" data-jy="${t.y}">${tr('場所へ')}</button>` : '';
            const buy =
              t.buy !== undefined
                ? `<button data-cmd="acquire" data-id="${t.buy}" ${t.p.afford ? '' : 'disabled'}>${tr('購入')}</button>`
                : t.kind === 'rival'
                  ? `<button data-cmd="rival-buy" data-id="${t.p.id}" ${t.p.afford ? '' : 'disabled'}>${tr('買収')}</button>`
                  : '';
            return `<tr><td>${i + 1}. ${words(t)}</td><td>${go} ${buy}</td></tr>`;
          })
          .join('')}</table>`
      : `<div>${tr('いまのところ、特におすすめはありません。順調です。')}</div>`;
    this.body.innerHTML = h;
  }
}
