import { net } from '../multi/net';
import { TIERS, townTier } from '../world/town';
import { DAY_TICKS, type Stop, type Transit, todOf } from '../sim/transit';
import type { GameMap } from '../world/gameMap';
import { designName } from '../world/stations';
import { type Company, facilityValue, vehiclePrice, yen } from '../sim/economy';
import { FACILITY_SPECS, facilityAt } from '../world/facilities';
import { type Mode, clampCars, kindsFor, modelOf, modelsFor } from '../data/models';
import type { Town } from '../world/town';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const MODE_ICON = { road: '🚏', rail: '🚉', air: '🛫' } as const;
const hm = (tod: number) => {
  const m = Math.floor((((tod % DAY_TICKS) + DAY_TICKS) % DAY_TICKS) / DAY_TICKS * 24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
/** tick → ゲーム内の分(切り上げ) */
const mins = (t: number) => Math.ceil((t / DAY_TICKS) * 24 * 60);

export type Selection = { kind: 'vehicle'; id: number } | { kind: 'stop'; id: number } | { kind: 'town'; id: number } | { kind: 'depot'; id: number } | { kind: 'facility'; id: number };

/** タップした場所に停留所があればそれ、なければ街(建物の所属)を探す */
export function findSelection(map: GameMap, transit: Transit, x: number, y: number): Selection | null {
  const exact = transit.depotAtTile(x, y);
  if (exact) return { kind: 'depot', id: exact.id };
  let best: { s: Stop; d: number } | null = null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const s = transit.stopAtTile(x + dx, y + dy);
      if (!s) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (!best || d < best.d) best = { s, d };
    }
  }
  if (best) return { kind: 'stop', id: best.s.id };
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const dp = transit.depotAtTile(x + dx, y + dy);
    if (dp) return { kind: 'depot', id: dp.id };
  }
  const fac = facilityAt(map, x, y);
  if (fac) return { kind: 'facility', id: fac.id };
  for (let r = 0; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!map.inBounds(x + dx, y + dy)) continue;
        const o = map.owner.get(map.idx(x + dx, y + dy));
        if (o > 0 && map.towns[o - 1]) return { kind: 'town', id: o };
      }
    }
  }
  return null;
}

/** 停留所(待ち人数・発車案内)と街(人口)の情報パネル。1秒ごとに更新する */
export class InfoPanel {
  private lastParts: string[] = [];
  /** 車両の追跡(カメラが追いかける)。main が設定する */
  followId = -1;
  onFollow: (id: number) => void = () => {};
  /** ボタンを押している間は再描画しない */
  private pressed = false;
  /** 車両基地の購入フォームの選択(種類ごとに保持) */
  private buy: Partial<Record<Mode, { kind: string; modelId: string; cars: number; routeId: number }>> = {};
  private sel: Selection | null = null;
  /** 編成ごとに選んだ「切り離す両数」(1秒ごとの再描画で消えないよう保持) */
  private splitCount = new Map<number, number>();
  private timer = 0;

  constructor(
    private el: HTMLElement,
    private map: GameMap,
    private transit: Transit,
    private getTick: () => number,
    private onFocus: (x: number, y: number) => void,
    private onMessage: (msg: string) => void = () => {},
    private company: () => Company | null = () => null,
  ) {
    el.addEventListener('pointerdown', () => (this.pressed = true));
    window.addEventListener('pointerup', () => setTimeout(() => (this.pressed = false), 0));
    window.addEventListener('pointercancel', () => (this.pressed = false));
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.dataset.buy && this.sel?.kind === 'depot') {
        this.onBuyChange(t);
        return;
      }
      if (t.dataset.rename) {
        const n = (t as unknown as HTMLInputElement).value.trim();
        if (n) void net.cmd({ t: 'rename', kind: 'stop', id: Number(t.dataset.id), name: n }).then((r) => !r.ok && r.msg && this.onMessage(r.msg));
        return;
      }
      if (t.dataset.split) this.splitCount.set(Number(t.dataset.split), Number(t.value));
    });
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const fol = t.closest<HTMLElement>('[data-follow]');
      if (fol) {
        this.onFollow(Number(fol.dataset.follow));
        this.lastParts = [];
        this.render();
        return;
      }
      const act = t.closest<HTMLElement>('[data-act]');
      if (act) {
        this.trainAction(act);
        return;
      }
      if (t.closest('[data-close]')) this.close();
      else if (t.closest('[data-focus]')) {
        const b = t.closest<HTMLElement>('[data-focus]')!;
        this.onFocus(Number(b.dataset.x), Number(b.dataset.y));
      }
    });
  }

  get isOpen(): boolean {
    return this.sel !== null;
  }

  /** いま選んでいるもの(車両の経路表示の更新用) */
  get selection(): Selection | null {
    return this.sel;
  }

  show(sel: Selection): void {
    this.sel = sel;
    this.lastParts = [];
    this.el.innerHTML = '';
    this.el.hidden = false;
    this.render();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  close(): void {
    this.sel = null;
    this.el.hidden = true;
    clearInterval(this.timer);
  }

  private render(): void {
    if (!this.sel) return;
    if (this.pressed) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'SELECT' || ae.tagName === 'INPUT') && this.el.contains(ae)) return; // 選択中は再描画しない
    const parts = this.sel.kind === 'vehicle' ? this.vehicleHtml(this.sel.id) : this.sel.kind === 'stop' ? this.stopHtml(this.sel.id) : this.sel.kind === 'depot' ? this.depotHtml(this.sel.id) : this.sel.kind === 'facility' ? this.facilityHtml(this.sel.id) : this.townHtml(this.sel.id);
    if (parts === null) return this.close();
    // 部分ごとに、変わったときだけ書き換える(操作ボタンは頻繁には入れ替わらない)
    let kids = [...this.el.children] as HTMLElement[];
    if (kids.length !== parts.length) {
      this.el.innerHTML = parts.map(() => '<div></div>').join('');
      kids = [...this.el.children] as HTMLElement[];
      this.lastParts = [];
    }
    parts.forEach((h, i) => {
      if (this.lastParts[i] !== h) {
        kids[i].innerHTML = h;
        this.lastParts[i] = h;
      }
    });
  }

  private trainAction(b: HTMLElement): void {
    const vid = Number(b.dataset.v);
    const say = (p: Promise<{ ok: boolean; msg?: string }>, okMsg?: string) => void p.then((r) => this.onMessage(r.msg ?? (r.ok ? okMsg ?? '' : '失敗しました')));
    const act = b.dataset.act;
    if (act === 'buyfac' || act === 'sellfac') say(net.cmd({ t: 'fin', op: act === 'buyfac' ? 'acquire' : 'sell', id: Number(b.dataset.id) }));
    else if (act === 'buy' && this.sel?.kind === 'depot') {
      const d = this.transit.depots.get(this.sel.id);
      const st = d && this.buyState(d.kind);
      if (!d || !st) return;
      say(net.cmd({ t: 'buyVehicle', depotId: d.id, routeId: st.routeId, modelId: st.modelId, cars: st.cars }));
    } else if (act === 'rmdepot' && this.sel?.kind === 'depot') {
      void net.cmd({ t: 'tx', m: 'removeDepot', a: [this.sel.id] }).then((r) => !r.ok && r.msg && this.onMessage(r.msg));
      this.close();
      return;
    } else if (act === 'split') say(net.cmd({ t: 'tx', m: 'splitTrain', a: [vid, this.splitCount.get(vid) ?? 1] }), `編成 #${vid} を分割しました(待機中)`);
    else if (act === 'depart') say(net.cmd({ t: 'tx', m: 'departHeld', a: [vid] }), `編成 #${vid} を出発させます`);
    else if (act === 'couple') say(net.cmd({ t: 'tx', m: 'coupleTrains', a: [vid, Number(b.dataset.w)] }), `編成 #${vid} を連結しました`);
    this.lastParts = [];
  }

  /** 駅の近くに停まっている編成の分割・連結・出発の操作 */
  private trainsHtml(stopId: number): string {
    const t = this.transit;
    const trains = t.trainsNear(stopId);
    if (!trains.length) return '';
    let h = '<div class="ib"><div class="ibt">編成の操作</div>';
    for (const v of trains) {
      const r = t.routes.get(v.routeId);
      const sel = Math.min(this.splitCount.get(v.id) ?? 1, Math.max(1, v.cars - 1));
      h += `<div class="ir tr"><i style="background:${r ? hex(r.color) : '#888'}"></i><span>#${v.id} ${esc(r?.name ?? '')} ${v.cars}両${v.hold ? '(待機)' : ''}</span><span class="to">`;
      if (v.cars >= 2) {
        h += `後ろ<select data-split="${v.id}">${Array.from({ length: v.cars - 1 }, (_, i) => `<option value="${i + 1}" ${i + 1 === sel ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>両を<button data-act="split" data-v="${v.id}">分割</button>`;
      }
      h += '</span><span class="when">';
      if (v.hold) h += `<button data-act="depart" data-v="${v.id}">出発</button>`;
      h += '</span></div>';
    }
    for (let i = 0; i < trains.length; i++) {
      for (let j = i + 1; j < trains.length; j++) {
        if (t.canCouple(trains[i].id, trains[j].id)) h += `<div class="ir"><span></span><span>#${trains[i].id} と #${trains[j].id}(計${trains[i].cars + trains[j].cars}両)</span><span class="to"></span><span class="when"><button data-act="couple" data-v="${trains[i].id}" data-w="${trains[j].id}">連結</button></span></div>`;
      }
    }
    return h + '</div>';
  }

  private stopHtml(id: number): string[] | null {
    const s = this.transit.stops.get(id);
    if (!s) return null;
    const tick = this.getTick();
    const t = this.transit;
    if (s.waypoint) {
      return [`<div class="ih"><b>📍 <input data-rename="stop" data-id="${id}" type="text" maxlength="24" value="${esc(s.name)}" style="width:9em"></b><span><button data-focus data-x="${s.x}" data-y="${s.y}" title="この場所へ移動">⌖</button><button data-close>✕</button></span></div><div class="im">経由点: 路線に加えると、列車はこの線路を通ります(停車・乗降はしません)。</div>`];
    }
    const dests = [...s.wait].filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const town = this.map.towns[s.townId - 1];
    const deps = t.departures(id, tick).slice(0, 8);
    const tt = t.timetable(id, tick);
    let h = `<div class="ih"><b>${MODE_ICON[s.kind]} <input data-rename="stop" data-id="${id}" type="text" maxlength="24" value="${esc(s.name)}" style="width:9em"> <small>ID:${id}</small></b><span><button data-focus data-x="${s.x}" data-y="${s.y}" title="この場所へ移動">⌖</button><button data-close>✕</button></span></div>`;
    if (s.station) h += `<div class="im">${s.station.tracks}番線 ・ ホーム長${s.station.len}タイル ・ ${designName(s.station.design)}</div>`;
    h += `<div class="im">${town ? esc(town.name) + ' ・ ' : ''}集客圏人口 ${Math.floor(s.pop)} ・ 待ち <b>${Math.floor(s.waiting)}</b>人</div>`;
    if (dests.length) h += `<div class="im">行き先別: ${dests.map(([d, n]) => `${esc(this.transit.stops.get(d)?.name ?? '?')} ${Math.floor(n)}`).join(' / ')}</div>`;
    h += '<div class="ib"><div class="ibt">発車案内</div>';
    if (!deps.length) h += '<div class="im">この停留所に停まる路線・車両はありません</div>';
    for (const d of deps) {
      const r = t.routes.get(d.routeId);
      if (!r) continue;
      const when = d.stopped ? `停車中(発車まで${mins(d.leaveIn)}分)` : d.eta < DAY_TICKS / 24 / 12 ? '接近中' : `${hm(todOf(tick) + d.eta)} 着(あと${mins(d.eta)}分)`;
      h += `<div class="ir"><i style="background:${hex(r.color)}"></i><span>${esc(r.name)}</span><span class="to">${esc(d.toward)}行き</span><span class="when">${when}</span></div>`;
    }
    for (const x of tt) {
      const r = t.routes.get(x.routeId);
      if (r) h += `<div class="im">${esc(r.name)} 時刻表: ${x.etas.map((e) => hm(todOf(tick) + e)).join(' / ')}</div>`;
    }
    h += '</div>';
    return s.kind === 'rail' ? [h, this.trainsHtml(id)] : [h];
  }

  private buyState(mode: Mode) {
    const routes = [...this.transit.routes.values()].filter((r) => r.mode === mode);
    let st = this.buy[mode];
    const kinds = kindsFor(mode);
    if (!st) {
      const m0 = modelsFor(mode).find((m) => m.kind === kinds[0])!;
      st = this.buy[mode] = { kind: kinds[0], modelId: m0.id, cars: m0.defaultCars, routeId: routes[0]?.id ?? 0 };
    }
    if (!routes.some((r) => r.id === st!.routeId)) st.routeId = routes[0]?.id ?? 0;
    return st;
  }

  private onBuyChange(t: HTMLSelectElement | HTMLInputElement): void {
    if (this.sel?.kind !== 'depot') return;
    const d = this.transit.depots.get(this.sel.id);
    if (!d) return;
    const st = this.buyState(d.kind);
    const f = t.dataset.buy;
    if (f === 'kind') {
      const m = modelsFor(d.kind).find((x) => x.kind === t.value)!;
      st.kind = t.value;
      st.modelId = m.id;
      st.cars = m.defaultCars;
    } else if (f === 'model') {
      st.modelId = t.value;
      st.cars = modelOf(t.value).defaultCars;
    } else if (f === 'cars') st.cars = clampCars(modelOf(st.modelId), Number(t.value));
    else if (f === 'route') st.routeId = Number(t.value);
    t.blur();
    this.lastParts = [];
    this.render();
  }

  /** 車両基地: 車両の購入(種別 → 車種 → 両数 → 配属する路線) */
  private depotHtml(id: number): string[] | null {
    const d = this.transit.depots.get(id);
    if (!d) return null;
    const st = this.buyState(d.kind);
    const routes = [...this.transit.routes.values()].filter((r) => r.mode === d.kind);
    const model = modelOf(st.modelId);
    const kinds = kindsFor(d.kind).map((k) => `<option value="${esc(k)}" ${k === model.kind ? 'selected' : ''}>${esc(k)}</option>`).join('');
    const models = modelsFor(d.kind)
      .filter((m) => m.kind === model.kind)
      .map((m) => `<option value="${m.id}" ${m.id === model.id ? 'selected' : ''}>${esc(m.name)} (${d.kind === 'rail' ? `1両${m.cap}人` : `定員${m.cap}`}・速度${m.speed})</option>`)
      .join('');
    const cars = clampCars(model, st.cars);
    const carsHtml =
      d.kind !== 'rail' ? '' : model.minCars === model.maxCars ? '<div>編成: 1両(単行)</div>' : `<div>編成 <input data-buy="cars" type="number" min="${model.minCars}" max="${model.maxCars}" value="${cars}">両(${model.minCars}〜${model.maxCars})・定員${model.cap * cars}人</div>`;
    const routeOpts = routes
      .map((r) => `<option value="${r.id}" ${r.id === st.routeId ? 'selected' : ''}>${esc(r.name)}(${r.orders.length}停留所・車両${this.transit.vehicles.filter((v) => v.routeId === r.id).length})</option>`)
      .join('');
    const head = `<div class="ih"><b>🏭 ${esc(d.name)}</b><span><button data-focus data-x="${d.x}" data-y="${d.y}" title="この場所へ移動">⌖</button><button data-close>✕</button></span></div>`;
    if (!routes.length) return [head + '<div class="im">この種類の路線がありません。先に路線パネルで路線を作成してください。</div><div class="ib"><button data-act="rmdepot">基地を撤去</button></div>'];
    return [
      head +
        `<div class="im">ここから車両を購入します(代金は現金から。運行費は1日に価格の0.2%)。配属先の路線のオーダー(停留所・条件)を、その路線の車両と共有して走ります。</div>
      <div class="ib"><div class="ibt">車両を購入</div>
        <div>種別 <select data-buy="kind">${kinds}</select></div>
        <div>車種 <select data-buy="model">${models}</select></div>
        ${carsHtml}
        <div>配属する路線 <select data-buy="route">${routeOpts}</select></div>
        <div class="im">価格 <b>${yen(vehiclePrice(model, d.kind === 'rail' ? cars : 1))}</b>${this.company() ? ` / 現金 ${yen(this.company()!.cash)}` : ''}</div>
        <div><button data-act="buy">購入</button> <button data-act="rmdepot">基地を撤去</button></div>
      </div>`,
    ];
  }

  /** 車両の情報: 路線・状態・積載・この先の停車駅。経路は地図上に矢印で出る */
  private vehicleHtml(id: number): string[] | null {
    const v = this.transit.vehicles.find((x) => x.id === id);
    if (!v) return null;
    const r = this.transit.routes.get(v.routeId);
    const m = modelOf(v.modelId);
    const n = r?.orders.length ?? 0;
    const names: string[] = [];
    if (r) {
      for (let k = 0, i = v.order; k < n && names.length < 6; k++, i = (i + 1) % n) {
        const o = r.orders[i];
        const s = this.transit.stops.get(o.stopId);
        if (!s || s.waypoint) continue;
        names.push(o.pass ? `(${esc(s.name)}:通過)` : esc(s.name));
      }
    }
    const state = v.hold ? '待機中' : v.state === 'move' ? '走行中' : v.state === 'load' ? '停車中' : '経路なし';
    const pct = v.cap ? Math.round((v.load / v.cap) * 100) : 0;
    return [
      `<div class="ih"><b>${v.mode === 'rail' ? '🚆' : v.mode === 'air' ? '✈' : '🚌'} #${v.id} ${esc(r?.name ?? '')}</b><span><button data-close>✕</button></span></div>
      <div class="im">${esc(m.name)}${v.mode === 'rail' ? ` ${v.cars}両` : ''} ・ ${state} ・ 積載 ${pct}%(${Math.floor(v.load)}/${v.cap}人)</div>
      <div class="im">この先: ${names.length ? names.join(' → ') : '-'}</div>
      ${v.mode === 'rail' ? `<div class="im">閉塞: ${v.state !== 'move' ? '-' : v.resTo >= v.path.length - 1 ? '駅まで予約済み' : `前方 ${Math.max(0, v.resTo - v.pi)} タイルを予約済み${v.stuck > 20 ? ' ・ <b>前方の信号が赤で待機中</b>' : ''}`}</div>` : ''}
      <div class="im"><button data-follow="${v.id}">${this.followId === v.id ? '📍 追跡中(押して解除)' : '📍 追跡'}</button></div>
      <div class="im muted">進む経路を地図に矢印で表示しています(線が太い範囲が次の停車駅まで、細い範囲がその先の予定。緑の帯は予約済みの閉塞)</div>`,
    ];
  }

  private facilityOwnerHtml(f: import('../world/facilities').Facility): string {
    if (f.owner === 'public') return `<div class="im">持ち主: <b>${f.type === 'sight' ? '観光地(ご当地)' : '公共施設(市)'}</b> ・ 来場者 ${Math.floor(f.visits ?? 0)}人 ・ 買収・売却・撤去はできません</div>`;
    const mineF = (f.owner ?? 'player') === 'player' && f.playerId === net.id;
    const theirs = (f.owner ?? 'player') === 'player' && !mineF;
    const own = mineF;
    const v = facilityValue(f);
    return `<div class="im">持ち主: <b>${own ? '自社' : theirs ? '他のプレイヤー' : '他社(民間)'}</b> ・ 評価額 ${yen(v)} ・ 来場者 ${Math.floor(f.visits ?? 0)}人 ・ 売上/日 ${yen(f.income ?? 0)}</div>
      <div class="im">${own ? `<button data-act="sellfac" data-id="${f.id}">売却(評価額の60%)</button>` : theirs ? '' : `<button data-act="buyfac" data-id="${f.id}">買収(${yen(v)})</button>`}</div>`;
  }

  private facilityHtml(id: number): string[] | null {
    const f = this.map.facilities.find((x) => x.id === id);
    if (!f) return null;
    const spec = FACILITY_SPECS[f.type];
    const stops = [...this.transit.stops.values()].filter((s) => s.facs?.includes(id));
    const rows = stops.map((s) => `<div class="im">${esc(s.name)} ・ 待ち ${Math.floor(s.waiting)}人</div>`).join('');
    return [
      `<div class="ih"><b>${spec.icon} ${esc(f.name)}</b><span><button data-focus data-x="${f.x0}" data-y="${f.y0}" title="この場所へ移動">⌖</button><button data-close>✕</button></span></div>
      <div class="im">${spec.desc}。需要は周辺の停留所の集客圏の人口 ${spec.attract}人ぶんに相当します。</div>
      <div class="ib"><div class="ibt">この施設に来られる停留所</div>${rows || '<div class="im">集客圏にある停留所はまだありません。バス停・駅を近くに置くと、乗客が増えます。</div>'}</div>
      ${this.facilityOwnerHtml(f)}
      ${f.owner === 'public' ? '' : '<div class="im">撤去: 🧹撤去ツールで敷地をクリック</div>'}`,
    ];
  }

  private townHtml(id: number): string[] | null {
    const town: Town | undefined = this.map.towns[id - 1];
    if (!town) return null;
    let stops = 0;
    let waiting = 0;
    for (const s of this.transit.stops.values()) {
      if (s.townId !== town.id) continue;
      stops++;
      waiting += Math.floor(s.waiting);
    }
    const total = this.map.towns.reduce((a, b) => a + b.pop, 0);
    return [`<div class="ih"><b>🏘 ${esc(town.name)}</b><span><button data-focus data-x="${town.x}" data-y="${town.y}" title="中心へ移動">⌖</button><button data-close>✕</button></span></div>
      <div class="im">${TIERS[townTier(town)].name}(成長の範囲 ${TIERS[townTier(town)].min.toLocaleString()}〜${TIERS[townTier(town)].max.toLocaleString()}人) ・ 人口 <b>${town.pop.toLocaleString()}</b>人(全体の${total ? Math.round((town.pop / total) * 100) : 0}%) ・ 住宅 ${town.houses}戸</div>
      <div class="im">停留所 ${stops} ・ 待ち人数 ${waiting}人 ・ 最近の乗降 ${Math.floor(town.pax)}人</div>`];
  }
}
