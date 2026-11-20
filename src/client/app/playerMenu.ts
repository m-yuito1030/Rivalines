import type { PlayerInfo } from '../../shared/protocol';
import type { Transit } from '../../shared/sim/network/transit';
import { yen } from '../../shared/sim/economy/economy';
import { net } from '../connection/net';
import { $, esc } from './dom';

interface Deps {
  transit: Transit;
  players: () => PlayerInfo[];
  /** 結果の通知(トースト) */
  notify: (msg: string) => void;
  /** 開く前に、ほかのウィンドウを閉じる */
  beforeOpen: () => void;
}

/** メニュー: プレイヤー一覧(送金・全駅の許可)、自社の会社名・プロフィール・色の設定、ログアウト */
export class PlayerMenu {
  private readonly menu = $('menu');
  private readonly list = $('menuPlayers');
  private readonly color = $<HTMLInputElement>('profColor');

  constructor(private readonly d: Deps) {
    $('profSave').addEventListener('click', () => {
      void net
        .profile($<HTMLInputElement>('profCompany').value, $<HTMLTextAreaElement>('profBio').value, parseInt(this.color.value.slice(1), 16))
        .then((r) => d.notify(r.msg ?? (r.ok ? '保存しました' : '失敗しました')));
    });
    $('menuBtn').addEventListener('click', () => this.open());
    $('menuClose').addEventListener('click', () => (this.menu.hidden = true));
    this.list.addEventListener('change', (e) => {
      const cb = e.target as HTMLInputElement;
      if (cb.dataset.cgrant) void net.cmd({ t: 'companyAllow', who: Number(cb.dataset.cgrant), allow: cb.checked }).then((r) => r.msg && d.notify(r.msg));
    });
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-gift]');
      if (!b) return;
      const v = window.prompt('送金額(円)。10,000円以上', '1000000');
      if (v)
        void net.cmd({ t: 'gift', to: Number(b.dataset.gift), amount: Number(v.replace(/[,，]/g, '')) }).then((r) => d.notify(r.msg ?? (r.ok ? '送金しました' : '失敗しました')));
    });
    $('logoutBtn').addEventListener('click', () => {
      net.logout();
      location.reload();
    });
  }

  /** メニューを閉じる */
  close(): void {
    this.menu.hidden = true;
  }

  open(): void {
    this.d.beforeOpen();
    const grants = this.d.transit.grants.get(net.id);
    this.list.innerHTML = this.d
      .players()
      .map(
        (p) =>
          `<div class="im"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#${p.color.toString(16).padStart(6, '0')}"></i> ${p.online ? '🟢' : '⚪'} ${esc(p.company)}<small class="muted"> (${esc(p.name)})</small> ・ 時価総額 ${yen(p.marketCap)}${p.bio ? `<div class="muted">${esc(p.bio)}</div>` : ''}${p.id === net.id ? ' (あなた)' : ` <button data-gift="${p.id}">送金</button> <label class="muted" title="自社の全停留所をこの会社の路線が使えるようにします"><input type="checkbox" data-cgrant="${p.id}" ${grants?.has(p.id) ? 'checked' : ''}> 全駅を許可</label>`}</div>`,
      )
      .join('');
    this.fillProfile();
    this.menu.hidden = false;
  }

  private fillProfile(): void {
    const me = this.d.players().find((p) => p.id === net.id);
    if (!me) return;
    $<HTMLInputElement>('profCompany').value = me.company === me.name ? '' : me.company;
    $<HTMLTextAreaElement>('profBio').value = me.bio;
    this.color.value = `#${me.color.toString(16).padStart(6, '0')}`;
  }
}
