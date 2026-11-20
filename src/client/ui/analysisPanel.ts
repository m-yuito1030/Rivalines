import { ModalPanel } from './modalPanel';
import type { Transit } from '../../shared/sim/network/transit';
import type { Facility } from '../../shared/world/facilities';
import { yen } from '../../shared/sim/economy/economy';
import { net } from '../connection/net';
import { DEV } from '../../shared/sim/economy/development';
import { devRows, facilityEcon, routeEcon, stopEcon, summarize } from '../../shared/sim/economy/analysis';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const ICON = { road: '🚌', rail: '🚆', air: '✈' } as const;
const cls = (n: number) => (n < 0 ? 'neg' : '');

/** 経営分析: 自社の路線・停留所・施設の採算と混雑を、悪い順に並べる */
export class AnalysisPanel extends ModalPanel {
  /** ボタンを押している間は再描画しない(クリック直前に要素が入れ替わるのを防ぐ) */
  private pressed = false;
  constructor(
    modal: HTMLElement,
    private body: HTMLElement,
    private transit: Transit,
    private facilities: () => Facility[],
    private onJump: (x: number, y: number) => void,
    private onMessage: (msg: string) => void = () => {},
  ) {
    super(modal, 2000);
    modal.addEventListener('pointerdown', () => (this.pressed = true));
    window.addEventListener('pointerup', () => setTimeout(() => (this.pressed = false), 0));
    window.addEventListener('pointercancel', () => (this.pressed = false));
    modal.querySelector('#anaClose')?.addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === modal) return this.close();
      const dev = t.closest<HTMLElement>('[data-dev]');
      if (dev) return void net.cmd({ t: 'develop', stopId: Number(dev.dataset.dev) }).then((r) => this.onMessage(r.msg ?? (r.ok ? '完了しました' : '失敗しました')));
      const j = t.closest<HTMLElement>('[data-jx]');
      if (j) {
        this.onJump(Number(j.dataset.jx), Number(j.dataset.jy));
        this.close();
      }
    });
  }

  protected render(): void {
    if (this.pressed) return;
    const me = net.id || undefined;
    const routes = routeEcon(this.transit, me).sort((a, b) => a.profit - b.profit);
    const stops = stopEcon(this.transit, me)
      .sort((a, b) => b.crowdPct - a.crowdPct)
      .slice(0, 15);
    const facs = facilityEcon(this.facilities(), me).sort((a, b) => a.profit - b.profit);
    const s = summarize(routes, facs);
    let h = `<div>路線の損益(1日) <b class="${cls(s.routeProfit)}">${yen(s.routeProfit)}</b> / 施設の損益(1日) <b class="${cls(s.facilityProfit)}">${yen(s.facilityProfit)}</b></div>`;
    h += `<div>赤字の路線 <b>${s.lossRoutes}</b> 本 / 車両のない路線 <b>${s.idleVehicles}</b> 本</div>`;
    h += '<h3>路線別の採算(赤字が上)</h3>';
    h += routes.length
      ? `<table><tr><th>路線</th><th>車両</th><th>運賃収入/日</th><th>運行費/日</th><th>損益/日</th><th>積載</th></tr>${routes
          .map(
            (r) =>
              `<tr><td><i style="background:${hex(r.color)}"></i>${ICON[r.mode]} ${esc(r.name)}</td><td>${r.vehicles}</td><td>${yen(r.income)}</td><td>${yen(r.running)}</td><td class="${cls(r.profit)}">${yen(r.profit)}</td><td>${r.loadPct === null ? '-' : r.loadPct + '%'}</td></tr>`,
          )
          .join('')}</table>`
      : '<div>自社の路線がありません</div>';
    h += '<h3>混雑している停留所(上位15)</h3>';
    h += stops.length
      ? `<table><tr><th>停留所</th><th>待ち人数</th><th>混雑</th><th>路線数</th></tr>${stops
          .map((p) => {
            const st = this.transit.stops.get(p.id)!;
            return `<tr><td><a href="#" data-jx="${st.x}" data-jy="${st.y}">${esc(p.name)}</a></td><td>${p.waiting}</td><td class="${p.crowdPct >= 80 ? 'neg' : ''}">${p.crowdPct}%</td><td class="${p.routes === 0 ? 'neg' : ''}">${p.routes}</td></tr>`;
          })
          .join('')}</table>`
      : '<div>自社の停留所がありません</div>';
    const dev = devRows(this.transit, me).slice(0, 15);
    h += `<h3>沿線開発(人口の多い停留所・開発度は最大${DEV.max})</h3>`;
    h += dev.length
      ? `<table><tr><th>停留所</th><th>圏人口</th><th>開発度</th><th>不動産収入/日</th><th></th></tr>${dev
          .map(
            (d) =>
              `<tr><td><a href="#" data-jx="${d.x}" data-jy="${d.y}">${esc(d.name)}</a></td><td>${d.pop}</td><td>${d.dev}</td><td>${yen(d.income)}</td><td>${d.nextCost === null ? '最高' : `<button data-dev="${d.id}" title="開発度を上げると乗客が${Math.round(DEV.demandUp * 100)}%ずつ増え、収入が+${yen(d.nextGain)}/日">開発 ${yen(d.nextCost)}</button>`}</td></tr>`,
          )
          .join('')}</table>`
      : '<div>自社の停留所がありません</div>';
    h += '<h3>施設別の収支</h3>';
    h += facs.length
      ? `<table><tr><th>施設</th><th>種類</th><th>売上/日</th><th>維持費/日</th><th>損益/日</th><th>来場(累計)</th></tr>${facs
          .map(
            (f) =>
              `<tr><td>${esc(f.name)}</td><td>${esc(f.type)}</td><td>${yen(f.income)}</td><td>${yen(f.upkeep)}</td><td class="${cls(f.profit)}">${yen(f.profit)}</td><td>${f.visits}</td></tr>`,
          )
          .join('')}</table>`
      : '<div>自社の施設がありません</div>';
    this.body.innerHTML = h;
  }
}
