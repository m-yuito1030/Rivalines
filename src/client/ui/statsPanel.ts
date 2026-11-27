import { tr } from '../i18n';
import { ModalPanel } from './modalPanel';
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

/** Statistics modal: passengers carried and load factor per route, and a town list (population, waiting counts) */
export class StatsPanel extends ModalPanel {
  constructor(
    modal: HTMLElement,
    private body: HTMLElement,
    private transit: Transit,
    private towns: () => Town[],
    private rating: () => RatingState,
    private migrated: () => number = () => 0,
  ) {
    super(modal, 1000);
    modal.querySelector('#statsClose')?.addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => e.target === modal && this.close());
  }

  protected render(): void {
    const rs = routeStats(this.transit).sort((a, b) => b.carried - a.carried);
    const ts = townStats(this.transit, this.towns()).sort((a, b) => b.pop - a.pop);
    const totalPop = ts.reduce((s, t) => s + t.pop, 0);
    let h = `<div>${tr('総人口')} <b>${totalPop}</b> ${tr('/ 街 {length} / 停留所 {length2} / 車両 {length3} / 輸送', { length: ts.length, length2: [...this.transit.stops.values()].filter((s) => !s.waypoint).length, length3: this.transit.vehicles.length })} <b>${Math.floor(this.transit.delivered)}</b>${tr('人 / 乗換 {this}人', { this: Math.floor(this.transit.transfers) })}</div>`;
    const rt = this.rating();
    const bar = (label: string, v: number) =>
      `<div class="rbar"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i><span>${Math.round(v * 100)}</span></div>`;
    h += `<h3>${tr('会社の評価:')} <span class="${rt.locked ? 'bad' : ''}">${tr('{score} ({rt}点)', { score: tr(ratingName(rt.score)), rt: Math.round(rt.score) })}</span>${rt.locked ? tr(' ・ 新規の開発ができません') : ''}</h3>`;
    h +=
      bar(tr('運行範囲(人口カバー率)'), rt.parts.coverage) +
      bar(tr('待ち人数の少なさ'), rt.parts.waiting) +
      bar(tr('渋滞のなさ'), rt.parts.flow) +
      bar(tr('定時性'), rt.parts.punctual);
    h += `<div>${tr('移住した人:')} <b>${Math.floor(this.migrated())}</b>${tr('人(運行が始まった地域へ)')}</div>`;
    h += `<h3>${tr('路線別')}</h3>`;
    h += rs.length
      ? `<table><tr><th>${tr('路線')}</th><th>${tr('車両')}</th><th>${tr('輸送人数')}</th><th>${tr('積載')}</th><th>${tr('停滞')}</th></tr>${rs
          .map(
            (r) =>
              `<tr><td><i style="background:${hex(r.color)}"></i>${ICON[r.mode]} ${esc(r.name)}</td><td>${r.vehicles}</td><td>${r.carried}</td><td>${r.loadPct === null ? '-' : r.loadPct + '%'}</td><td>${r.stuck}</td></tr>`,
          )
          .join('')}</table>`
      : `<div>${tr('路線がありません')}</div>`;
    h += `<h3>${tr('街の一覧')}</h3>`;
    h += `<table><tr><th>${tr('街')}</th><th>${tr('人口')}</th><th>${tr('停留所')}</th><th>${tr('待ち人数')}</th></tr>${ts
      .map((t) => `<tr><td>${esc(t.name)}</td><td>${t.pop}</td><td>${t.stops}</td><td>${t.waiting}</td></tr>`)
      .join('')}</table>`;
    this.body.innerHTML = h;
  }
}
