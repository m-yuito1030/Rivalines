import { DEFAULT_DWELL, ROUTE_COLORS, Route } from './types';
import type { Transit } from './transit';

/** Editing a route's orders (insert, delete, reorder, share) */
export class OrderEditor {
  constructor(private readonly t: Transit) {}

  // ---------------------------------------------------------------- Editing orders (insert, delete, reorder)
  /** Routes in the same sharing group (just itself if not shared) */
  groupOf(r: Route): Route[] {
    return r.shared === undefined ? [r] : [...this.t.routes.values()].filter((x) => x.shared === r.shared);
  }

  /** Apply an order renumbering (old -> new; undefined invalidates the jump target of a condition) to the route's vehicles and conditions */
  remapOrders(r: Route, f: (i: number) => number | undefined): void {
    for (const o of r.orders) {
      if (!o.cond) continue;
      const to = f(o.cond.to);
      if (to === undefined) o.cond = undefined;
      else o.cond.to = to;
    }
    for (const v of this.t.vehicles) if (v.routeId === r.id) v.order = f(v.order) ?? v.order;
  }

  /** Insert a stop order at position `index` (0..n). The same operation applies to routes sharing the orders */
  insertOrder(routeId: number, index: number, stopId: number): { ok: boolean; reason?: string } {
    const r = this.t.routes.get(routeId);
    const s = this.t.stops.get(stopId);
    if (!r || !s) return { ok: false, reason: '路線または停留所がありません' };
    if (s.kind !== r.mode) return { ok: false, reason: '種別の違う停留所は追加できません' };
    if (this.t.actor && !this.t.mayUse(s, this.t.actor)) return { ok: false, reason: '他社の停留所は、持ち主の許可がないと使えません' };
    index = Math.max(0, Math.min(r.orders.length, index));
    for (const g of this.groupOf(r)) {
      g.orders.splice(index, 0, { stopId, kind: 'dwell', dwell: DEFAULT_DWELL[g.mode], maxWait: 300, departTod: 0 });
      // Shift the numbers from the insertion point on (except the newly inserted order itself)
      this.remapOrders(g, (i) => (i >= index ? i + 1 : i));
      g.legMeasured = undefined;
    }
    this.t.version++;
    return { ok: true };
  }

  /** Delete the order at `index`. Not allowed if a vehicle is heading to / stopped at that order, or if fewer than two stops would remain */
  removeOrder(routeId: number, index: number): { ok: boolean; reason?: string } {
    const r = this.t.routes.get(routeId);
    if (!r || index < 0 || index >= r.orders.length) return { ok: false, reason: 'オーダーがありません' };
    const real = r.orders.filter((_o, i) => i !== index && !this.t.isWay(r, i)).length;
    if (real < 2) return { ok: false, reason: '停車する停留所が2つ未満になります' };
    const group = this.groupOf(r);
    if (this.t.vehicles.some((v) => group.some((g) => g.id === v.routeId) && v.order === index))
      return { ok: false, reason: 'このオーダーへ向かう/停車中の車両がいるため、今は削除できません' };
    for (const g of group) {
      g.orders.splice(index, 1);
      this.remapOrders(g, (i) => (i === index ? undefined : i > index ? i - 1 : i));
      for (const v of this.t.vehicles) if (v.routeId === g.id && v.order >= g.orders.length) v.order = 0;
      g.legMeasured = undefined;
    }
    this.t.version++;
    return { ok: true };
  }

  /** Move the order at `index` in direction `dir` (-1 = earlier / +1 = later) */
  moveOrder(routeId: number, index: number, dir: -1 | 1): { ok: boolean; reason?: string } {
    const r = this.t.routes.get(routeId);
    if (dir !== -1 && dir !== 1) return { ok: false, reason: '動かす向きが正しくありません' };
    const j = index + dir;
    if (!r || !Number.isInteger(index) || index < 0 || index >= r.orders.length || j < 0 || j >= r.orders.length) return { ok: false, reason: 'これ以上動かせません' };
    for (const g of this.groupOf(r)) {
      [g.orders[index], g.orders[j]] = [g.orders[j], g.orders[index]];
      this.remapOrders(g, (i) => (i === index ? j : i === j ? index : i));
      g.legMeasured = undefined;
    }
    this.t.version++;
    return { ok: true };
  }

  /** Share a route's orders: create a new route with the same orders and period and put it in the sharing group */
  shareRoute(routeId: number): Route | null {
    const src = this.t.routes.get(routeId);
    if (!src) return null;
    const group = src.shared ?? src.id;
    src.shared = group;
    const id = this.t.nextId++;
    const copy: Route = {
      ...src,
      id,
      name: `${src.name}(共有)`,
      color: ROUTE_COLORS[this.t.routes.size % ROUTE_COLORS.length],
      orders: src.orders.map((o) => ({ ...o, cond: o.cond ? { ...o.cond } : undefined })),
      shared: group,
      late: 0,
      carried: 0,
      owner: this.t.actor || undefined,
    };
    this.t.routes.set(id, copy);
    this.t.version++;
    return copy;
  }

  /** Stop sharing (the orders stay as they are now, but become independent) */
  unshareRoute(routeId: number): void {
    const r = this.t.routes.get(routeId);
    if (!r || r.shared === undefined) return;
    const group = r.shared;
    r.shared = undefined;
    const rest = [...this.t.routes.values()].filter((x) => x.shared === group);
    if (rest.length === 1) rest[0].shared = undefined;
    this.t.version++;
  }

  /** Reflect this route's orders and period onto the other routes sharing them (call after every edit) */
  syncOrders(routeId: number): void {
    const src = this.t.routes.get(routeId);
    if (!src || src.shared === undefined) return;
    for (const r of this.t.routes.values()) {
      if (r.id === src.id || r.shared !== src.shared) continue;
      r.orders = src.orders.map((o) => ({ ...o, cond: o.cond ? { ...o.cond } : undefined }));
      r.period = src.period;
    }
    this.t.version++;
  }
}
