import { type CompanyRow, routeRanking, stopRanking, townRanking } from '../../shared/sim/economy/ranking';
import { yen } from '../../shared/sim/economy/economy';
import type { GameMap } from '../../shared/world/gameMap';
import type { Transit } from '../../shared/sim/network/transit';
import { type WeeklyState, standings, winners } from '../../shared/sim/economy/weekly';
import type { PlayerInfo } from '../../shared/protocol';
import { net } from '../connection/net';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ICON = { road: '🚌', rail: '🚆', air: '✈' } as const;
const TABS = [
  ['company', '🏢 会社'],
  ['week', '📅 週間'],
  ['town', '🏘 街'],
  ['stop', '🚏 駅・停留所'],
  ['route', '🛤 路線'],
] as const;
type Tab = (typeof TABS)[number][0];

/** ランキング画面: 会社(時価総額)・街(人口)・駅/停留所(乗降人数)・路線(利益) */
export class RankingPanel {
  private tab: Tab = 'company';
  private timer = 0;
  private pressed = false;
  constructor(
    private modal: HTMLElement,
    private body: HTMLElement,
    private companyRows: () => CompanyRow[],
    private map: GameMap,
    private transit: Transit,
    private weekly: () => WeeklyState = () => ({ week: 1, base: [] }),
    private players: () => PlayerInfo[] = () => [],
  ) {
    modal.querySelector('#rankClose')?.addEventListener('click', () => this.close());
    modal.addEventListener('pointerdown', () => (this.pressed = true));
    window.addEventListener('pointerup', () => setTimeout(() => (this.pressed = false), 0));
    window.addEventListener('pointercancel', () => (this.pressed = false));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) return this.close();
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (t) {
        this.tab = t.dataset.tab as Tab;
        this.last = '';
        this.render();
      }
    });
  }

  get isOpen(): boolean {
    return !this.modal.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.modal.hidden = false;
    this.render();
    this.timer = window.setInterval(() => this.render(), 2000);
  }

  close(): void {
    this.modal.hidden = true;
    clearInterval(this.timer);
  }

  private medal(i: number): string {
    return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
  }

  private render(): void {
    if (this.pressed) return;
    let h = `<div class="rtabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === this.tab ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (this.tab === 'company') {
      const rows: CompanyRow[] = this.companyRows();
      h += `<table><tr><th>順位</th><th>会社</th><th>時価総額</th><th>株価</th><th>純資産</th><th>利益/日</th><th>旅客数</th></tr>${rows
        .map((r, i) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${this.medal(i)}</td><td>${esc(r.name)}</td><td>${yen(r.marketCap)}</td><td>${yen(r.price)}</td><td>${yen(r.netWorth)}</td><td>${yen(r.profit)}</td><td>${r.passengers}</td></tr>`)
        .join('')}</table><div class="muted">時価総額=株価×発行済み株式数。競合会社は経営画面(F)から買収できます(買収すると傘下に入り、この表から外れて自社の資産になります)。</div>`;
    } else if (this.tab === 'week') {
      const ws = this.weekly();
      const ps = this.players();
      const nameOf = (id: number) => esc(ps.find((p) => p.id === id)?.name ?? `会社${id}`);
      const rows = standings(ws, ps);
      h += `<div class="muted">第${ws.week}週(7日ごとに結果を残して数え直します)。週の初めからの増加分で競います。</div>`;
      h += rows.length
        ? `<table><tr><th>順位</th><th>会社</th><th>純資産の増加</th><th>旅客数</th><th>利益</th></tr>${rows
            .map((r, i) => `<tr class="${r.id === net.id ? 'me' : ''}"><td>${this.medal(i)}</td><td>${esc(r.name)}</td><td class="${r.d.nw < 0 ? 'neg' : ''}">${yen(r.d.nw)}</td><td>${r.d.pax}</td><td class="${r.d.profit < 0 ? 'neg' : ''}">${yen(r.d.profit)}</td></tr>`)
            .join('')}</table>`
        : '<div class="muted">まだデータがありません</div>';
      if (ws.last) {
        const w = winners(ws.last);
        const who = (id?: number) => (id === undefined ? '-' : id === net.id ? '<b>自社</b>' : nameOf(id));
        h += `<h3>先週(第${ws.last.week}週)の結果</h3><div>🥇 純資産の増加: ${who(w.nw)} / 旅客数: ${who(w.pax)} / 利益: ${who(w.profit)}</div>`;
      }
    } else if (this.tab === 'town') {
      const rows = townRanking(this.map, this.transit);
      h += `<table><tr><th>順位</th><th>街</th><th>人口</th><th>停留所</th><th>待ち人数</th></tr>${rows
        .slice(0, 30)
        .map((r, i) => `<tr><td>${this.medal(i)}</td><td>${esc(r.name)}</td><td>${r.pop}</td><td>${r.stops}</td><td>${r.waiting}</td></tr>`)
        .join('')}</table>`;
    } else if (this.tab === 'stop') {
      const rows = stopRanking(this.transit);
      h += rows.length
        ? `<table><tr><th>順位</th><th>停留所</th><th>乗降人数(累計)</th><th>待ち人数</th></tr>${rows
            .slice(0, 30)
            .map((r, i) => `<tr><td>${this.medal(i)}</td><td>${ICON[r.kind]} ${esc(r.name)}</td><td>${r.traffic}</td><td>${r.waiting}</td></tr>`)
            .join('')}</table>`
        : '<div class="muted">停留所がありません</div>';
    } else {
      const rows = routeRanking(this.transit);
      h += rows.length
        ? `<table><tr><th>順位</th><th>路線</th><th>利益/日</th><th>収入/日</th><th>輸送人数</th><th>車両</th></tr>${rows
            .slice(0, 30)
            .map((r, i) => `<tr><td>${this.medal(i)}</td><td>${ICON[r.mode]} ${esc(r.name)}</td><td class="${r.profit < 0 ? 'neg' : ''}">${yen(r.profit)}</td><td>${yen(r.income)}</td><td>${r.carried}</td><td>${r.vehicles}</td></tr>`)
            .join('')}</table><div class="muted">利益=運賃収入 − 車両の運行費。1日が終わるごとに更新されます。</div>`
        : '<div class="muted">路線がありません</div>';
    }
    if (h !== this.last) {
      this.last = h;
      this.body.innerHTML = h;
    }
  }

  private last = '';
}
