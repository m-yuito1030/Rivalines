import { tr } from '../i18n';
import { confirmDialog } from './confirm';
import { type Mode, clampCars, kindsFor, modelOf, modelsFor } from '../../shared/data/models';
import type { Order, Route, Transit } from '../../shared/sim/network/transit';
import { FARE_MUL_MAX, FARE_MUL_MIN, fareDemand, fareMulOf } from '../../shared/sim/network/fares';
import { DAY_TICKS, type OrderCond, PERIOD_OPTIONS, RANKS, todOf } from '../../shared/sim/network/transit';
import { yen, type Company } from '../../shared/sim/economy/economy';
import { TOLL_WARN } from '../../shared/sim/economy/analysis';
import { net } from '../connection/net';
import type { Cmd } from '../../shared/protocol';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const MODE_ICON: Record<Mode, string> = { road: '🚌', rail: '🚆', air: '✈' };
/** Translate every time it is read, so it follows a language switch */
const MODE_LABEL: Record<Mode, string> = {
  get road() {
    return tr('バス');
  },
  get rail() {
    return tr('鉄道');
  },
  get air() {
    return tr('航空');
  },
};
const KIND_HINT: Record<Mode, string> = {
  get road() {
    return tr('道路上をクリック(自動で停留所を設置)');
  },
  get rail() {
    return tr('駅(または経由点)をクリック。線路上の何もない所は簡易駅になります。経由点は鉄道▾の📍で先に置く');
  },
  get air() {
    return tr('空港をクリック');
  },
};

const PERIODS = PERIOD_OPTIONS;

/** In-game time (HH:MM) <-> ticks within a day. 0:00 = 0 */
const todToHM = (tod: number) => {
  const mins = Math.floor(((((tod % DAY_TICKS) + DAY_TICKS) % DAY_TICKS) / DAY_TICKS) * 24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};
const hmToTod = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return Math.round(((h * 60 + m) / (24 * 60)) * DAY_TICKS);
};
/** ticks -> in-game "minutes" */
const ticksToMin = (t: number) => Math.round((t / DAY_TICKS) * 24 * 60);

/**
 * Route panel: the route list and editing (stopping order, waiting method, model, timetable period), and the display while creating a route.
 * Redraws only when the structure changes (transit.version), so a form being typed in is not destroyed.
 */
export class RoutePanel {
  /** The kind and stops (in order) of the route being created */
  building: { kind: Mode; stops: number[] } | null = null;
  /** Inserting a stop (order) into an existing route: it goes at position `index` */
  inserting: { routeId: number; index: number } | null = null;
  /** Expand/collapse of the list: category -> route -> vehicle */
  private openMode: Mode | null = null;
  private openRoute = -1;
  private seen = -1;
  private seenBuild = '';
  /** When the close button is pressed (main adds the processing that closes the panel) */
  onClose: () => void = () => {};

  constructor(
    private el: HTMLElement,
    private transit: Transit,
    private getTick: () => number,
    private onStartBuild: () => void,
    private onEndBuild: () => void,
    _company: () => Company | null = () => null,
  ) {
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('change', (e) => this.onChange(e));
  }

  startBuild(kind: Mode): void {
    this.building = { kind, stops: [] };
    this.onStartBuild();
    this.render();
  }

  addToBuild(stopId: number): void {
    this.building?.stops.push(stopId);
    this.render();
  }

  /** Send an action to the server. If it fails, show the reason */
  private async send(cmd: Cmd): Promise<boolean> {
    const r = await net.cmd(cmd);
    if (!r.ok && r.msg) alert(r.msg);
    return r.ok;
  }

  finishBuild(): void {
    const b = this.building;
    if (b && b.stops.length >= 2) {
      void net.cmd({ t: 'routeCreate', stops: b.stops }).then((r) => {
        if (r.ok && r.id !== undefined) {
          this.openMode = b.kind;
          this.openRoute = r.id;
          this.transit.version++;
        } else if (r.msg) alert(r.msg);
      });
    }
    this.cancelBuild();
  }

  startInsert(routeId: number, index: number): void {
    this.inserting = { routeId, index };
    this.onStartBuild();
    this.render();
  }

  /** The stop to insert was clicked */
  completeInsert(stopId: number): void {
    const ins = this.inserting;
    if (!ins) return;
    void this.send({ t: 'tx', m: 'insertOrder', a: [ins.routeId, ins.index, stopId] });
    this.inserting = null;
    this.onEndBuild();
    this.render();
  }

  cancelBuild(): void {
    this.inserting = null;
    this.building = null;
    this.onEndBuild();
    this.render();
  }

  /** Fine to call every frame (redraws only when something changed) */
  refresh(live = true): void {
    const key = (this.building ? this.building.kind + this.building.stops.join(',') : '') + (this.inserting ? `i${this.inserting.routeId}:${this.inserting.index}` : '');
    if (this.transit.version !== this.seen || key !== this.seenBuild) this.render();
    else if (live) this.updateLive();
  }

  private stopName(id: number) {
    return esc(this.transit.stops.get(id)?.name ?? '?');
  }

  private render(): void {
    this.seen = this.transit.version;
    this.seenBuild = (this.building ? this.building.kind + this.building.stops.join(',') : '') + (this.inserting ? `i${this.inserting.routeId}:${this.inserting.index}` : '');
    const t = this.transit;
    let html = `<div class="ph">${tr('路線')} <span>
      <button data-act="build" data-kind="road" title="${tr('バス路線を作成')}">${tr('＋🚌')}</button>
      <button data-act="build" data-kind="rail" title="${tr('鉄道路線を作成')}">${tr('＋🚆')}</button>
      <button data-act="build" data-kind="air" title="${tr('航空路線を作成')}">${tr('＋✈')}</button> <button data-act="close" title="${tr('閉じる')}">✕</button></span></div>`;
    if (this.building) {
      const b = this.building;
      html += `<div class="build">${tr('{kind} {kind2}路線: {kind3}', { kind: MODE_ICON[b.kind], kind2: MODE_LABEL[b.kind], kind3: KIND_HINT[b.kind] })}<ol>${b.stops.map((id) => `<li>${this.stopName(id)}</li>`).join('')}</ol>
        <button data-act="finish" ${b.stops.length < 2 ? 'disabled' : ''}>${tr('確定 (Enter)')}</button>
        <button data-act="cancel">${tr('キャンセル (Esc)')}</button></div>`;
    }
    if (this.inserting) {
      const r = t.routes.get(this.inserting.routeId);
      html += `<div class="build">${tr('{name} の {index} 番に追加する停留所(経由点)をクリック', { name: r ? esc(r.name) : '', index: this.inserting.index + 1 })}<br><button data-act="cancel">${tr('キャンセル (Esc)')}</button></div>`;
    }
    if (t.routes.size === 0 && !this.building)
      html += `<div class="muted">${tr('上の ＋🚌 ＋🚆 ＋✈ で路線を作成します。バス停(B)・駅(K)・空港(P)は路線作成中にクリックしても設置されます。車両は車両基地(🏭)から購入します。')}</div>`;
    for (const m of ['road', 'rail', 'air'] as Mode[]) {
      const rs = [...t.routes.values()].filter((r) => r.mode === m && (r.owner === undefined || r.owner === net.id)); // list only the company's own routes
      const open = this.openMode === m;
      const vcount = t.vehicles.filter((v) => t.routes.get(v.routeId)?.mode === m && (t.routes.get(v.routeId)?.owner ?? net.id) === net.id).length;
      html += `<div class="genre"><button data-act="gen" data-kind="${m}">${tr('{open} {m} {m2} ({length}路線・車両{vcount})', { open: open ? '▼' : '▶', m: MODE_ICON[m], m2: MODE_LABEL[m], length: rs.length, vcount })}</button></div>`;
      if (!open) continue;
      for (const r of rs) {
        const on = this.openRoute === r.id;
        html += `<div class="rl"><button data-act="pick" data-r="${r.id}"><i style="background:${hex(r.color)}"></i> ${on ? '▼' : '▶'} ${esc(r.name)}${r.rank ? ` <b class="rk">${RANKS[r.rank].name}</b>` : ''} <em>${tr('ID:{id}・車両{length}', { id: r.id, length: t.vehicles.filter((v) => v.routeId === r.id).length })}</em></button></div>`;
        if (on) html += this.routeHtml(r);
      }
    }
    html += `<div class="muted">${tr('停留所 {length} / 車両 {length2} / 輸送人数', { length: [...t.stops.values()].filter((s) => !s.waypoint).length, length2: t.vehicles.length })} <span id="delivered"></span> ${tr('/ 乗換')} <span id="transfers"></span></div>`;
    this.el.innerHTML = html;
    this.updateLive();
  }

  /** Update only the numbers without changing the structure (waiting counts, load, delay, passengers carried) */
  private updateLive(): void {
    const set = (el: Element, text: string) => {
      if (el.textContent !== text) el.textContent = text;
    };
    const d = this.el.querySelector('#delivered');
    if (d) set(d, String(Math.floor(this.transit.delivered)));
    const tf = this.el.querySelector('#transfers');
    if (tf) set(tf, String(Math.floor(this.transit.transfers)));
    this.el.querySelectorAll('[data-wait]').forEach((el) => set(el, String(Math.floor(this.transit.stops.get(Number((el as HTMLElement).dataset.wait))?.waiting ?? 0))));
    this.el.querySelectorAll('[data-load]').forEach((el) => {
      const rid = Number((el as HTMLElement).dataset.load);
      const vs = this.transit.vehicles.filter((v) => v.routeId === rid);
      const cap = vs.reduce((s, v) => s + v.cap, 0);
      const load = vs.reduce((s, v) => s + v.load, 0);
      set(el, cap ? `${Math.round((load / cap) * 100)}%` : '-');
    });
    // Tolls: shown once the route has paid any. Red when they eat a large share of the fare income
    this.el.querySelectorAll<HTMLElement>('[data-tollrow]').forEach((el) => {
      const r = this.transit.routes.get(Number(el.dataset.tollrow));
      const toll = r?.toll ?? 0;
      el.hidden = toll < 1;
      if (el.hidden || !r) return;
      const share = (r.income ?? 0) > 0 ? Math.round((toll / (r.income ?? 1)) * 100) : 0;
      set(el, tr('通行料 {toll}/日(運賃収入の {share}%): 他社の道路・線路を走る代金です。', { toll: yen(toll), share }));
      el.classList.toggle('neg', share >= TOLL_WARN * 100);
    });
    this.el.querySelectorAll('[data-stuck]').forEach((el) => {
      const rid = Number((el as HTMLElement).dataset.stuck);
      set(el, String(this.transit.vehicles.filter((v) => v.routeId === rid && v.stuck > 20).length));
    });
    this.el.querySelectorAll('[data-late]').forEach((el) => {
      const r = this.transit.routes.get(Number((el as HTMLElement).dataset.late));
      set(el, r ? tr('{late}分', { late: ticksToMin(r.late) }) : '-');
    });
  }

  private routeHtml(r: Route): string {
    const veh = this.transit.vehicles.filter((v) => v.routeId === r.id).length;
    const hasTimed = r.orders.some((o) => o.kind === 'timed');
    const rows = r.orders
      .map((o, i) =>
        this.transit.stops.get(o.stopId)?.waypoint
          ? `<div class="orderw muted" data-r="${r.id}" data-o="${i}">${tr('{i}. ↪ 経由 {stopId} {i2}', { i: i + 1, stopId: this.stopName(o.stopId), i2: this.orderBtns(r, i) })}</div>`
          : `<div class="order" data-r="${r.id}" data-o="${i}">
        <span class="stopn">${i + 1}. ${this.stopName(o.stopId)} <em>${tr('待ち')}<span data-wait="${o.stopId}">0</span>${tr('人')}</em> <label class="pass" title="${tr('通過: この駅には停まらず通り抜ける(快速・特急)')}"><input type="checkbox" data-f="pass" ${o.pass ? 'checked' : ''}> ${tr('通過')}</label> ${this.orderBtns(r, i)}</span>
        <select data-f="kind">
          <option value="dwell" ${o.kind === 'dwell' ? 'selected' : ''}>${tr('間隔(停車)')}</option>
          <option value="full" ${o.kind === 'full' ? 'selected' : ''}>${tr('満載待ち')}</option>
          <option value="timed" ${o.kind === 'timed' ? 'selected' : ''}>${tr('時刻表')}</option>
        </select>${this.orderParams(o)}${this.condHtml(r, o)}</div>`,
      )
      .join('');
    const cur = modelOf(r.modelId);
    const kinds = kindsFor(r.mode)
      .map((k) => `<option value="${esc(k)}" ${k === cur.kind ? 'selected' : ''}>${esc(k)}</option>`)
      .join('');
    const models = modelsFor(r.mode)
      .filter((m) => m.kind === cur.kind)
      .map((m) => {
        const spec =
          r.mode === 'rail'
            ? tr('1両{cap}人・{maxCars}', { cap: m.cap, maxCars: m.minCars === m.maxCars ? tr('単行') : tr('{minCars}〜{maxCars}両', { minCars: m.minCars, maxCars: m.maxCars }) })
            : tr('定員{cap}', { cap: m.cap });
        return `<option value="${m.id}" ${m.id === cur.id ? 'selected' : ''}>${esc(m.name)} (${spec})</option>`;
      })
      .join('');
    // Rail: a single-car model is fixed at 1 car; a model of 2 or more cars can be any number of cars
    const cars = clampCars(cur, r.cars ?? cur.defaultCars);
    const carsHtml =
      r.mode === 'rail'
        ? cur.minCars === cur.maxCars
          ? `<span>${tr('1両(単行)')}</span>`
          : `<label>${tr('編成')} <input data-f="cars" type="number" min="${cur.minCars}" max="${cur.maxCars}" value="${cars}">${tr('両({minCars}〜{maxCars})・定員{cars}人', { minCars: cur.minCars, maxCars: cur.maxCars, cars: cur.cap * cars })}</label>`
        : '';
    const periods = PERIODS.map(([l, v]) => `<option value="${v}" ${v === r.period ? 'selected' : ''}>${l}</option>`).join('');
    return `<div class="route" data-r="${r.id}">
      <div class="rh"><i style="background:${hex(r.color)}"></i><b>${MODE_ICON[r.mode]}</b> <input data-f="rname" type="text" maxlength="24" value="${esc(r.name)}" title="${tr('路線名(入力して確定)')}" style="width:9em"> <em class="muted">ID:${r.id}</em> ${tr('車両 {veh}', { veh })}
        <button data-act="addveh" data-r="${r.id}" title="${tr('最寄りの車両基地から、この路線の既定の車種・両数で購入')}">${tr('＋車両')}</button>
        <button data-act="delveh" data-r="${r.id}" ${veh ? '' : 'disabled'}>${tr('－')}</button>
        <button data-act="delroute" data-r="${r.id}">${tr('削除')}</button></div>
      <div class="rm">
        <button data-act="share" data-r="${r.id}" title="${tr('同じオーダーで別の車種・本数を走らせる路線を作る(オーダーを編集すると全員に反映)')}">${tr('共有コピー')}</button>
        ${r.shared !== undefined ? `<span>${tr('🔗 共有{length}路線', { length: [...this.transit.routes.values()].filter((x) => x.shared === r.shared).length })}</span><button data-act="unshare" data-r="${r.id}">${tr('共有解除')}</button>` : ''}
        <button data-act="oins" data-r="${r.id}" data-o="${r.orders.length}" title="${tr('路線の最後に停留所を追加')}">${tr('＋停留所')}</button>
        <button data-act="autotime" data-r="${r.id}" title="${tr('区間の走行時間(実際に走った実測があれば実測、なければ経路からの見積もり)から時刻表(出発時刻と周期)を自動で作る')}">${tr('時刻表を自動作成')}</button>
      </div>
      <div class="rm">${tr('種別')} <select data-f="rank">${RANKS.map((k, i) => `<option value="${i}" ${(r.rank ?? 0) === i ? 'selected' : ''}>${k.name}</option>`).join('')}</select> <span class="muted">${tr('選ぶと通過駅を自動設定(各駅は「通過」で調整)')}</span></div>
      <div class="rm"><select data-f="mkind">${kinds}</select><select data-f="model">${models}</select></div>
      ${carsHtml ? `<div class="rm">${carsHtml}</div>` : ''}
      <div class="rm"><button data-act="replace" data-r="${r.id}" title="${tr('この路線の全車両を、上で選んだ車種に置き換える(旧車両は評価額の50%で下取り)')}">${tr('🔁 全車両をこの車種に置き換え')}</button></div>
      <div class="rm">${tr('運賃')} <input type="number" data-f="fare" min="${FARE_MUL_MIN * 100}" max="${FARE_MUL_MAX * 100}" step="10" value="${Math.round(fareMulOf(r) * 100)}" style="width:64px">% <span class="muted">${tr('標準=100%。高いと1人の収入は増えるが乗客が減る(需要 {fareDemand}%)', { fareDemand: Math.round(fareDemand(fareMulOf(r)) * 100) })}</span></div>
      <div class="rm">${tr('積載')} <b data-load="${r.id}">-</b> ${tr('/ 停滞')} <b data-stuck="${r.id}">0</b>${tr('台')}${hasTimed ? ` ${tr('/ 周期')} <select data-f="period">${periods}</select> ${tr('/ 遅延')} <b data-late="${r.id}">-</b>` : ''}</div>
      <div class="rm" data-tollrow="${r.id}" hidden></div>
      ${rows}
      <div class="rm muted">${tr('車両:')} ${
        this.transit.vehicles
          .filter((v) => v.routeId === r.id)
          .map((v) => `#${v.id}${r.mode === 'rail' ? tr('({cars}両)', { cars: v.cars }) : ''}`)
          .join(' ') || tr('なし')
      }</div></div>`;
  }

  /** Order row actions: up, down, delete, insert after this */
  private orderBtns(r: Route, i: number): string {
    const n = r.orders.length;
    return `<span class="ob"><button data-act="omove" data-r="${r.id}" data-o="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="${tr('上へ')}">▲</button><button data-act="omove" data-r="${r.id}" data-o="${i}" data-d="1" ${i === n - 1 ? 'disabled' : ''} title="${tr('下へ')}">▼</button><button data-act="oins" data-r="${r.id}" data-o="${i + 1}" title="${tr('この後ろに停留所を追加')}">${tr('＋')}</button><button data-act="odel" data-r="${r.id}" data-o="${i}" title="${tr('このオーダーを削除')}">✕</button></span>`;
  }

  /** Conditional jump on departure (if the condition holds, go to order N) */
  private condHtml(r: Route, o: Order): string {
    const c = o.cond;
    const kinds: [string, string][] = [
      ['', tr('なし')],
      ['load', tr('積載率')],
      ['wait', tr('待ち人数')],
      ['tod', tr('時刻')],
    ];
    const kindSel = `<select data-f="ckind">${kinds.map(([k, l]) => `<option value="${k}" ${(c?.kind ?? '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    if (!c) return `<div class="cond">${tr('出発時の条件 {kindSel}', { kindSel })}</div>`;
    const real = r.orders.map((x, i) => [x, i] as const).filter(([x]) => !this.transit.stops.get(x.stopId)?.waypoint);
    const to = `<select data-f="cto">${real.map(([, i]) => `<option value="${i}" ${c.to === i ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>`;
    const val =
      c.kind === 'tod'
        ? `<input data-f="cval" type="time" value="${todToHM((c.value / 1440) * DAY_TICKS)}">`
        : `<input data-f="cval" type="number" min="0" max="${c.kind === 'load' ? 100 : 9999}" value="${c.value}">${c.kind === 'load' ? '%' : tr('人')}`;
    return `<div class="cond">${tr('出発時の条件 {kindSel}', { kindSel })} <select data-f="cop"><option value="ge" ${c.op === 'ge' ? 'selected' : ''}>${tr('以上')}</option><option value="lt" ${c.op === 'lt' ? 'selected' : ''}>${tr('未満')}</option></select> ${tr('{val} なら {to}番へ', { val, to })}</div>`;
  }

  private orderParams(o: Order): string {
    if (o.kind === 'dwell') return `<label>${tr('停車')} <input data-f="dwell" type="number" min="1" max="600" value="${Math.round(o.dwell / 10)}">${tr('秒')}</label>`;
    if (o.kind === 'full') return `<label>${tr('最大')} <input data-f="maxWait" type="number" min="1" max="3600" value="${Math.round(o.maxWait / 10)}">${tr('秒')}</label>`;
    return `<label>${tr('発')} <input data-f="departTod" type="time" value="${todToHM(o.departTod)}"></label>`;
  }

  private onClick(e: Event): void {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') return this.onClose();
    const rid = Number(b.dataset.r);
    const tx = (m: 'removeRoute' | 'moveOrder' | 'removeOrder' | 'shareRoute' | 'unshareRoute' | 'autoTimetable' | 'removeVehicle', a: number[]) =>
      void this.send({ t: 'tx', m, a });
    if (act === 'build') this.startBuild(b.dataset.kind as Mode);
    else if (act === 'gen') {
      const k = b.dataset.kind as Mode;
      this.openMode = this.openMode === k ? null : k;
      this.openRoute = -1;
      this.transit.version++;
    } else if (act === 'pick') {
      this.openRoute = this.openRoute === rid ? -1 : rid;
      this.transit.version++;
    } else if (act === 'finish') this.finishBuild();
    else if (act === 'cancel') this.cancelBuild();
    else if (act === 'addveh') {
      // Vehicles are bought from the nearest of the company's depots (the server validates and charges)
      const route = this.transit.routes.get(rid);
      if (!route) return;
      const m = modelOf(route.modelId);
      void this.send({ t: 'buyVehicle', routeId: rid, modelId: route.modelId, cars: route.cars ?? m.defaultCars });
    } else if (act === 'delveh') {
      const last = [...this.transit.vehicles].reverse().find((v) => v.routeId === rid);
      if (last) void confirmDialog(tr('この路線の車両(#{id})を1台撤去します。よろしいですか?', { id: last.id })).then((ok) => ok && tx('removeVehicle', [last.id]));
    } else if (act === 'replace') void this.send({ t: 'routeReplace', routeId: rid });
    else if (act === 'delroute') {
      const r = this.transit.routes.get(rid);
      const n = this.transit.vehicles.filter((v) => v.routeId === rid).length;
      void confirmDialog(
        tr('路線「{name}」を削除します。元に戻せません。よろしいですか?', { name: r?.name ?? '' }) + (n ? '\n' + tr('この路線の車両 {n} 台も撤去されます。', { n }) : ''),
      ).then((ok) => ok && tx('removeRoute', [rid]));
    } else if (act === 'omove') tx('moveOrder', [rid, Number(b.dataset.o), Number(b.dataset.d)]);
    else if (act === 'odel') tx('removeOrder', [rid, Number(b.dataset.o)]);
    else if (act === 'oins') this.startInsert(rid, Number(b.dataset.o));
    else if (act === 'share') tx('shareRoute', [rid]);
    else if (act === 'unshare') tx('unshareRoute', [rid]);
    else if (act === 'autotime') tx('autoTimetable', [rid, todOf(this.getTick())]);
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const f = el.dataset.f;
    const routeEl = el.closest<HTMLElement>('.route');
    const route = routeEl && this.transit.routes.get(Number(routeEl.dataset.r));
    if (!route) return;
    const set = (patch: { name?: string; modelId?: string; cars?: number; period?: number; fareMul?: number }) => void this.send({ t: 'routeSet', routeId: route.id, patch });
    if (f === 'rname') return set({ name: el.value });
    if (f === 'rank') return void this.send({ t: 'routeRank', routeId: route.id, rank: Number(el.value), copy: false });
    if (f === 'mkind') {
      const first = modelsFor(route.mode).find((m) => m.kind === el.value);
      if (first) set({ modelId: first.id });
      return;
    }
    if (f === 'model') return set({ modelId: el.value });
    if (f === 'cars') return set({ cars: clampCars(modelOf(route.modelId), Number(el.value)) });
    if (f === 'period') return set({ period: Number(el.value) });
    if (f === 'fare') return set({ fareMul: Number(el.value) / 100 });
    const row = el.closest<HTMLElement>('.order');
    const index = row ? Number(row.dataset.o) : -1;
    const o = route.orders[index];
    if (!o) return;
    const patch: Record<string, unknown> = {};
    if (f === 'ckind') {
      if (!el.value) patch.cond = null;
      else {
        const k = el.value as OrderCond['kind'];
        const n = route.orders.length;
        patch.cond = { kind: k, op: 'ge', value: k === 'load' ? 80 : k === 'wait' ? 100 : 720, to: (index + 2) % n };
      }
    } else if (o.cond && f === 'cop') patch.cond = { ...o.cond, op: el.value };
    else if (o.cond && f === 'cval') patch.cond = { ...o.cond, value: o.cond.kind === 'tod' ? Math.round((hmToTod(el.value) / DAY_TICKS) * 1440) : Math.max(0, Number(el.value)) };
    else if (o.cond && f === 'cto') patch.cond = { ...o.cond, to: Number(el.value) };
    else if (f === 'pass') patch.pass = (el as HTMLInputElement).checked;
    else if (f === 'kind') patch.kind = el.value;
    else if (f === 'dwell') patch.dwell = Math.max(10, Number(el.value) * 10);
    else if (f === 'maxWait') patch.maxWait = Math.max(10, Number(el.value) * 10);
    else if (f === 'departTod') patch.departTod = hmToTod(el.value);
    else return;
    void this.send({ t: 'orderSet', routeId: route.id, index, patch });
  }
}
