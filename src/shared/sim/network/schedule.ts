import { modelOf } from '../../data/models';
import { DAY_TICKS, Departure, PERIOD_OPTIONS, RANKS, ROUTE_COLORS, Route, dirBetween, todOf } from './types';
import type { Transit } from './transit';

/** ダイヤ・発車案内・時刻表の自動作成・種別・路線の複製 */
export class Schedule {
  constructor(private readonly t: Transit) {}

  /** 停留所 i → 次の停留所 の走行見込み時間(tick)。経路がなければ null */
  legTicks(route: Route, i: number): number | null {
    const a = this.t.stops.get(route.orders[i].stopId);
    const j = this.t.realAfter(route, i);
    const b = this.t.stops.get(route.orders[j].stopId);
    if (!a || !b) return null;
    const speed = modelOf(route.modelId).speed;
    if (route.mode === 'air') return Math.hypot(a.x - b.x, a.y - b.y) / speed + 40; // 離着陸ぶん
    // 経由点を通る経路: a → 経由点… → b
    const tiles = [a.idx];
    for (let k = (i + 1) % route.orders.length; k !== j; k = (k + 1) % route.orders.length) tiles.push(this.t.stops.get(route.orders[k].stopId)!.idx);
    tiles.push(b.idx);
    let len = 0;
    for (let q = 0; q + 1 < tiles.length; q++) {
      const p = this.t.route(tiles[q], tiles[q + 1], route.mode === 'rail');
      if (!p) return null;
      len += p.length - 1;
      if (route.mode === 'rail') for (let k = 0; k + 1 < p.length; k++) if (dirBetween(p[k], p[k + 1], this.t.map.size) >= 4) len += Math.SQRT2 - 1;
    }
    return len / speed;
  }

  /**
   * 停留所の発車案内: この停留所に停まる各路線について、次に来る(停車中の)車両ごとの到着/発車までの tick を返す。
   * 見込みは走行時間(legTicks)と停車時間の積算で、渋滞などは反映しない。
   */
  departures(stopId: number, tick: number): Departure[] {
    const out: Departure[] = [];
    for (const route of this.t.routes.values()) {
      const n = route.orders.length;
      if (!route.orders.some((o, i) => o.stopId === stopId && !this.t.isWay(route, i)) || this.t.stops.get(stopId)?.waypoint) continue;
      for (const v of this.t.vehicles) {
        if (v.routeId !== route.id || v.hold) continue;
        const cur = v.order;
        const target = route.orders[cur];
        if (!target) continue;
        const nextName = (i: number) => this.t.stops.get(route.orders[this.t.realAfter(route, i)].stopId)?.name ?? '?';
        if (v.state === 'load' && target.stopId === stopId) {
          out.push({ routeId: route.id, vehicleId: v.id, eta: 0, stopped: true, leaveIn: Math.max(0, v.until - tick), toward: nextName(cur) });
          continue;
        }
        // 現在の位置から次のオーダー到着までの残り
        let acc: number;
        let idx: number; // 次に到着するオーダー
        if (v.state === 'load') {
          acc = Math.max(0, v.until - tick);
          const leg = this.legTicks(route, cur);
          if (leg === null) continue;
          acc += leg;
          idx = this.t.realAfter(route, cur);
        } else if (v.state === 'move') {
          if (v.mode === 'air' && v.flight) acc = Math.max(0, (v.flight.dist - v.flight.done) / v.speed);
          else acc = Math.max(0, v.path.length - 1 - v.pi - v.t) / v.speed;
          idx = cur;
        } else continue;
        for (let k = 0; k < n; k++) {
          if (route.orders[idx].stopId === stopId) {
            out.push({ routeId: route.id, vehicleId: v.id, eta: acc, stopped: false, leaveIn: 0, toward: nextName(idx) });
            break;
          }
          const leg = this.legTicks(route, idx);
          if (leg === null) break;
          acc += route.orders[idx].dwell + leg;
          idx = this.t.realAfter(route, idx);
        }
      }
    }
    return out.sort((a, b) => a.eta - b.eta);
  }

  /** 時刻表(時刻指定オーダー)の次の発車: 路線ごとに最大 count 件、(現在から何tick後か) */
  timetable(stopId: number, tick: number, count = 3): { routeId: number; etas: number[] }[] {
    const res: { routeId: number; etas: number[] }[] = [];
    for (const route of this.t.routes.values()) {
      const o = route.orders.find((x) => x.stopId === stopId && x.kind === 'timed' && !x.pass);
      if (!o) continue;
      const P = route.period;
      const first = (((o.departTod - todOf(tick)) % P) + P) % P;
      res.push({ routeId: route.id, etas: Array.from({ length: count }, (_, i) => first + i * P) });
    }
    return res;
  }

  /** 走行時間から時刻表を自動作成する(全オーダーを時刻指定にし、周期を決める)。失敗したら false */
  autoTimetable(routeId: number, startTod: number): boolean {
    const route = this.t.routes.get(routeId);
    if (!route) return false;
    const n = route.orders.length;
    const legs: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.t.isWay(route, i)) {
        legs.push(0);
        continue;
      }
      const l = route.legMeasured?.[i] ?? this.legTicks(route, i); // 実測があればそれを使う
      if (l === null || l === undefined) return false;
      legs.push(l);
    }
    const unit = DAY_TICKS / 1440; // 1分
    let t = startTod;
    let cycle = 0;
    for (let i = 0; i < n; i++) {
      if (this.t.isWay(route, i)) continue;
      const o = route.orders[i];
      o.kind = 'timed';
      o.departTod = Math.round((t % DAY_TICKS) / unit) * unit;
      const leg = legs[i] * 1.15 + unit; // 余裕15%+1分
      const step = leg + o.dwell;
      t += step;
      cycle += step;
    }
    const fit = PERIOD_OPTIONS.filter(([, v]) => v >= cycle * 1.05).map(([, v]) => v);
    route.period = fit.length ? Math.min(...fit) : DAY_TICKS;
    this.t.version++;
    return true;
  }

  /**
   * 種別を設定し、停車駅を自動で選ぶ: 始発・折り返し(最も遠い駅)は必ず停車、途中駅は人口の多い駅・番線の多い駅を優先して残し、残りを通過にする。
   * 時刻表があれば走行時間から組み直す。普通(0)は全駅停車に戻す。
   */
  applyRank(routeId: number, rank: number): boolean {
    const r = this.t.routes.get(routeId);
    if (!r || rank < 0 || rank >= RANKS.length) return false;
    // 通過に設定済みの駅も対象にするため、経由点でない全オーダーを候補にする
    const cand = r.orders.map((o, i) => (this.t.stops.get(o.stopId)?.waypoint ? -1 : i)).filter((i) => i >= 0);
    const ids = [...new Set(cand.map((i) => r.orders[i].stopId))];
    if (ids.length < 2) return false;
    const first = this.t.stops.get(r.orders[cand[0]].stopId)!;
    let far = ids[ids.length - 1];
    let fd = -1;
    for (const id of ids) {
      const s = this.t.stops.get(id)!;
      const d = Math.hypot(s.x - first.x, s.y - first.y);
      if (d > fd) {
        fd = d;
        far = id;
      }
    }
    const must = new Set([first.id, far]);
    const mid = ids.filter((id) => !must.has(id));
    const score = (id: number) => {
      const s = this.t.stops.get(id)!;
      return s.pop + (s.fpop ?? 0) + (s.station && s.station.tracks >= 2 ? 100000 : 0);
    };
    const keepN = rank === 0 ? mid.length : Math.ceil(mid.length * RANKS[rank].keep);
    const keep = new Set([...mid].sort((a, b) => score(b) - score(a)).slice(0, keepN));
    const firstTimed = r.orders.find((o, i) => o.kind === 'timed' && !this.t.isWay(r, i));
    for (const o of r.orders) {
      if (this.t.stops.get(o.stopId)?.waypoint) continue;
      o.pass = must.has(o.stopId) || keep.has(o.stopId) ? undefined : true;
    }
    r.rank = rank;
    r.legMeasured = undefined;
    if (firstTimed && r.orders.some((o) => o.kind === 'timed')) this.autoTimetable(r.id, firstTimed.departTod);
    this.t.orderEdit.syncOrders(r.id);
    this.t.version++;
    return true;
  }

  /**
   * 車両がこの先に辿る経路の予定(表示用)。現在向かっている/停車中の停留所から、次の停車駅へ最大 maxLegs 区間。
   * 鉄道は途中の経由点・通過駅を順に通る。各区間はタイル index の列。航空は空
   */
  planAhead(vehicleId: number, maxLegs = 3): { legs: number[][]; stops: number[] } | null {
    const v = this.t.vehicles.find((x) => x.id === vehicleId);
    const route = v && this.t.routes.get(v.routeId);
    if (!v || !route) return null;
    if (v.mode === 'air') return { legs: [], stops: [] };
    const n = route.orders.length;
    const legs: number[][] = [];
    const stops: number[] = [];
    let cur = v.order;
    let total = 0;
    for (let k = 0; k < maxLegs && total < 4000; k++) {
      const from = this.t.stops.get(route.orders[cur]?.stopId);
      if (!from) break;
      const tiles = [from.idx];
      let next = (cur + 1) % n;
      for (let g = 0; g < n; g++) {
        const w = this.t.stops.get(route.orders[next].stopId);
        if (!w || !this.t.isWay(route, next)) break;
        if (v.mode === 'rail') tiles.push(w.idx);
        next = (next + 1) % n;
      }
      const dest = this.t.stops.get(route.orders[next].stopId);
      if (!dest || next === cur) break;
      tiles.push(dest.idx);
      const leg: number[] = [];
      let ok = true;
      for (let q = 0; q + 1 < tiles.length; q++) {
        const p = this.t.route(tiles[q], tiles[q + 1], v.mode === 'rail');
        if (!p) {
          ok = false;
          break;
        }
        for (let i = leg.length ? 1 : 0; i < p.length; i++) leg.push(p[i]);
      }
      if (!ok) break;
      legs.push(leg);
      stops.push(next);
      total += leg.length;
      cur = next;
    }
    return { legs, stops };
  }

  /** 路線を複製する。reverse=逆向き(オーダーを逆順に)、shiftTicks=時刻表をずらす量。車両は複製しない */
  cloneRoute(routeId: number, reverse: boolean, shiftTicks: number): Route | null {
    const src = this.t.routes.get(routeId);
    if (!src) return null;
    const id = this.t.nextId++;
    const list = reverse ? [...src.orders].reverse() : src.orders;
    const copy: Route = {
      ...src,
      id,
      name: `${src.name}${reverse ? '(逆)' : shiftTicks ? `(+${Math.round(shiftTicks / (DAY_TICKS / 1440))}分)` : '(複製)'}`,
      color: ROUTE_COLORS[this.t.routes.size % ROUTE_COLORS.length],
      orders: list.map((o) => ({ ...o, cond: undefined, departTod: o.kind === 'timed' ? (((o.departTod + shiftTicks) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS : o.departTod })),
      shared: undefined,
      late: 0,
      carried: 0,
      legMeasured: undefined,
      dayRevenue: 0,
      income: 0,
      profit: 0,
      vs: undefined,
      legs: undefined,
      owner: this.t.actor || undefined,
    };
    this.t.routes.set(id, copy);
    if (reverse && copy.orders.some((o) => o.kind === 'timed')) {
      // 逆向きの時刻表は、元の最後の発車の少しあとから、走行時間で組み直す
      const last = [...src.orders].reverse().find((o) => o.kind === 'timed');
      if (last) this.autoTimetable(id, last.departTod + last.dwell + 5 * (DAY_TICKS / 1440) + shiftTicks);
    }
    this.t.version++;
    return copy;
  }

  /** ダイヤ画面用: 路線のオーダーごとの次の停車駅までの走行時間(実測があれば実測)。時刻指定がなければ空 */
  legsOf(route: Route): number[] {
    return route.orders.map((_, i) => (this.t.isWay(route, i) ? 0 : (route.legMeasured?.[i] ?? this.legTicks(route, i) ?? 0)));
  }
}
