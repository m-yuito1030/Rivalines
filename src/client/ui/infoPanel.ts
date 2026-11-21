import { net } from '../connection/net';
import { GRADE_MAX, fairPrice, freshness, gradeCapMul, gradeOf, gradeSpendMul, gradeUpkeepMul, renovateCost, repMul, repOf, upgradeCost } from '../../shared/world/facilityQuality';
import { PRICE_LEVELS, bestLevel, demandMul, elasticity, priceLevel, revenueIndex } from '../../shared/sim/facility/pricing';
import { TIERS, townTier } from '../../shared/world/town';
import { AD_COOLDOWN_DAYS, AD_TYPES, type AdKind, VISITOR_TYPES, adActive, adAvailable, adCost } from '../../shared/sim/facility/facilityVisitors';
import { DAY_TICKS, type Stop, type Transit, todOf } from '../../shared/sim/network/transit';
import type { GameMap } from '../../shared/world/gameMap';
import { designName } from '../../shared/world/stations';
import { type Company, facilityValue, vehiclePrice, yen } from '../../shared/sim/economy/economy';
import { DESIGN_COUNT, FACILITY_SPECS, facilityAt, facilityBuildCost, facilityUpkeep, redesignCost, redesignRule } from '../../shared/world/facilities';
import { hospitalGrowth, hospitalServes } from '../../shared/world/hospital';
import sheetInfo from '../../shared/data/facilitySprites.json';
import { drawFacilityPreview } from '../render/buildingSprites';
import type { Facility, FacilityType } from '../../shared/world/facilities';
import { type Mode, clampCars, kindsFor, modelOf, modelsFor } from '../../shared/data/models';
import type { Town } from '../../shared/world/town';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const MODE_ICON = { road: '🚏', rail: '🚉', air: '🛫' } as const;
const hm = (tod: number) => {
  const m = Math.floor(((((tod % DAY_TICKS) + DAY_TICKS) % DAY_TICKS) / DAY_TICKS) * 24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
/** tick → ゲーム内の分(切り上げ) */
const mins = (t: number) => Math.ceil((t / DAY_TICKS) * 24 * 60);

/** 施設の情報パネルのタブ */
type FacTab = 'overview' | 'econ' | 'ads' | 'design';

export type Selection =
  { kind: 'vehicle'; id: number } | { kind: 'stop'; id: number } | { kind: 'town'; id: number } | { kind: 'depot'; id: number } | { kind: 'facility'; id: number };

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
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
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
  /** 施設の情報パネルで開いているタブ */
  private facTab: FacTab = 'overview';
  /** デザイン変更で選んでいるデザイン(施設 id → デザイン番号) */
  private redesignSel = new Map<number, number>();
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

  /** 会社の一覧(他社への許可の選択肢)。main が設定する */
  players: () => { id: number; company: string }[] = () => [];

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
      if (t.dataset.allow) {
        const cb = t as unknown as HTMLInputElement;
        void net.cmd({ t: 'stopAllow', stopId: Number(t.dataset.id), who: Number(t.dataset.allow), allow: cb.checked }).then((r) => r.msg && this.onMessage(r.msg));
        return;
      }
      if (t.dataset.redesign) {
        this.redesignSel.set(Number(t.dataset.id), Number(t.value));
        this.lastParts = [];
        this.render();
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
      const ft = t.closest<HTMLElement>('[data-ftab]');
      if (ft) {
        this.facTab = ft.dataset.ftab as FacTab;
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
    const parts =
      this.sel.kind === 'vehicle'
        ? this.vehicleHtml(this.sel.id)
        : this.sel.kind === 'stop'
          ? this.stopHtml(this.sel.id)
          : this.sel.kind === 'depot'
            ? this.depotHtml(this.sel.id)
            : this.sel.kind === 'facility'
              ? this.facilityHtml(this.sel.id)
              : this.townHtml(this.sel.id);
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
    this.drawRedesignPreview();
  }

  /** デザイン変更の見本(選んでいるデザインを、施設の大きさで描く) */
  private drawRedesignPreview(): void {
    const cv = this.el.querySelector<HTMLCanvasElement>('canvas.facRedesign');
    if (!cv) return;
    drawFacilityPreview(cv, cv.dataset.type as FacilityType, Number(cv.dataset.design), cv.dataset.size as 'S' | 'M' | 'L');
  }

  /** 自社の施設のデザイン変更(同じ大きさのまま・費用あり)。変えられない施設は何も出さない */
  private redesignHtml(f: Facility): string {
    if ((f.owner ?? 'player') !== 'player' || f.playerId !== net.id) return '';
    const rule = redesignRule(f);
    if (!rule.ok) return '';
    const n = DESIGN_COUNT[f.type] ?? 1;
    const names = (sheetInfo as Record<string, { names: string[] }>)[f.type]?.names ?? [];
    const cur = f.design ?? -1;
    const sel = Math.min(n - 1, this.redesignSel.get(f.id) ?? (cur >= 0 ? cur : 0));
    const opts = Array.from(
      { length: n },
      (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${String(i + 1).padStart(2, '0')} ${esc(names[i] ?? '')}${i === cur ? '(いま)' : ''}</option>`,
    ).join('');
    const cost = redesignCost(f);
    return `<div class="ib"><div class="ibt">デザイン変更(大きさ ${f.w}×${f.h} のまま)</div>
      <canvas class="facRedesign" width="220" height="200" data-type="${f.type}" data-design="${sel}" data-size="${rule.size}" style="width:100%;max-width:220px;background:rgba(0,0,0,.25);border-radius:8px"></canvas>
      <div class="im"><select data-redesign="1" data-id="${f.id}">${opts}</select> <button data-act="redesign" data-id="${f.id}" data-design="${sel}" ${sel === cur ? 'disabled' : ''}>変更 ${yen(cost)}</button></div>
      ${f.design === undefined ? '<div class="im muted">古い形式の施設です。変更すると、同じ大きさのスプライトに替わります。</div>' : ''}</div>`;
  }

  private trainAction(b: HTMLElement): void {
    const vid = Number(b.dataset.v);
    const say = (p: Promise<{ ok: boolean; msg?: string }>, okMsg?: string) => void p.then((r) => this.onMessage(r.msg ?? (r.ok ? (okMsg ?? '') : '失敗しました')));
    const act = b.dataset.act;
    if (act === 'ad') say(net.cmd({ t: 'ad', facilityId: Number(b.dataset.id), kind: b.dataset.kind as AdKind }));
    else if (act === 'upgrade') say(net.cmd({ t: 'facUpgrade', facilityId: Number(b.dataset.id) }));
    else if (act === 'renovate') say(net.cmd({ t: 'facRenovate', facilityId: Number(b.dataset.id) }));
    else if (act === 'redesign') say(net.cmd({ t: 'facRedesign', facilityId: Number(b.dataset.id), design: Number(b.dataset.design) }));
    else if (act === 'price') say(net.cmd({ t: 'facPrice', facilityId: Number(b.dataset.id), level: Number(b.dataset.level) }));
    else if (act === 'buyfac' || act === 'sellfac') say(net.cmd({ t: 'fin', op: act === 'buyfac' ? 'acquire' : 'sell', id: Number(b.dataset.id) }));
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
        if (t.canCouple(trains[i].id, trains[j].id))
          h += `<div class="ir"><span></span><span>#${trains[i].id} と #${trains[j].id}(計${trains[i].cars + trains[j].cars}両)</span><span class="to"></span><span class="when"><button data-act="couple" data-v="${trains[i].id}" data-w="${trains[j].id}">連結</button></span></div>`;
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
      return [
        `<div class="ih"><b>📍 <input data-rename="stop" data-id="${id}" type="text" maxlength="24" value="${esc(s.name)}" style="width:9em"></b><span><button data-focus data-x="${s.x}" data-y="${s.y}" title="この場所へ移動">⌖</button><button data-close>✕</button></span></div><div class="im">経由点: 路線に加えると、列車はこの線路を通ります(停車・乗降はしません)。</div>`,
      ];
    }
    const dests = [...s.wait]
      .filter(([, n]) => n >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
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
    // 他社への使用許可(持ち主だけ。許可がない他社は、この停留所を路線に使えない)
    if (s.owner === net.id) {
      const others = this.players().filter((p) => p.id !== net.id);
      if (others.length) {
        const all = (c: number) => !!t.grants.get(net.id)?.has(c);
        h += `<div class="ib"><div class="ibt">🔑 他社の利用を許可</div>${others
          .slice(0, 30)
          .map(
            (p) =>
              `<label class="im"><input type="checkbox" data-allow="${p.id}" data-id="${id}" ${s.allow?.includes(p.id) || all(p.id) ? 'checked' : ''} ${all(p.id) ? 'disabled' : ''}> ${esc(p.company)}${all(p.id) ? ' <small class="muted">(全駅を許可中)</small>' : ''}</label>`,
          )
          .join('')}<div class="muted">許可すると、その会社の路線がこの停留所に停まれます。</div></div>`;
      }
    } else if (s.owner) h += `<div class="im muted">持ち主: 他社${t.mayUse(s, net.id) ? '(使用を許可されています)' : ''}</div>`;
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
    const kinds = kindsFor(d.kind)
      .map((k) => `<option value="${esc(k)}" ${k === model.kind ? 'selected' : ''}>${esc(k)}</option>`)
      .join('');
    const models = modelsFor(d.kind)
      .filter((m) => m.kind === model.kind)
      .map(
        (m) => `<option value="${m.id}" ${m.id === model.id ? 'selected' : ''}>${esc(m.name)} (${d.kind === 'rail' ? `1両${m.cap}人` : `定員${m.cap}`}・速度${m.speed})</option>`,
      )
      .join('');
    const cars = clampCars(model, st.cars);
    const carsHtml =
      d.kind !== 'rail'
        ? ''
        : model.minCars === model.maxCars
          ? '<div>編成: 1両(単行)</div>'
          : `<div>編成 <input data-buy="cars" type="number" min="${model.minCars}" max="${model.maxCars}" value="${cars}">両(${model.minCars}〜${model.maxCars})・定員${model.cap * cars}人</div>`;
    const routeOpts = routes
      .map(
        (r) =>
          `<option value="${r.id}" ${r.id === st.routeId ? 'selected' : ''}>${esc(r.name)}(${r.orders.length}停留所・車両${this.transit.vehicles.filter((v) => v.routeId === r.id).length})</option>`,
      )
      .join('');
    const head = `<div class="ih"><b>🏭 ${esc(d.name)}</b><span><button data-focus data-x="${d.x}" data-y="${d.y}" title="この場所へ移動">⌖</button><button data-close>✕</button></span></div>`;
    if (!routes.length)
      return [
        head + '<div class="im">この種類の路線がありません。先に路線パネルで路線を作成してください。</div><div class="ib"><button data-act="rmdepot">基地を撤去</button></div>',
      ];
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

  /** 施設の情報を、タブごとの内容に分けて返す(概要・経営・広告)。自社の施設でなければ経営・広告は空 */
  private facilitySections(f: Facility): { overview: string; econ: string; ads: string; own: boolean } {
    if (f.owner === 'public')
      return {
        own: false,
        econ: '',
        ads: '',
        overview: `<div class="im">持ち主: <b>${f.type === 'sight' ? '観光地(ご当地)' : '公共施設(市)'}</b> ・ 来場者 ${Math.floor(f.visits ?? 0)}人 ・ 買収・売却・撤去はできません</div>`,
      };
    const mineF = (f.owner ?? 'player') === 'player' && f.playerId === net.id;
    const theirs = (f.owner ?? 'player') === 'player' && !mineF;
    const own = mineF;
    const v = facilityValue(f);
    const spec = FACILITY_SPECS[f.type];
    const stopsNear = [...this.transit.stops.values()].filter((st) => !st.waypoint && st.facs?.includes(f.id));
    const perVisit = spec.conversion * spec.spend; // 来場者1人あたりの売上
    const upkeep = facilityUpkeep(f);
    const breakEven = perVisit > 0 ? Math.ceil(upkeep / perVisit) : 0;
    let econ = '';
    let ads = '';
    if (own) {
      const profit = (f.income ?? 0) - upkeep;
      econ = `<div class="im">売上/日 ${yen(f.income ?? 0)} − 維持費/日 ${yen(upkeep)} = <b class="${profit < 0 ? 'neg' : ''}">${profit < 0 ? '' : '+'}${yen(profit)}</b>/日</div>`;
      if (perVisit > 0)
        econ += `<div class="im muted">来場1人あたり ${yen(perVisit)} の売上。黒字には1日に約 ${breakEven} 人の来場が必要です(いまの来場の目安: 売上/日 ÷ ${yen(perVisit)} ≒ ${Math.round((f.income ?? 0) / perVisit)} 人)</div>`;
      if (VISITOR_TYPES.includes(f.type)) {
        ads += `<div class="im muted">来場者: 周辺の人口の2割までのランダムな人数が毎日来ます。${stopsNear.length ? '集客圏に駅・停留所があるので増えています。' : '近くに駅・停留所を置くと増えます。'}近くに同じ種類の施設(自社・他社)があると分散して減ります。</div>`;
        if (!(f.visits ?? 0)) ads += `<div class="im muted">⏳ 来場者は毎日 0:00 にまとめて集計されます。建てた日は 0 人のままで、日付が変わると反映されます。</div>`;
        const day = Math.floor((this.getTick() + DAY_TICKS / 4) / DAY_TICKS);
        const active = adActive(f, day);
        const why = adAvailable(f, day);
        if (active && f.ad)
          ads += `<div class="im">📣 ${AD_TYPES[f.ad.kind].name}広告 実施中(あと${f.ad.from + AD_TYPES[f.ad.kind].days - day}日): 来場者 ×${AD_TYPES[f.ad.kind].mul}、近くの他の施設 ×${AD_TYPES[f.ad.kind].rival}</div>`;
        ads += `<div class="im">広告(1施設につき${AD_COOLDOWN_DAYS}日に1度): ${(Object.keys(AD_TYPES) as AdKind[])
          .map(
            (k) =>
              `<button data-act="ad" data-id="${f.id}" data-kind="${k}" ${why ? 'disabled' : ''} title="${AD_TYPES[k].days}日間 自施設 ×${AD_TYPES[k].mul} / 近くの他の施設 ×${AD_TYPES[k].rival}">${AD_TYPES[k].name} ${yen(adCost(f, k))}</button>`,
          )
          .join(' ')}</div>`;
        if (why && !active) ads += `<div class="im muted">${esc(why)}</div>`;
        if (perVisit > 0) {
          // 料金: 上げると1人あたりの売上が増え、来場者は減る。条件ごとのいちばん儲かる段階を目安に出す
          const k = f.elast ?? elasticity(f.type, 0, stopsNear.length > 0, active);
          const cur = priceLevel(f);
          const best = bestLevel(k);
          econ += `<div class="im">料金: ${PRICE_LEVELS.map(
            (l, i) =>
              `<button data-act="price" data-id="${f.id}" data-level="${i}" class="${i === cur ? 'on' : ''}" title="客単価 ×${l.mul} ・ 来場者 ×${demandMul(l.mul, k).toFixed(2)} ・ 売上の目安 ${Math.round(revenueIndex(l.mul, k) * 100)}%">${l.label}${i === best ? '★' : ''}</button>`,
          ).join(' ')}</div>`;
          econ += `<div class="im muted">客単価 ×${PRICE_LEVELS[cur].mul}・来場者 ×${demandMul(PRICE_LEVELS[cur].mul, k).toFixed(2)}(標準を100%として売上の目安 ${Math.round(revenueIndex(PRICE_LEVELS[cur].mul, k) * 100)}%)。★は今の条件でいちばん儲かる見込みの料金です。近くに同じ種類の施設が増える・駅がなくなると、最適な料金は下がります。</div>`;
          // グレード・評判・新しさ
          const g = gradeOf(f);
          const rep = Math.round(repOf(f));
          const fresh = freshness(f, day);
          const build = facilityBuildCost(f);
          econ += `<div class="im">グレード <b>${'★'.repeat(g)}${'☆'.repeat(GRADE_MAX - g)}</b> ${
            g < GRADE_MAX
              ? `<button data-act="upgrade" data-id="${f.id}" title="客単価 ×${gradeSpendMul(g + 1).toFixed(2)}・来場者の上限 ×${gradeCapMul(g + 1).toFixed(2)}・維持費 ×${gradeUpkeepMul(g + 1).toFixed(2)}">★${g + 1}にする ${yen(upgradeCost(build, g))}</button>`
              : '(最高)'
          }</div>`;
          econ += `<div class="im">評判 <b>${rep}</b>/100(来場者 ×${repMul(rep).toFixed(2)}) ・ 新しさ ${Math.round(fresh * 100)}% ${
            fresh < 0.99 ? `<button data-act="renovate" data-id="${f.id}" title="人気(新しさ)を戻し、評判を少し上げます">改装 ${yen(renovateCost(build))}</button>` : ''
          }</div>`;
          econ += `<div class="im muted">評判は、料金が設備に見合うか(★${g}の目安は ×${fairPrice(g).toFixed(2)}より安い)・駅が近いか・混雑していないか・新しいか、で少しずつ動きます。</div>`;
        }
      }
      if (perVisit > 0 && (f.income ?? 0) < upkeep)
        econ += `<div class="im"><b>⚠ 来場が足りません。</b>近くの停留所(${stopsNear
          .slice(0, 3)
          .map((st) => esc(st.name))
          .join('・')})へ向かう乗客を増やす(本数・路線・周辺の人口)と売上が増えます</div>`;
    }
    const stops = [...this.transit.stops.values()].filter((st) => !st.waypoint && st.facs?.includes(f.id));
    const rows = stops.map((st) => `<div class="im">${esc(st.name)} ・ 待ち ${Math.floor(st.waiting)}人</div>`).join('');
    const overview = `<div class="ib"><div class="ibt">この施設に来られる停留所</div>${rows || '<div class="im">集客圏にある停留所はまだありません。バス停・駅を近くに置くと、乗客が増えます。</div>'}</div>
      <div class="im">持ち主: <b>${own ? '自社' : theirs ? '他のプレイヤー' : '他社(民間)'}</b> ・ 評価額 ${yen(v)} ・ 来場者 ${Math.floor(f.visits ?? 0)}人 ・ 売上/日 ${yen(f.income ?? 0)}</div>
      ${this.hospitalHtml(f)}
      <div class="im">${own ? `<button data-act="sellfac" data-id="${f.id}">売却(評価額の60%)</button>` : theirs ? '' : `<button data-act="buyfac" data-id="${f.id}">買収(${yen(v)})</button>`}</div>
      <div class="im muted">撤去: 🧹撤去ツールで敷地をクリック</div>`;
    return { overview, econ, ads, own };
  }

  /** 病院が、どの街の成長を何%速めているか */
  private hospitalHtml(f: Facility): string {
    if (f.type !== 'hospital') return '';
    const towns = this.map.towns.filter((t) => hospitalServes(f, t));
    if (!towns.length) return '<div class="im muted">🏥 この病院が届く街がありません(街の近くに建てると、街の成長が速くなります)</div>';
    return `<div class="ib"><div class="ibt">🏥 街の成長への効果</div>${towns
      .slice(0, 5)
      .map((t) => {
        const g = hospitalGrowth(this.map, t);
        return `<div class="im">${esc(t.name)}: 成長 <b>+${Math.round(g.bonus * 100)}%</b>(届いている病院 ${g.count}件)</div>`;
      })
      .join('')}</div>`;
  }

  private facilityHtml(id: number): string[] | null {
    const f = this.map.facilities.find((x) => x.id === id);
    if (!f) return null;
    const spec = FACILITY_SPECS[f.type];
    const sec = this.facilitySections(f);
    const design = this.redesignHtml(f);
    // 使えるタブだけ並べる(自社の施設は 概要・経営・広告・デザイン、ほかは概要だけ)
    const tabs: [FacTab, string][] = [['overview', '概要']];
    if (sec.own) {
      tabs.push(['econ', '経営']);
      if (sec.ads) tabs.push(['ads', '広告']);
      if (design) tabs.push(['design', 'デザイン']);
    }
    const cur = tabs.some(([k]) => k === this.facTab) ? this.facTab : 'overview';
    const content = cur === 'econ' ? sec.econ : cur === 'ads' ? sec.ads : cur === 'design' ? design : sec.overview;
    return [
      `<div class="ih"><b>${spec.icon} ${esc(f.name)}</b><span><button data-focus data-x="${f.x0}" data-y="${f.y0}" title="この場所へ移動">⌖</button><button data-close>✕</button></span></div>
      <div class="im">${spec.desc}。需要は周辺の停留所の集客圏の人口 ${spec.attract}人ぶんに相当します。</div>
      ${tabs.length > 1 ? `<div class="ftabs">${tabs.map(([k, l]) => `<button data-ftab="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}`,
      content,
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
    const hosp = hospitalGrowth(this.map, town);
    return [
      `<div class="ih"><b>🏘 ${esc(town.name)}</b><span><button data-focus data-x="${town.x}" data-y="${town.y}" title="中心へ移動">⌖</button><button data-close>✕</button></span></div>
      <div class="im">${TIERS[townTier(town)].name}(成長の範囲 ${TIERS[townTier(town)].min.toLocaleString()}〜${TIERS[townTier(town)].max.toLocaleString()}人) ・ 人口 <b>${town.pop.toLocaleString()}</b>人(全体の${total ? Math.round((town.pop / total) * 100) : 0}%) ・ 住宅 ${town.houses}戸</div>
      <div class="im">停留所 ${stops} ・ 待ち人数 ${waiting}人 ・ 最近の乗降 ${Math.floor(town.pax)}人</div>${hosp.count ? `<div class="im">🏥 病院 ${hosp.count}件: 成長 <b>+${Math.round(hosp.bonus * 100)}%</b></div>` : ''}`,
    ];
  }
}
