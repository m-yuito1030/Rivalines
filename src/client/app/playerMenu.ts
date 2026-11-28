import type { PlayerInfo } from '../../shared/protocol';
import type { Transit } from '../../shared/sim/network/transit';
import { yen } from '../../shared/sim/economy/economy';
import { net, toLoginScreen } from '../connection/net';
import { AI_KIND_LABEL, AI_STYLE_LABEL } from '../../shared/sim/economy/aiCompanies';
import { onCurrencyChange, tr } from '../i18n';
import { $, esc } from './dom';

interface Deps {
  transit: Transit;
  players: () => PlayerInfo[];
  /** Notification of a result (toast) */
  notify: (msg: string) => void;
  /** Before opening, close the other windows */
  beforeOpen: () => void;
}

/** Menu: the player list (remittances, granting access to all stations), setting your own company's name, profile, and color, and logout */
export class PlayerMenu {
  private readonly menu = $('menu');
  private readonly list = $('menuPlayers');
  private readonly color = $<HTMLInputElement>('profColor');

  constructor(private readonly d: Deps) {
    $('profSave').addEventListener('click', () => {
      void net
        .profile($<HTMLInputElement>('profCompany').value, $<HTMLTextAreaElement>('profBio').value, parseInt(this.color.value.slice(1), 16))
        .then((r) => d.notify(r.msg ?? (r.ok ? tr('保存しました') : tr('失敗しました'))));
    });
    $('menuBtn').addEventListener('click', () => this.open());
    onCurrencyChange(() => !this.menu.hidden && this.renderList());
    $('menuX').addEventListener('click', () => (this.menu.hidden = true));
    window.addEventListener('keydown', (e) => e.key === 'Escape' && !this.menu.hidden && (this.menu.hidden = true));
    this.list.addEventListener('change', (e) => {
      const cb = e.target as HTMLInputElement;
      if (cb.dataset.cgrant) void net.cmd({ t: 'companyAllow', who: Number(cb.dataset.cgrant), allow: cb.checked }).then((r) => r.msg && d.notify(r.msg));
    });
    this.list.addEventListener('click', (e) => {
      const rep = (e.target as HTMLElement).closest<HTMLElement>('[data-report]');
      if (rep) {
        const why = window.prompt(tr('通報する理由(200文字まで)。運営だけが見ます'), '');
        if (why) void net.report(Number(rep.dataset.report), why).then((r) => d.notify(r.msg ?? (r.ok ? tr('通報しました') : tr('失敗しました'))));
        return;
      }
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-gift]');
      if (!b) return;
      const v = window.prompt(tr('送金額(円)。10,000円以上'), '1000000');
      if (v)
        void net
          .cmd({ t: 'gift', to: Number(b.dataset.gift), amount: Number(v.replace(/[,，]/g, '')) })
          .then((r) => d.notify(r.msg ?? (r.ok ? tr('送金しました') : tr('失敗しました'))));
    });
    const pw = () => $<HTMLInputElement>('accPw').value;
    $('accChange').addEventListener('click', () => {
      void net.account('password', net.you, pw(), $<HTMLInputElement>('accNewPw').value).then((r) => {
        d.notify(r.ok ? tr('パスワードを変更しました(ほかの端末は、ログインし直しが必要です)') : r.reason ? tr(r.reason) : tr('失敗しました'));
        if (r.ok) $<HTMLInputElement>('accNewPw').value = $<HTMLInputElement>('accPw').value = '';
      });
    });
    $('accLeave').addEventListener('click', () => {
      if (!window.confirm(tr('本当に退会しますか?アカウントと会社が消え、元に戻せません。'))) return;
      void net.account('leave', net.you, pw()).then((r) => {
        if (!r.ok) return d.notify(r.reason ? tr(r.reason) : tr('失敗しました'));
        alert(tr('退会しました。ご利用ありがとうございました'));
        toLoginScreen();
      });
    });
    $('logoutBtn').addEventListener('click', () => {
      net.logout();
      toLoginScreen();
    });
  }

  /** Close the menu */
  close(): void {
    this.menu.hidden = true;
  }

  open(): void {
    this.d.beforeOpen();
    this.renderList();
    this.fillProfile();
    this.menu.hidden = false;
  }

  /** The list of players. Redrawn when the display currency changes, because it shows market caps */
  private renderList(): void {
    const grants = this.d.transit.grants.get(net.id);
    this.list.innerHTML = this.d
      .players()
      .map(
        (p) =>
          `<div class="im"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#${p.color.toString(16).padStart(6, '0')}"></i> ${p.online ? '🟢' : '⚪'} ${esc(p.company)}${p.ai ? '' : `<small class="muted"> (${esc(p.name)})</small>`} ・ ${tr('時価総額')} ${yen(p.marketCap)}${p.bio ? `<div class="muted">${esc(p.bio)}</div>` : ''}${p.id === net.id ? ` ${tr('(あなた)')}` : p.ai ? ` <span class="muted">${tr('(コンピューターが運営)')} ${tr(AI_KIND_LABEL[p.ai.kind])}・${tr(AI_STYLE_LABEL[p.ai.style])}</span>` : ` <button data-gift="${p.id}">${tr('送金')}</button> <button data-report="${p.id}" title="${tr('迷惑行為・不適切な名前や文章などを運営に知らせます')}">${tr('通報')}</button> <label class="muted" title="${tr('自社の全停留所をこの会社の路線が使えるようにします')}"><input type="checkbox" data-cgrant="${p.id}" ${grants?.has(p.id) ? 'checked' : ''}> ${tr('全駅を許可')}</label>`}</div>`,
      )
      .join('');
  }

  private fillProfile(): void {
    const me = this.d.players().find((p) => p.id === net.id);
    if (!me) return;
    $<HTMLInputElement>('profCompany').value = me.company === me.name ? '' : me.company;
    $<HTMLTextAreaElement>('profBio').value = me.bio;
    this.color.value = `#${me.color.toString(16).padStart(6, '0')}`;
  }
}
