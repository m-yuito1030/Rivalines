import type { Mode } from '../../shared/data/models';
import type { Transit } from '../../shared/sim/network/transit';
import type { Town } from '../../shared/world/town';
import { type RatingState, ratingName } from '../../shared/sim/economy/rating';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const ICON: Record<Mode, string> = { road: '🚌', rail: '🚆', air: '✈' };

export interface RouteStat {
  id: number;
  name: string;
  color: number;
  mode: Mode;
  vehicles: number;
  carried: number;
  loadPct: number | null;
  stuck: number;
}
export interface TownStat {
  id: number;
  name: string;
  pop: number;
  waiting: number;
  stops: number;
}

export function routeStats(t: Transit): RouteStat[] {
  return [...t.routes.values()].map((r) => {
    const vs = t.vehicles.filter((v) => v.routeId === r.id);
    const cap = vs.reduce((s, v) => s + v.cap, 0);
    const load = vs.reduce((s, v) => s + v.load, 0);
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      mode: r.mode,
      vehicles: vs.length,
      carried: Math.floor(r.carried ?? 0),
      loadPct: cap ? Math.round((load / cap) * 100) : null,
      stuck: vs.filter((v) => v.stuck > 20).length,
    };
  });
}

export function townStats(t: Transit, towns: Town[]): TownStat[] {
  const by = new Map<number, TownStat>();
  for (const tw of towns) by.set(tw.id, { id: tw.id, name: tw.name, pop: tw.pop, waiting: 0, stops: 0 });
  for (const s of t.stops.values()) {
    const e = by.get(s.townId);
    if (!e) continue;
    e.waiting += Math.floor(s.waiting);
    e.stops++;
  }
  return [...by.values()];
}

/** 統計モーダル: 路線別の輸送人数・積載率、街の一覧(人口・待ち人数) */
export class StatsPanel {
  private timer = 0;
  constructor(
    private modal: HTMLElement,
    private body: HTMLElement,
    private transit: Transit,
    private towns: () => Town[],
    private rating: () => RatingState,
    private migrated: () => number = () => 0,
  ) {
    modal.querySelector('#statsClose')?.addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => e.target === modal && this.close());
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
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  close(): void {
    this.modal.hidden = true;
    clearInterval(this.timer);
  }

  private render(): void {
    const rs = routeStats(this.transit).sort((a, b) => b.carried - a.carried);
    const ts = townStats(this.transit, this.towns()).sort((a, b) => b.pop - a.pop);
    const totalPop = ts.reduce((s, t) => s + t.pop, 0);
    let h = `<div>総人口 <b>${totalPop}</b> / 街 ${ts.length} / 停留所 ${[...this.transit.stops.values()].filter((s) => !s.waypoint).length} / 車両 ${this.transit.vehicles.length} / 輸送 <b>${Math.floor(this.transit.delivered)}</b>人 / 乗換 ${Math.floor(this.transit.transfers)}人</div>`;
    const rt = this.rating();
    const bar = (label: string, v: number) =>
      `<div class="rbar"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i><span>${Math.round(v * 100)}</span></div>`;
    h += `<h3>会社の評価: <span class="${rt.locked ? 'bad' : ''}">${ratingName(rt.score)} (${Math.round(rt.score)}点)</span>${rt.locked ? ' ・ 新規の開発ができません' : ''}</h3>`;
    h += bar('運行範囲(人口カバー率)', rt.parts.coverage) + bar('待ち人数の少なさ', rt.parts.waiting) + bar('渋滞のなさ', rt.parts.flow) + bar('定時性', rt.parts.punctual);
    h += `<div>移住した人: <b>${Math.floor(this.migrated())}</b>人(運行が始まった地域へ)</div>`;
    h += '<h3>路線別</h3>';
    h += rs.length
      ? `<table><tr><th>路線</th><th>車両</th><th>輸送人数</th><th>積載</th><th>停滞</th></tr>${rs
          .map(
            (r) =>
              `<tr><td><i style="background:${hex(r.color)}"></i>${ICON[r.mode]} ${esc(r.name)}</td><td>${r.vehicles}</td><td>${r.carried}</td><td>${r.loadPct === null ? '-' : r.loadPct + '%'}</td><td>${r.stuck}</td></tr>`,
          )
          .join('')}</table>`
      : '<div>路線がありません</div>';
    h += '<h3>街の一覧</h3>';
    h += `<table><tr><th>街</th><th>人口</th><th>停留所</th><th>待ち人数</th></tr>${ts
      .map((t) => `<tr><td>${esc(t.name)}</td><td>${t.pop}</td><td>${t.stops}</td><td>${t.waiting}</td></tr>`)
      .join('')}</table>`;
    this.body.innerHTML = h;
  }
}
