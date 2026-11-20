import type { GameMap } from '../../shared/world/gameMap';
import type { Transit } from '../../shared/sim/network/transit';
import { FACILITY_SPECS } from '../../shared/world/facilities';
import { TIERS, townTier } from '../../shared/world/town';
import { RANKS } from '../../shared/sim/network/transit';
import { net } from '../connection/net';
import { modelOf } from '../../shared/data/models';
import type { MyVeh } from '../../shared/protocol';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const MAX_ITEMS = 300;

interface Item {
  name: string;
  sub: string;
  x: number;
  y: number;
}
interface Group {
  key: string;
  title: string;
  items: Item[];
}

/**
 * 一覧画面: 街(段階ごと)と、機器(駅・バス停・空港・経由点・車両基地・施設)をグループ別に並べる。
 * 項目をタップすると、その場所へ移動する。検索で名前を絞り込める。
 */
export class ListPanel {
  private tab: 'town' | 'equip' | 'veh' = 'town';
  private open = new Set<string>(['t4', 't3', 't2', 'e-rail', 'e-bus', 'e-air', 'e-way', 'd-rail', 'd-road', 'd-air']);
  private q = '';
  private mineOnly = true;
  private timer = 0;
  private last = '';

  constructor(
    private modal: HTMLElement,
    private body: HTMLElement,
    private map: GameMap,
    private transit: Transit,
    private onJump: (x: number, y: number) => void,
    private myVehicles: () => MyVeh[] = () => [],
  ) {
    modal.querySelector('#listClose')?.addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === modal) return this.close();
      const tab = t.closest<HTMLElement>('[data-ltab]');
      if (tab) {
        this.tab = tab.dataset.ltab as 'town' | 'equip' | 'veh';
        this.last = '';
        return this.render();
      }
      const jump = t.closest<HTMLElement>('[data-jx]');
      if (jump) {
        this.onJump(Number(jump.dataset.jx), Number(jump.dataset.jy));
        this.close();
        return;
      }
      const head = t.closest<HTMLElement>('[data-gk]');
      if (head) {
        const k = head.dataset.gk!;
        if (this.open.has(k)) this.open.delete(k);
        else this.open.add(k);
        this.last = '';
        this.render();
      }
    });
    modal.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.lq !== undefined) {
        this.q = t.value.trim();
        this.last = '';
        this.render(true);
      } else if (t.dataset.lmine !== undefined) {
        this.mineOnly = t.checked;
        this.last = '';
        this.render(true);
      }
    });
  }

  get isOpen(): boolean {
    return !this.modal.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.show();
  }

  show(): void {
    this.modal.hidden = false;
    this.last = '';
    this.render();
    this.timer = window.setInterval(() => this.render(), 2000);
  }

  /** ウィンドウ管理(他の画面を開くと閉じる)用の別名 */
  openWin(): void {
    this.show();
  }

  close(): void {
    this.modal.hidden = true;
    clearInterval(this.timer);
  }

  private match(s: string): boolean {
    return !this.q || s.toLowerCase().includes(this.q.toLowerCase());
  }

  private townGroups(): Group[] {
    const groups: Group[] = TIERS.map((t, i) => ({ key: `t${i}`, title: `${t.name}(人口 ${t.min.toLocaleString()}〜)`, items: [] }));
    for (const t of this.map.towns) groups[townTier(t)].items.push({ name: t.name, sub: `人口 ${Math.floor(t.pop).toLocaleString()}`, x: t.x, y: t.y });
    for (const g of groups) g.items.sort((a, b) => Number(b.sub.replace(/\D/g, '')) - Number(a.sub.replace(/\D/g, '')));
    return groups.reverse();
  }

  private equipGroups(): Group[] {
    const mine = (owner: number | undefined) => !this.mineOnly || owner === undefined || owner === net.id;
    const g = (key: string, title: string): Group => ({ key, title, items: [] });
    const rail = g('e-rail', '🚉 駅(鉄道)');
    const bus = g('e-bus', '🚏 バス停');
    const air = g('e-air', '✈ 空港');
    const way = g('e-way', '📍 経由点');
    const dRoad = g('d-road', '🏭 バス基地');
    const dRail = g('d-rail', '🏭 車両基地(鉄道)');
    const dAir = g('d-air', '🏭 格納庫(航空)');
    for (const s of this.transit.stops.values()) {
      if (!mine(s.owner)) continue;
      const sub = s.waypoint ? '' : `待ち${Math.floor(s.waiting)}人${s.station ? ` ・ ${s.station.tracks}番線` : ''}`;
      const it = { name: s.name, sub, x: s.x, y: s.y };
      (s.waypoint ? way : s.kind === 'rail' ? rail : s.kind === 'road' ? bus : air).items.push(it);
    }
    for (const d of this.transit.depots.values()) {
      if (!mine(d.owner)) continue;
      (d.kind === 'road' ? dRoad : d.kind === 'rail' ? dRail : dAir).items.push({ name: d.name, sub: '', x: d.x, y: d.y });
    }
    const facG = new Map<string, Group>();
    for (const f of this.map.facilities) {
      const spec = FACILITY_SPECS[f.type];
      const own = (f.owner ?? 'player') === 'player' ? (f.playerId === net.id ? '自社' : '他のプレイヤー') : f.owner === 'public' ? '公共' : '民間';
      if (this.mineOnly && !((f.owner ?? 'player') === 'player' && f.playerId === net.id)) continue; // 自社のみ: 民間・公共・他のプレイヤーの施設は出さない
      let grp = facG.get(f.type);
      if (!grp) facG.set(f.type, (grp = g(`f-${f.type}`, `${spec.icon} ${spec.name}`)));
      grp.items.push({ name: f.name, sub: own, x: f.x0, y: f.y0 });
    }
    const facs = [...facG.values()].sort((a, b) => b.items.length - a.items.length);
    return [rail, bus, air, way, dRail, dRoad, dAir, ...facs];
  }

  /** 車両: 路線ごと(自社の全車両。視界の外も含む)。タップで現在位置へ */
  private vehGroups(): Group[] {
    const by = new Map<number, Group>();
    const ST = ['走行中', '停車中', '経路なし', '待機'];
    for (const [id, routeId, modelId, mode, x, y, st, pct, cars] of this.myVehicles()) {
      let g = by.get(routeId);
      if (!g) {
        const r = this.transit.routes.get(routeId);
        by.set(
          routeId,
          (g = {
            key: `v${routeId}`,
            title: `${{ road: '🚌', rail: '🚆', air: '✈' }[mode]} ${r?.name ?? `路線${routeId}`}${r?.rank ? ` [${RANKS[r.rank].name}]` : ''}`,
            items: [],
          }),
        );
      }
      g.items.push({ name: `#${id} ${modelOf(modelId).name}${mode === 'rail' ? ` ${cars}両` : ''}`, sub: `${ST[st] ?? ''} ・ 積載${pct}%`, x, y });
    }
    return [...by.values()].sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  }

  render(force = false): void {
    const groups = this.tab === 'town' ? this.townGroups() : this.tab === 'equip' ? this.equipGroups() : this.vehGroups();
    let html = `<div class="ltabs"><button data-ltab="town" class="${this.tab === 'town' ? 'on' : ''}">🏘 街 (${this.map.towns.length})</button><button data-ltab="equip" class="${this.tab === 'equip' ? 'on' : ''}">🧰 機器・施設</button><button data-ltab="veh" class="${this.tab === 'veh' ? 'on' : ''}">🚆 車両 (${this.myVehicles().length})</button>`;
    html += `<input data-lq placeholder="名前で検索" value="${esc(this.q)}" style="margin-left:auto;width:11em">`;
    if (this.tab === 'equip') html += `<label class="muted"><input type="checkbox" data-lmine ${this.mineOnly ? 'checked' : ''}> 自社のみ</label>`;
    html += '</div>';
    for (const gr of groups) {
      const shown = gr.items.filter((i) => this.match(i.name));
      if (!shown.length) continue; // 空のグループは出さない
      const isOpen = this.open.has(gr.key) || (!!this.q && shown.length > 0);
      html += `<div class="lgroup"><button class="lhead" data-gk="${gr.key}">${isOpen ? '▼' : '▶'} ${esc(gr.title)} <em>${shown.length}</em></button>`;
      if (isOpen) {
        html += '<div class="litems">';
        for (const it of shown.slice(0, MAX_ITEMS))
          html += `<button class="litem" data-jx="${it.x}" data-jy="${it.y}"><span>${esc(it.name)}</span><em>${esc(it.sub)}</em></button>`;
        if (shown.length > MAX_ITEMS) html += `<div class="muted">ほか ${shown.length - MAX_ITEMS} 件(検索で絞り込めます)</div>`;
        html += '</div>';
      }
      html += '</div>';
    }
    if (html === this.last && !force) return;
    // 検索中の入力欄を壊さないよう、入力欄にフォーカスがあるときは一覧部分だけ差し替える
    const active = document.activeElement;
    if (active && (active as HTMLElement).dataset?.lq !== undefined && this.body.contains(active)) {
      const list = this.body.querySelector('.llist');
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      tmp.querySelector('.ltabs')?.remove();
      if (list) list.innerHTML = tmp.innerHTML;
      this.last = html;
      return;
    }
    this.last = html;
    const tabsEnd = html.indexOf('</div>') + 6;
    this.body.innerHTML = html.slice(0, tabsEnd) + `<div class="llist">${html.slice(tabsEnd)}</div>`;
  }
}
