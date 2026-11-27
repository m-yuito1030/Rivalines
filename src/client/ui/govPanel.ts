import './gov.css';
import { POLICIES, STANCES, LEVY_BASE, type GovInfo, type PolicyKey } from '../../shared/sim/economy/government';
import { yen } from '../../shared/sim/economy/economy';
import { calendarOf } from '../../shared/sim/world/calendar';
import { $, esc } from '../app/dom';
import { tr } from '../i18n';

const ICON: Record<PolicyKey, string> = { normal: '🏛', austerity: '📈', taxcut: '📉', infra: '🏗', tourism: '🎡', eco: '🌿', dereg: '🔓' };

/** The government badge at the top right (the national policy in force) and a panel that explains it. Tells the player when the policy changes */
export class GovPanel {
  private readonly badge = $('gov');
  private readonly info: HTMLElement;
  private last: GovInfo | null = null;

  constructor(private readonly notify: (msg: string) => void) {
    this.info = document.createElement('div');
    this.info.id = 'govInfo';
    this.info.hidden = true;
    $('hud').appendChild(this.info);
    this.badge.addEventListener('click', () => {
      this.info.hidden = !this.info.hidden;
      this.render();
    });
    this.info.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.gx')) this.info.hidden = true;
    });
  }

  /** Call whenever the server's state may have changed (the policy is announced in a toast when it changes) */
  update(g: GovInfo | null): void {
    if (!g) return;
    const changed = !this.last || this.last.policy !== g.policy || this.last.stance !== g.stance;
    if (this.last && this.last.policy !== g.policy) this.notify(tr('今月の国策: {name}', { name: tr(POLICIES[g.policy].name) }));
    this.last = g;
    this.badge.hidden = false;
    const text = `${ICON[g.policy]} ${tr(POLICIES[g.policy].name)}`;
    if (this.badge.textContent !== text) this.badge.textContent = text;
    this.badge.className = g.size === 'large' && g.levy > 0 ? 'alert' : '';
    this.badge.title = tr('政府の国策。クリックで詳しく見られます');
    if (changed || !this.info.hidden) this.render();
  }

  private render(): void {
    const g = this.last;
    if (!g || this.info.hidden) return;
    const p = POLICIES[g.policy];
    const nx = POLICIES[g.next];
    const d = calendarOf(g.changeDay);
    const size = g.size === 'large' ? tr('大企業') : g.size === 'small' ? tr('小さい会社') : g.size === 'middle' ? tr('中堅') : tr('(会社が少ないため、課税・補助金の対象外)');
    this.info.innerHTML = `<button type="button" class="gx" title="${esc(tr('閉じる'))}">✕</button>
      <h4>🏛 ${esc(tr('政府'))}</h4>
      <div class="gp"><b>${esc(tr('今月の国策'))}</b>: ${ICON[g.policy]} ${esc(tr(p.name))}<br><span class="muted">${esc(tr(p.desc))}</span></div>
      <div class="gp"><b>${esc(tr('来月の国策'))}</b>(${esc(tr('{month}月{day}日から', { month: d.month, day: d.day }))}): ${ICON[g.next]} ${esc(tr(nx.name))}<br><span class="muted">${esc(tr(nx.desc))}</span></div>
      <div class="gp"><b>${esc(tr('今期の政権'))}</b>: ${esc(tr(STANCES[g.stance].name))}</div>
      <div class="gp"><b>${esc(tr('あなたの会社'))}</b>: ${esc(size)}${g.levy > 0 ? `<br>${esc(tr('今月末の大企業課税(見込み): {amount}', { amount: yen(g.levy) }))}` : ''}</div>
      <div class="muted">${esc(tr('国庫: {amount}。大企業(純資産の上位3分の1)が毎月 純資産の約{rate}%を納め、小さい会社(下位の半分)に配られます。', { amount: yen(g.treasury), rate: (LEVY_BASE * 100).toFixed(1) }))}</div>`;
  }
}
