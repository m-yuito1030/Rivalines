import { tr } from '../i18n';
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
import { LISTING_DAYS, askingPrice, isForSale, listingLeft } from '../../shared/sim/facility/listings';
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
        const kind = t.dataset.rename === 'facility' ? 'facility' : 'stop';
        if (n) void net.cmd({ t: 'rename', kind, id: Number(t.dataset.id), name: n }).then((r) => !r.ok && r.msg && this.onMessage(r.msg));
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
      (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${String(i + 1).padStart(2, '0')} ${esc(names[i] ?? '')}${i === cur ? tr('(いま)') : ''}</option>`,
    ).join('');
    const cost = redesignCost(f);
    return `<div class="ib"><div class="ibt">${tr('デザイン変更(大きさ {w}×{h} のまま)', { w: f.w, h: f.h })}</div>
      <canvas class="facRedesign" width="220" height="200" data-type="${f.type}" data-design="${sel}" data-size="${rule.size}" style="width:100%;max-width:220px;background:rgba(0,0,0,.25);border-radius:8px"></canvas>
      <div class="im"><select data-redesign="1" data-id="${f.id}">${opts}</select> <button data-act="redesign" data-id="${f.id}" data-design="${sel}" ${sel === cur ? 'disabled' : ''}>${tr('変更 {cost}', { cost: yen(cost) })}</button></div>
      ${f.design === undefined ? `<div class="im muted">${tr('古い形式の施設です。変更すると、同じ大きさのスプライトに替わります。')}</div>` : ''}</div>`;
  }

  private trainAction(b: HTMLElement): void {
    const vid = Number(b.dataset.v);
    const say = (p: Promise<{ ok: boolean; msg?: string }>, okMsg?: string) => void p.then((r) => this.onMessage(r.msg ?? (r.ok ? (okMsg ?? '') : tr('失敗しました'))));
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
    } else if (act === 'split') say(net.cmd({ t: 'tx', m: 'splitTrain', a: [vid, this.splitCount.get(vid) ?? 1] }), tr('編成 #{vid} を分割しました(待機中)', { vid }));
    else if (act === 'depart') say(net.cmd({ t: 'tx', m: 'departHeld', a: [vid] }), tr('編成 #{vid} を出発させます', { vid }));
    else if (act === 'couple') say(net.cmd({ t: 'tx', m: 'coupleTrains', a: [vid, Number(b.dataset.w)] }), tr('編成 #{vid} を連結しました', { vid }));
    this.lastParts = [];
  }

  /** 駅の近くに停まっている編成の分割・連結・出発の操作 */
  private trainsHtml(stopId: number): string {
    const t = this.transit;
    const trains = t.trainsNear(stopId);
    if (!trains.length) return '';
    let h = `<div class="ib"><div class="ibt">${tr('編成の操作')}</div>`;
    for (const v of trains) {
      const r = t.routes.get(v.routeId);
      const sel = Math.min(this.splitCount.get(v.id) ?? 1, Math.max(1, v.cars - 1));
      h += `<div class="ir tr"><i style="background:${r ? hex(r.color) : '#888'}"></i><span>${tr('#{id} {name} {cars}両{tr}', { id: v.id, name: esc(r?.name ?? ''), cars: v.cars, tr: v.hold ? tr('(待機)') : '' })}</span><span class="to">`;
      if (v.cars >= 2) {
        h += `${tr('後ろ')}<select data-split="${v.id}">${Array.from({ length: v.cars - 1 }, (_, i) => `<option value="${i + 1}" ${i + 1 === sel ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>${tr('両を')}<button data-act="split" data-v="${v.id}">${tr('分割')}</button>`;
      }
      h += '</span><span class="when">';
      if (v.hold) h += `<button data-act="depart" data-v="${v.id}">${tr('出発')}</button>`;
      h += '</span></div>';
    }
    for (let i = 0; i < trains.length; i++) {
      for (let j = i + 1; j < trains.length; j++) {
        if (t.canCouple(trains[i].id, trains[j].id))
          h += `<div class="ir"><span></span><span>${tr('#{id} と #{id2}(計{cars}両)', { id: trains[i].id, id2: trains[j].id, cars: trains[i].cars + trains[j].cars })}</span><span class="to"></span><span class="when"><button data-act="couple" data-v="${trains[i].id}" data-w="${trains[j].id}">${tr('連結')}</button></span></div>`;
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
        `<div class="ih"><b>📍 <input data-rename="stop" data-id="${id}" type="text" maxlength="24" value="${esc(s.name)}" style="width:9em"></b><span><button data-focus data-x="${s.x}" data-y="${s.y}" title="${tr('この場所へ移動')}">⌖</button><button data-close>✕</button></span></div><div class="im">${tr('経由点: 路線に加えると、列車はこの線路を通ります(停車・乗降はしません)。')}</div>`,
      ];
    }
    const dests = [...s.wait]
      .filter(([, n]) => n >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const town = this.map.towns[s.townId - 1];
    const deps = t.departures(id, tick).slice(0, 8);
    const tt = t.timetable(id, tick);
    let h = `<div class="ih"><b>${MODE_ICON[s.kind]} <input data-rename="stop" data-id="${id}" type="text" maxlength="24" value="${esc(s.name)}" style="width:9em"> <small>ID:${id}</small></b><span><button data-focus data-x="${s.x}" data-y="${s.y}" title="${tr('この場所へ移動')}">⌖</button><button data-close>✕</button></span></div>`;
    if (s.station)
      h += `<div class="im">${tr('{tracks}番線 ・ ホーム長{len}タイル ・ {design}', { tracks: s.station.tracks, len: s.station.len, design: designName(s.station.design) })}</div>`;
    h += `<div class="im">${tr('{tr}集客圏人口 {s} ・ 待ち', { tr: town ? esc(town.name) + tr(' ・ ') : '', s: Math.floor(s.pop) })} <b>${Math.floor(s.waiting)}</b>${tr('人')}</div>`;
    if (dests.length) h += `<div class="im">${tr('行き先別:')} ${dests.map(([d, n]) => `${esc(this.transit.stops.get(d)?.name ?? '?')} ${Math.floor(n)}`).join(' / ')}</div>`;
    h += `<div class="ib"><div class="ibt">${tr('発車案内')}</div>`;
    if (!deps.length) h += `<div class="im">${tr('この停留所に停まる路線・車両はありません')}</div>`;
    for (const d of deps) {
      const r = t.routes.get(d.routeId);
      if (!r) continue;
      const when = d.stopped
        ? tr('停車中(発車まで{leaveIn}分)', { leaveIn: mins(d.leaveIn) })
        : d.eta < DAY_TICKS / 24 / 12
          ? tr('接近中')
          : tr('{eta} 着(あと{eta2}分)', { eta: hm(todOf(tick) + d.eta), eta2: mins(d.eta) });
      h += `<div class="ir"><i style="background:${hex(r.color)}"></i><span>${esc(r.name)}</span><span class="to">${tr('{toward}行き', { toward: esc(d.toward) })}</span><span class="when">${when}</span></div>`;
    }
    for (const x of tt) {
      const r = t.routes.get(x.routeId);
      if (r) h += `<div class="im">${tr('{name} 時刻表: {e}', { name: esc(r.name), e: x.etas.map((e) => hm(todOf(tick) + e)).join(' / ') })}</div>`;
    }
    h += '</div>';
    // 他社への使用許可(持ち主だけ。許可がない他社は、この停留所を路線に使えない)
    if (s.owner === net.id) {
      const others = this.players().filter((p) => p.id !== net.id);
      if (others.length) {
        const all = (c: number) => !!t.grants.get(net.id)?.has(c);
        h += `<div class="ib"><div class="ibt">${tr('🔑 他社の利用を許可')}</div>${others
          .slice(0, 30)
          .map(
            (p) =>
              `<label class="im"><input type="checkbox" data-allow="${p.id}" data-id="${id}" ${s.allow?.includes(p.id) || all(p.id) ? 'checked' : ''} ${all(p.id) ? 'disabled' : ''}> ${esc(p.company)}${all(p.id) ? ` <small class="muted">${tr('(全駅を許可中)')}</small>` : ''}</label>`,
          )
          .join('')}<div class="muted">${tr('許可すると、その会社の路線がこの停留所に停まれます。')}</div></div>`;
      }
    } else if (s.owner) h += `<div class="im muted">${tr('持ち主: 他社{tr}', { tr: t.mayUse(s, net.id) ? tr('(使用を許可されています)') : '' })}</div>`;
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
        (m) =>
          `<option value="${m.id}" ${m.id === model.id ? 'selected' : ''}>${tr('{name} ({cap}・速度{speed})', { name: esc(m.name), cap: d.kind === 'rail' ? tr('1両{cap}人', { cap: m.cap }) : tr('定員{cap}', { cap: m.cap }), speed: m.speed })}</option>`,
      )
      .join('');
    const cars = clampCars(model, st.cars);
    const carsHtml =
      d.kind !== 'rail'
        ? ''
        : model.minCars === model.maxCars
          ? `<div>${tr('編成: 1両(単行)')}</div>`
          : `<div>${tr('編成')} <input data-buy="cars" type="number" min="${model.minCars}" max="${model.maxCars}" value="${cars}">${tr('両({minCars}〜{maxCars})・定員{cars}人', { minCars: model.minCars, maxCars: model.maxCars, cars: model.cap * cars })}</div>`;
    const routeOpts = routes
      .map(
        (r) =>
          `<option value="${r.id}" ${r.id === st.routeId ? 'selected' : ''}>${tr('{name}({length}停留所・車両{length2})', { name: esc(r.name), length: r.orders.length, length2: this.transit.vehicles.filter((v) => v.routeId === r.id).length })}</option>`,
      )
      .join('');
    const head = `<div class="ih"><b>🏭 ${esc(d.name)}</b><span><button data-focus data-x="${d.x}" data-y="${d.y}" title="${tr('この場所へ移動')}">⌖</button><button data-close>✕</button></span></div>`;
    if (!routes.length)
      return [
        head +
          `<div class="im">${tr('この種類の路線がありません。先に路線パネルで路線を作成してください。')}</div><div class="ib"><button data-act="rmdepot">${tr('基地を撤去')}</button></div>`,
      ];
    return [
      head +
        `<div class="im">${tr('ここから車両を購入します(代金は現金から。運行費は1日に価格の0.2%)。配属先の路線のオーダー(停留所・条件)を、その路線の車両と共有して走ります。')}</div>
      <div class="ib"><div class="ibt">${tr('車両を購入')}</div>
        <div>${tr('種別')} <select data-buy="kind">${kinds}</select></div>
        <div>${tr('車種')} <select data-buy="model">${models}</select></div>
        ${carsHtml}
        <div>${tr('配属する路線')} <select data-buy="route">${routeOpts}</select></div>
        <div class="im">${tr('価格')} <b>${yen(vehiclePrice(model, d.kind === 'rail' ? cars : 1))}</b>${this.company() ? ` ${tr('/ 現金 {this}', { this: yen(this.company()!.cash) })}` : ''}</div>
        <div><button data-act="buy">${tr('購入')}</button> <button data-act="rmdepot">${tr('基地を撤去')}</button></div>
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
        names.push(o.pass ? tr('({name}:通過)', { name: esc(s.name) }) : esc(s.name));
      }
    }
    const state = v.hold ? tr('待機中') : v.state === 'move' ? tr('走行中') : v.state === 'load' ? tr('停車中') : tr('経路なし');
    const pct = v.cap ? Math.round((v.load / v.cap) * 100) : 0;
    return [
      `<div class="ih"><b>${v.mode === 'rail' ? '🚆' : v.mode === 'air' ? '✈' : '🚌'} #${v.id} ${esc(r?.name ?? '')}</b><span><button data-close>✕</button></span></div>
      <div class="im">${esc(m.name)}${v.mode === 'rail' ? ` ${tr('{cars}両', { cars: v.cars })}` : ''} ${tr('・ {state} ・ 積載 {pct}%({v}/{cap}人)', { state, pct, v: Math.floor(v.load), cap: v.cap })}</div>
      <div class="im">${tr('この先: {names}', { names: names.length ? names.join(' → ') : '-' })}</div>
      ${v.mode === 'rail' ? `<div class="im">${tr('閉塞:')} ${v.state !== 'move' ? '-' : v.resTo >= v.path.length - 1 ? tr('駅まで予約済み') : `${tr('前方 {v} タイルを予約済み', { v: Math.max(0, v.resTo - v.pi) })}${v.stuck > 20 ? ` ${tr('・')} <b>${tr('前方の信号が赤で待機中')}</b>` : ''}`}</div>` : ''}
      <div class="im"><button data-follow="${v.id}">${this.followId === v.id ? tr('📍 追跡中(押して解除)') : tr('📍 追跡')}</button></div>
      <div class="im muted">${tr('進む経路を地図に矢印で表示しています(線が太い範囲が次の停車駅まで、細い範囲がその先の予定。緑の帯は予約済みの閉塞)')}</div>`,
    ];
  }

  /** 施設の情報を、タブごとの内容に分けて返す(概要・経営・広告)。自社の施設でなければ経営・広告は空 */
  private facilitySections(f: Facility): { overview: string; econ: string; ads: string; own: boolean } {
    if (f.owner === 'public')
      return {
        own: false,
        econ: '',
        ads: '',
        overview: `<div class="im">${tr('持ち主:')} <b>${f.type === 'sight' ? tr('観光地(ご当地)') : tr('公共施設(市)')}</b> ${tr('・ 来場者 {f}人 ・ 買収・売却・撤去はできません', { f: Math.floor(f.visits ?? 0) })}</div>`,
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
      econ = `<div class="im">${tr('売上/日 {f} − 維持費/日 {upkeep} =', { f: yen(f.income ?? 0), upkeep: yen(upkeep) })} <b class="${profit < 0 ? 'neg' : ''}">${profit < 0 ? '' : '+'}${yen(profit)}</b>${tr('/日')}</div>`;
      if (perVisit > 0)
        econ += `<div class="im muted">${tr('来場1人あたり {perVisit} の売上。黒字には1日に約 {breakEven} 人の来場が必要です(いまの来場の目安: 売上/日 ÷ {perVisit2} ≒ {f} 人)', { perVisit: yen(perVisit), breakEven, perVisit2: yen(perVisit), f: Math.round((f.income ?? 0) / perVisit) })}</div>`;
      if (VISITOR_TYPES.includes(f.type)) {
        ads += `<div class="im muted">${tr('来場者: 周辺の人口の2割までのランダムな人数が毎日来ます。{tr}近くに同じ種類の施設(自社・他社)があると分散して減ります。', { tr: stopsNear.length ? tr('集客圏に駅・停留所があるので増えています。') : tr('近くに駅・停留所を置くと増えます。') })}</div>`;
        if (!(f.visits ?? 0)) ads += `<div class="im muted">${tr('⏳ 来場者は毎日 0:00 にまとめて集計されます。建てた日は 0 人のままで、日付が変わると反映されます。')}</div>`;
        const day = Math.floor((this.getTick() + DAY_TICKS / 4) / DAY_TICKS);
        const active = adActive(f, day);
        const why = adAvailable(f, day);
        if (active && f.ad)
          ads += `<div class="im">${tr('📣 {name}広告 実施中(あと{day}日): 来場者 ×{mul}、近くの他の施設 ×{rival}', { name: AD_TYPES[f.ad.kind].name, day: f.ad.from + AD_TYPES[f.ad.kind].days - day, mul: AD_TYPES[f.ad.kind].mul, rival: AD_TYPES[f.ad.kind].rival })}</div>`;
        ads += `<div class="im">${tr('広告(1施設につき{AD_COOLDOWN_DAYS}日に1度):', { AD_COOLDOWN_DAYS })} ${(Object.keys(AD_TYPES) as AdKind[])
          .map(
            (k) =>
              `<button data-act="ad" data-id="${f.id}" data-kind="${k}" ${why ? 'disabled' : ''} title="${tr('{days}日間 自施設 ×{mul} / 近くの他の施設 ×{rival}', { days: AD_TYPES[k].days, mul: AD_TYPES[k].mul, rival: AD_TYPES[k].rival })}">${AD_TYPES[k].name} ${yen(adCost(f, k))}</button>`,
          )
          .join(' ')}</div>`;
        if (why && !active) ads += `<div class="im muted">${esc(why)}</div>`;
        if (perVisit > 0) {
          // 料金: 上げると1人あたりの売上が増え、来場者は減る。条件ごとのいちばん儲かる段階を目安に出す
          const k = f.elast ?? elasticity(f.type, 0, stopsNear.length > 0, active);
          const cur = priceLevel(f);
          const best = bestLevel(k);
          econ += `<div class="im">${tr('料金:')} ${PRICE_LEVELS.map(
            (l, i) =>
              `<button data-act="price" data-id="${f.id}" data-level="${i}" class="${i === cur ? 'on' : ''}" title="${tr('客単価 ×{mul} ・ 来場者 ×{toFixed} ・ 売上の目安 {revenueIndex}%', { mul: l.mul, toFixed: demandMul(l.mul, k).toFixed(2), revenueIndex: Math.round(revenueIndex(l.mul, k) * 100) })}">${l.label}${i === best ? '★' : ''}</button>`,
          ).join(' ')}</div>`;
          econ += `<div class="im muted">${tr('客単価 ×{mul}・来場者 ×{toFixed}(標準を100%として売上の目安 {revenueIndex}%)。★は今の条件でいちばん儲かる見込みの料金です。近くに同じ種類の施設が増える・駅がなくなると、最適な料金は下がります。', { mul: PRICE_LEVELS[cur].mul, toFixed: demandMul(PRICE_LEVELS[cur].mul, k).toFixed(2), revenueIndex: Math.round(revenueIndex(PRICE_LEVELS[cur].mul, k) * 100) })}</div>`;
          // グレード・評判・新しさ
          const g = gradeOf(f);
          const rep = Math.round(repOf(f));
          const fresh = freshness(f, day);
          const build = facilityBuildCost(f);
          econ += `<div class="im">${tr('グレード')} <b>${'★'.repeat(g)}${'☆'.repeat(GRADE_MAX - g)}</b> ${
            g < GRADE_MAX
              ? `<button data-act="upgrade" data-id="${f.id}" title="${tr('客単価 ×{toFixed}・来場者の上限 ×{toFixed2}・維持費 ×{toFixed3}', { toFixed: gradeSpendMul(g + 1).toFixed(2), toFixed2: gradeCapMul(g + 1).toFixed(2), toFixed3: gradeUpkeepMul(g + 1).toFixed(2) })}">${tr('★{g}にする {upgradeCost}', { g: g + 1, upgradeCost: yen(upgradeCost(build, g)) })}</button>`
              : tr('(最高)')
          }</div>`;
          econ += `<div class="im">${tr('評判')} <b>${rep}</b>${tr('/100(来場者 ×{toFixed}) ・ 新しさ {fresh}%', { toFixed: repMul(rep).toFixed(2), fresh: Math.round(fresh * 100) })} ${
            fresh < 0.99
              ? `<button data-act="renovate" data-id="${f.id}" title="${tr('人気(新しさ)を戻し、評判を少し上げます')}">${tr('改装 {renovateCost}', { renovateCost: yen(renovateCost(build)) })}</button>`
              : ''
          }</div>`;
          econ += `<div class="im muted">${tr('評判は、料金が設備に見合うか(★{g}の目安は ×{toFixed}より安い)・駅が近いか・混雑していないか・新しいか、で少しずつ動きます。', { g, toFixed: fairPrice(g).toFixed(2) })}</div>`;
        }
      }
      if (perVisit > 0 && (f.income ?? 0) < upkeep)
        econ += `<div class="im"><b>${tr('⚠ 来場が足りません。')}</b>${tr('近くの停留所({tr})へ向かう乗客を増やす(本数・路線・周辺の人口)と売上が増えます', {
          tr: stopsNear
            .slice(0, 3)
            .map((st) => esc(st.name))
            .join(tr('・')),
        })}</div>`;
    }
    const stops = [...this.transit.stops.values()].filter((st) => !st.waypoint && st.facs?.includes(f.id));
    const rows = stops.map((st) => `<div class="im">${tr('{name} ・ 待ち {st}人', { name: esc(st.name), st: Math.floor(st.waiting) })}</div>`).join('');
    const overview = `<div class="ib"><div class="ibt">${tr('この施設に来られる停留所')}</div>${rows || `<div class="im">${tr('集客圏にある停留所はまだありません。バス停・駅を近くに置くと、乗客が増えます。')}</div>`}</div>
      <div class="im">${tr('持ち主:')} <b>${own ? tr('自社') : theirs ? tr('他のプレイヤー') : tr('他社(民間)')}</b> ${tr('・ 評価額 {v} ・ 来場者 {f}人 ・ 売上/日 {f2}', { v: yen(v), f: Math.floor(f.visits ?? 0), f2: yen(f.income ?? 0) })}</div>
      ${this.hospitalHtml(f)}
      ${this.listingHtml(f)}
      <div class="im">${own ? `<button data-act="sellfac" data-id="${f.id}">${tr('売却(評価額の60%)')}</button>` : theirs ? '' : `<button data-act="buyfac" data-id="${f.id}">${isForSale(f) ? tr('購入') : tr('買収')}(${yen(v)})</button>`}</div>
      <div class="im muted">${tr('撤去: 🧹撤去ツールで敷地をクリック')}</div>`;
    return { overview, econ, ads, own };
  }

  /** 売り出し中の物件の案内(価格・残り日数・取り壊しの警告) */
  private listingHtml(f: Facility): string {
    if (!isForSale(f)) return '';
    const left = listingLeft(f, Math.floor((this.getTick() + DAY_TICKS / 4) / DAY_TICKS));
    return `<div class="ib"><div class="ibt">${tr('🏘 売り出し中の物件')}</div><div class="im">${tr('価格')} <b>${yen(askingPrice(f))}</b>${tr('(評価額) ・ 残り')} <b class="${left <= 7 ? 'neg' : ''}">${tr('{left}日', { left })}</b></div><div class="im muted">${tr('どの会社も持っていません。購入すると自社の施設になります。{LISTING_DAYS}日間買い手がつかないと、取り壊されて更地に戻ります。', { LISTING_DAYS })}</div></div>`;
  }

  /** 病院が、どの街の成長を何%速めているか */
  private hospitalHtml(f: Facility): string {
    if (f.type !== 'hospital') return '';
    const towns = this.map.towns.filter((t) => hospitalServes(f, t));
    if (!towns.length) return `<div class="im muted">${tr('🏥 この病院が届く街がありません(街の近くに建てると、街の成長が速くなります)')}</div>`;
    return `<div class="ib"><div class="ibt">${tr('🏥 街の成長への効果')}</div>${towns
      .slice(0, 5)
      .map((t) => {
        const g = hospitalGrowth(this.map, t);
        return `<div class="im">${tr('{name}: 成長', { name: esc(t.name) })} <b>+${Math.round(g.bonus * 100)}%</b>${tr('(届いている病院 {count}件)', { count: g.count })}</div>`;
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
    const tabs: [FacTab, string][] = [['overview', tr('概要')]];
    if (sec.own) {
      tabs.push(['econ', tr('経営')]);
      if (sec.ads) tabs.push(['ads', tr('広告')]);
      if (design) tabs.push(['design', tr('デザイン')]);
    }
    const cur = tabs.some(([k]) => k === this.facTab) ? this.facTab : 'overview';
    const content = cur === 'econ' ? sec.econ : cur === 'ads' ? sec.ads : cur === 'design' ? design : sec.overview;
    return [
      `<div class="ih"><b>${spec.icon} ${sec.own ? `<input data-rename="facility" data-id="${f.id}" type="text" maxlength="24" value="${esc(f.name)}" title="${tr('名前を変えられます')}" style="width:9em">` : esc(f.name)}</b><span><button data-focus data-x="${f.x0}" data-y="${f.y0}" title="${tr('この場所へ移動')}">⌖</button><button data-close>✕</button></span></div>
      <div class="im">${tr('{desc}。需要は周辺の停留所の集客圏の人口 {attract}人ぶんに相当します。', { desc: spec.desc, attract: spec.attract })}</div>
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
      `<div class="ih"><b>🏘 ${esc(town.name)}</b><span><button data-focus data-x="${town.x}" data-y="${town.y}" title="${tr('中心へ移動')}">⌖</button><button data-close>✕</button></span></div>
      <div class="im">${tr('{name}(成長の範囲 {town}〜{town2}人) ・ 人口', { name: tr(TIERS[townTier(town)].name), town: TIERS[townTier(town)].min.toLocaleString(), town2: TIERS[townTier(town)].max.toLocaleString() })} <b>${town.pop.toLocaleString()}</b>${tr('人(全体の{total}%) ・ 住宅 {houses}戸', { total: total ? Math.round((town.pop / total) * 100) : 0, houses: town.houses })}</div>
      <div class="im">${tr('停留所 {stops} ・ 待ち人数 {waiting}人 ・ 最近の乗降 {town}人', { stops, waiting, town: Math.floor(town.pax) })}</div>${hosp.count ? `<div class="im">${tr('🏥 病院 {count}件: 成長', { count: hosp.count })} <b>+${Math.round(hosp.bonus * 100)}%</b></div>` : ''}`,
    ];
  }
}
