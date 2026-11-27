import { tr } from '../i18n';
import { ModalPanel } from './modalPanel';
import { DAY, MIN, type DiaRoute, type DiaStop, type Run, routeRuns, suggestPassing } from '../../shared/sim/network/diagram';
import { RANKS, type Transit, todOf } from '../../shared/sim/network/transit';
import { net } from '../connection/net';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const hm = (t: number) => {
  const m = Math.round((((t % DAY) + DAY) % DAY) / MIN) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * The timetable (train diagram) screen. Vertical = stations, horizontal = time, as a diagram of train lines.
 * Dragging a train (line) changes its departure offset; dragging a station dot (a circle) changes that station's departure time.
 * Places where an overtake occurs show up in "passing-loop suggestions" and can be applied with one click.
 */
export class DiagramPanel extends ModalPanel {
  private routeSel: HTMLSelectElement;
  private rangeSel: HTMLSelectElement;
  private startIn: HTMLInputElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sugEl: HTMLElement;
  private infoEl: HTMLElement;
  private lastKey = '';
  private mode: 'run' | 'node' = 'run';
  private drag: { kind: 'run' | 'node'; id: number; order: number; startX: number; orig: number; delta: number } | null = null;
  /** Information for hit testing, per draw */
  private hit: { runs: { vehId: number; pts: [number, number][]; offset: number }[]; nodes: { x: number; y: number; order: number; t: number; routeId: number }[] } = {
    runs: [],
    nodes: [],
  };
  private view = { x0: 0, span: DAY / 4, left: 110, top: 24, w: 700, h: 300 };

  constructor(
    modal: HTMLElement,
    body: HTMLElement,
    private transit: Transit,
    private getTick: () => number,
    private onMessage: (m: string) => void,
  ) {
    super(modal, 1000);
    body.innerHTML = `
      <div class="drow">
        <label>${tr('路線')} <select data-d="route"></select></label>
        <label>${tr('表示')} <select data-d="range"><option value="${DAY / 12}">${tr('2時間')}</option><option value="${DAY / 8}">${tr('3時間')}</option><option value="${DAY / 4}" selected>${tr('6時間')}</option><option value="${DAY / 2}">${tr('12時間')}</option><option value="${DAY}">${tr('24時間')}</option></select></label>
        <label>${tr('開始')} <input data-d="start" type="time" value="06:00"></label>
        <label><input type="radio" name="dmode" value="run" checked> ${tr('🚆 列車を動かす')}</label>
        <label><input type="radio" name="dmode" value="node"> ${tr('🕒 駅の時刻を動かす')}</label>
      </div>
      <div class="drow">
        <button data-d="auto" title="${tr('走行時間から時刻表(各駅の発車時刻と周期)を作る')}">${tr('時刻表を自動作成')}</button>
        <label>${tr('間隔')} <input data-d="interval" type="number" min="1" max="720" value="30" style="width:4em">${tr('分')}</label>
        <label>${tr('始発')} <input data-d="first" type="time" value="06:00"></label>
        <button data-d="bulk" title="${tr('時刻表がなければ作り、間隔に合う本数の車両を買い足して、等間隔に走らせます')}">${tr('運行本数を一括設定')}</button>
        <button data-d="rev" title="${tr('この路線を逆向きの路線として複製(時刻表も組み直す。車両は別に購入)')}">${tr('↔ 逆向きに複製')}</button>
        <label>${tr('ずらし')} <input data-d="shift" type="number" value="30" style="width:4em">${tr('分')}</label>
        <label>${tr('種別')} <select data-d="rank">${RANKS.slice(1)
          .map((k, i) => `<option value="${i + 1}" ${i === 1 ? 'selected' : ''}>${k.name}</option>`)
          .join('')}</select></label>
        <button data-d="rankcopy" title="${tr('この路線を元に、通過駅を自動で選んだ種別の路線を作る(元の路線は変わらない。時刻表は走行時間から組み直す)')}">${tr('🚄 種別の路線を作る')}</button>
        <button data-d="shiftcopy" title="${tr('時刻表を指定の分だけずらして複製')}">${tr('⏱ ずらして複製')}</button>
      </div>
      <canvas data-d="cv" style="width:100%;height:340px;background:#0b1420;border-radius:8px;touch-action:none"></canvas>
      <div class="muted" data-d="info"></div>
      <h3>${tr('待避の提案')}</h3>
      <div data-d="sug"></div>`;
    this.routeSel = body.querySelector('[data-d=route]')!;
    this.rangeSel = body.querySelector('[data-d=range]')!;
    this.startIn = body.querySelector('[data-d=start]')!;
    this.canvas = body.querySelector('[data-d=cv]')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.sugEl = body.querySelector('[data-d=sug]')!;
    this.infoEl = body.querySelector('[data-d=info]')!;
    modal.querySelector('#diaClose')?.addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => e.target === modal && this.close());
    for (const el of [this.routeSel, this.rangeSel, this.startIn]) el.addEventListener('change', () => this.draw());
    body.querySelectorAll<HTMLInputElement>('input[name=dmode]').forEach((r) => r.addEventListener('change', () => (this.mode = r.value as 'run' | 'node')));
    body.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-d]');
      const act = b?.dataset.d;
      const rid = Number(this.routeSel.value);
      if (!act || !rid) return;
      const val = (k: string) => (body.querySelector(`[data-d=${k}]`) as HTMLInputElement).value;
      const tmin = (s: string) => {
        const [h, m] = s.split(':').map(Number);
        return h * 60 + m;
      };
      const say = (p: Promise<{ ok: boolean; msg?: string; id?: number }>, after?: (id?: number) => void) =>
        void p.then((r) => (this.onMessage(r.msg ?? (r.ok ? tr('完了しました') : tr('失敗しました'))), r.ok && after?.(r.id)));
      if (act === 'auto') say(net.cmd({ t: 'tx', m: 'autoTimetable', a: [rid, todOf(this.getTick())] }));
      else if (act === 'bulk') say(net.cmd({ t: 'routeBulk', routeId: rid, intervalMin: Number(val('interval')), firstMin: tmin(val('first')) }));
      else if (act === 'rev') say(net.cmd({ t: 'routeClone', routeId: rid, reverse: true, shiftMin: 0 }), (id) => this.select(id));
      else if (act === 'rankcopy') say(net.cmd({ t: 'routeRank', routeId: rid, rank: Number(val('rank')), copy: true, shiftMin: 5 }), (id) => this.select(id));
      else if (act === 'shiftcopy') say(net.cmd({ t: 'routeClone', routeId: rid, reverse: false, shiftMin: Number(val('shift')) }), (id) => this.select(id));
      else if (b?.dataset.apply !== undefined) {
        const [routeId, from, delta] = b.dataset.apply.split(',').map(Number);
        say(net.cmd({ t: 'orderShift', routeId, from, delta }));
      }
    });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', () => this.up());
    this.canvas.addEventListener('pointercancel', () => (this.drag = null));
  }

  protected override onOpen(): void {
    this.lastKey = '';
    this.fillRoutes();
    this.draw();
  }

  private select(id?: number): void {
    if (id !== undefined) this.pendingSelect = id;
  }
  private pendingSelect = -1;

  private myRoutes() {
    return [...this.transit.routes.values()].filter((r) => r.owner === undefined || r.owner === net.id);
  }

  private fillRoutes(): void {
    const cur = this.pendingSelect >= 0 && this.transit.routes.has(this.pendingSelect) ? this.pendingSelect : Number(this.routeSel.value);
    const rs = this.myRoutes();
    const html = rs
      .map((r) => `<option value="${r.id}" ${r.id === cur ? 'selected' : ''}>${r.rank ? `[${RANKS[r.rank].name}] ` : ''}${esc(r.name)} (ID:${r.id})</option>`)
      .join('');
    if (this.routeSel.innerHTML !== html) this.routeSel.innerHTML = html;
    if (this.pendingSelect >= 0 && this.transit.routes.has(this.pendingSelect)) {
      this.routeSel.value = String(this.pendingSelect);
      this.pendingSelect = -1;
    }
  }

  protected render(): void {
    if (this.drag) return;
    this.fillRoutes();
    this.draw();
  }

  private diaStops(): Map<number, DiaStop> {
    const m = new Map<number, DiaStop>();
    for (const s of this.transit.stops.values()) m.set(s.id, { id: s.id, name: s.name, x: s.x, y: s.y, tracks: s.station?.tracks ?? 1 });
    return m;
  }

  private toDia(r: import('../../shared/sim/network/transit').Route): DiaRoute {
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      period: r.period,
      orders: r.orders.map((o) => ({ stopId: o.stopId, kind: o.kind, departTod: o.departTod, dwell: o.dwell, way: !!o.pass || !!this.transit.stops.get(o.stopId)?.waypoint })),
      legs: r.legs ?? r.orders.map(() => 0),
      vs: r.vs ?? [],
    };
  }

  /** Redraw the screen. Skipped if the data has not changed and nothing is being operated */
  draw(): void {
    const sel = this.transit.routes.get(Number(this.routeSel.value));
    const cv = this.canvas;
    const cssW = cv.clientWidth || 700;
    const cssH = cv.clientHeight || 340;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    if (!sel) {
      g.fillStyle = '#9ab';
      g.font = '13px sans-serif';
      g.fillText(tr('自社の路線がありません'), 20, 30);
      return;
    }
    const stops = this.diaStops();
    const dia = this.toDia(sel);
    const timed = sel.orders.some((o) => o.kind === 'timed');
    const [sh, sm] = this.startIn.value.split(':').map(Number);
    const span = Number(this.rangeSel.value);
    const x0 = (((sh || 0) * 60 + (sm || 0)) * MIN) % DAY;
    const left = 118;
    const top = 26;
    const w = cssW - left - 14;
    const rows = [...new Set(dia.orders.filter((o) => !o.way).map((o) => o.stopId))];
    const h = cssH - top - 14;
    this.view = { x0, span, left, top, w, h };
    const X = (t: number) => left + ((t - x0) / span) * w;
    const Y = (i: number) => top + (rows.length <= 1 ? h / 2 : (i / (rows.length - 1)) * h);
    // Grid and scale
    g.font = '11px sans-serif';
    g.textBaseline = 'middle';
    g.strokeStyle = '#243b57';
    g.fillStyle = '#9ab';
    const stepMin = span <= DAY / 8 ? 10 : span <= DAY / 4 ? 30 : 60;
    for (let t = Math.ceil(x0 / (stepMin * MIN)) * stepMin * MIN; t <= x0 + span; t += stepMin * MIN) {
      const x = X(t);
      g.beginPath();
      g.moveTo(x, top - 4);
      g.lineTo(x, top + h);
      g.stroke();
      g.textAlign = 'center';
      g.fillText(hm(t), x, top - 14);
    }
    g.textAlign = 'right';
    rows.forEach((sid, i) => {
      const y = Y(i);
      g.strokeStyle = '#1b2f48';
      g.beginPath();
      g.moveTo(left, y);
      g.lineTo(left + w, y);
      g.stroke();
      const st = stops.get(sid);
      g.fillStyle = (st?.tracks ?? 1) >= 2 ? '#8fd0ff' : '#cfe0f5';
      let label = `${st?.name ?? '?'}${(st?.tracks ?? 1) >= 2 ? ` ${tr('({tracks}線)', { tracks: st!.tracks })}` : ''}`;
      while (label.length > 2 && g.measureText(label).width > left - 12) label = label.slice(0, -2) + '…';
      g.fillText(label, left - 8, y);
    });
    // Current time
    const now = todOf(this.getTick());
    for (const base of [now, now + DAY, now - DAY]) {
      if (base >= x0 && base <= x0 + span) {
        g.strokeStyle = '#ffd24a88';
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(X(base), top - 4);
        g.lineTo(X(base), top + h);
        g.stroke();
        g.setLineDash([]);
      }
    }
    this.hit = { runs: [], nodes: [] };
    if (!timed) {
      g.fillStyle = '#ffcc66';
      g.textAlign = 'left';
      g.fillText(tr('この路線には時刻表がありません。「時刻表を自動作成」か「運行本数を一括設定」で作れます'), left, top + h / 2);
    }
    // Also draw faintly the company's other routes (with timetables) that pass two or more of the same stations
    const others = this.myRoutes().filter((r) => r.id !== sel.id && r.orders.some((o) => o.kind === 'timed') && r.orders.filter((o) => rows.includes(o.stopId)).length >= 2);
    const drawRun = (route: DiaRoute, run: Run, bold: boolean, dragDelta = 0) => {
      const col = hex(route.color);
      const P = route.period;
      const seq: { t: number; stopId: number; order: number; kind: 'arr' | 'dep' }[] = [];
      for (const p of run.points) {
        seq.push({ t: p.arr, stopId: p.stopId, order: p.order, kind: 'arr' });
        seq.push({ t: p.dep, stopId: p.stopId, order: p.order, kind: 'dep' });
      }
      seq.push({ t: run.backArr, stopId: run.points[0]?.stopId ?? 0, order: run.points[0]?.order ?? 0, kind: 'arr' });
      const kmin = Math.floor((x0 - (seq[seq.length - 1]?.t ?? 0) - dragDelta) / P) - 1;
      const kmax = Math.ceil((x0 + span - (seq[0]?.t ?? 0) - dragDelta) / P) + 1;
      for (let k = kmin; k <= kmax; k++) {
        g.strokeStyle = col;
        g.globalAlpha = bold ? 1 : 0.45;
        g.lineWidth = bold ? 2 : 1;
        g.beginPath();
        let started = false;
        const poly: [number, number][] = [];
        for (const s of seq) {
          const r = rows.indexOf(s.stopId);
          if (r < 0) continue;
          const px = X(s.t + k * P + dragDelta);
          const py = Y(r);
          poly.push([px, py]);
          if (!started) {
            g.moveTo(px, py);
            started = true;
          } else g.lineTo(px, py);
          if (bold && s.kind === 'dep' && px >= left - 4 && px <= left + w + 4) this.hit.nodes.push({ x: px, y: py, order: s.order, t: s.t + k * P, routeId: route.id });
        }
        g.stroke();
        g.globalAlpha = 1;
        g.lineWidth = 1;
        if (bold) this.hit.runs.push({ vehId: run.vehicleId, pts: poly, offset: run.offset });
        if (bold) {
          g.fillStyle = col;
          for (const n of this.hit.nodes.slice(-seq.length)) {
            g.beginPath();
            g.arc(n.x, n.y, 3, 0, 6.3);
            g.fill();
          }
        }
      }
    };
    // Clip so nothing spills outside the diagram (the station names on the left, the margin on the right)
    g.save();
    g.beginPath();
    g.rect(left, top - 6, w, h + 12);
    g.clip();
    for (const o of others) {
      const dr = this.toDia(o);
      for (const run of routeRuns(dr)) drawRun(dr, run, false);
    }
    if (timed) {
      for (const run of routeRuns(dia)) {
        const d = this.drag && this.drag.kind === 'run' && this.drag.id === run.vehicleId ? this.drag.delta : 0;
        drawRun(dia, run, true, d);
      }
    }
    g.restore();
    this.infoEl.textContent = timed
      ? tr('周期 {sel}分 ・ 編成 {length}本{tr}。{tr2}', {
          sel: Math.round(sel.period / MIN),
          length: dia.vs.length,
          tr: dia.vs.length === 0 ? tr('(想定線を表示中。車両を購入すると実際の線になります)') : '',
          tr2: this.mode === 'run' ? tr('線をドラッグすると、その列車の発車時刻がずれます') : tr('●をドラッグすると、その駅の発車時刻が変わります'),
        })
      : '';
    // Passing-loop suggestions (between the company's routes that have timetables)
    const cands = [sel, ...others];
    const key = JSON.stringify(cands.map((r) => [r.id, r.orders.map((o) => [o.stopId, o.kind, o.departTod, o.dwell]), r.vs, r.legs, r.period]));
    if (key !== this.lastKey) {
      this.lastKey = key;
      const sug =
        cands.length >= 2
          ? suggestPassing(
              cands.map((r) => this.toDia(r)),
              stops,
            )
          : [];
      this.sugEl.innerHTML = sug.length
        ? sug
            .map((s) =>
              s.problem
                ? `<div class="im">⚠ ${esc(s.problem)}</div>`
                : `<div class="im">${tr('{name} を', { name: esc(this.transit.routes.get(s.routeId)?.name ?? '') })} <b>${esc(s.stopName)}</b> ${tr('で約{waitMin}分 待避({byName} を先に通す)', { waitMin: s.waitMin, byName: esc(s.byName) })} <button data-apply="${s.routeId},${s.orderIdx},${Math.round(s.delta)}">${tr('適用')}</button></div>`,
            )
            .join('')
        : `<div class="muted">${tr('追い越しが起きる箇所はありません(停車駅の少ない路線を同じ線路に走らせると、ここに待避の提案が出ます)')}</div>`;
    }
  }

  // ---- Drag operations ----
  private pos(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    const p = this.pos(e);
    if (this.mode === 'node') {
      let best: (typeof this.hit.nodes)[number] | null = null;
      let bd = 12;
      for (const n of this.hit.nodes) {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      if (best) {
        this.drag = { kind: 'node', id: best.routeId, order: best.order, startX: p.x, orig: best.t, delta: 0 };
        this.canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
    let hitRun: { vehId: number; offset: number } | null = null;
    let bd = 8;
    for (const r of this.hit.runs) {
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const [ax, ay] = r.pts[i];
        const [bx, by] = r.pts[i + 1];
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / l2));
        const d = Math.hypot(p.x - (ax + t * (bx - ax)), p.y - (ay + t * (by - ay)));
        if (d < bd) {
          bd = d;
          hitRun = r;
        }
      }
    }
    if (hitRun && hitRun.vehId) {
      this.drag = { kind: 'run', id: hitRun.vehId, order: 0, startX: p.x, orig: hitRun.offset, delta: 0 };
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  private move(e: PointerEvent): void {
    if (!this.drag) return;
    const p = this.pos(e);
    const dt = ((p.x - this.drag.startX) / this.view.w) * this.view.span;
    this.drag.delta = Math.round(dt / MIN) * MIN;
    if (this.drag.kind === 'node') {
      // Preview: draw a marker at the dot's position
      this.draw();
      const g = this.ctx;
      g.fillStyle = '#ffd24a';
      g.beginPath();
      g.arc(this.view.left + ((this.drag.orig + this.drag.delta - this.view.x0) / this.view.span) * this.view.w, p.y, 5, 0, 6.3);
      g.fill();
      this.infoEl.textContent = tr('発車時刻 → {delta}', { delta: hm(this.drag.orig + this.drag.delta) });
    } else {
      this.draw();
      this.infoEl.textContent = tr('発車のずれ {delta}{this}分', { delta: this.drag.delta >= 0 ? '+' : '', this: Math.round(this.drag.delta / MIN) });
    }
  }

  private up(): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.delta === 0) return void this.draw();
    if (d.kind === 'run') void net.cmd({ t: 'vehOffset', id: d.id, offset: d.orig + d.delta }).then((r) => !r.ok && r.msg && this.onMessage(r.msg));
    else {
      const route = this.transit.routes.get(d.id);
      const o = route?.orders[d.order];
      if (route && o)
        void net
          .cmd({ t: 'orderSet', routeId: route.id, index: d.order, patch: { kind: 'timed', departTod: (((o.departTod + d.delta) % DAY) + DAY) % DAY } })
          .then((r) => !r.ok && r.msg && this.onMessage(r.msg));
    }
  }
}
