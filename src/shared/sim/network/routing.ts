import type { Route } from './transit';

/** 乗り換え1回のコスト(停車駅数換算) */
export const TRANSFER_PENALTY = 6;
const K = 2097152; // 状態キー: stopId * K + routeId

export interface RouteTable {
  /** 目的地の停留所 → いま乗るべき路線 */
  next: Map<number, number>;
  /** 目的地の一覧(next のキー)。乗客の目的地抽選用 */
  dests: number[];
  /** 目的地の重み(累積)。弱い人口依存。表の作成時に1度だけ計算する */
  cum: Float64Array;
}

/**
 * 路線網の最短経路(停車駅数 + 乗り換えペナルティ)から、各停留所で
 * 「どの目的地へはどの路線に乗るか」を求める。路線が変わるまでキャッシュする。
 */
export class Router {
  private cache = new Map<number, RouteTable>();
  private ver = -1;

  constructor(
    private getRoutes: () => Iterable<Route>,
    private weightOf: (stopId: number) => number = () => 1,
  ) {}

  table(stopId: number, version: number): RouteTable {
    if (version !== this.ver) {
      this.cache.clear();
      this.ver = version;
    }
    let t = this.cache.get(stopId);
    if (!t) {
      t = this.compute(stopId);
      this.cache.set(stopId, t);
    }
    return t;
  }

  private compute(src: number): RouteTable {
    const routes = [...this.getRoutes()];
    // stop → その停留所を通る路線
    const byStop = new Map<number, Route[]>();
    for (const r of routes) {
      for (const o of r.orders) {
        const l = byStop.get(o.stopId) ?? [];
        if (!l.includes(r)) l.push(r);
        byStop.set(o.stopId, l);
      }
    }
    const dist = new Map<number, number>();
    const first = new Map<number, number>();
    // 簡易ダイクストラ(状態数が小さいので配列の線形探索で十分)
    let open: number[] = [];
    for (const r of byStop.get(src) ?? []) {
      const k = src * K + r.id;
      dist.set(k, 0);
      first.set(k, r.id);
      open.push(k);
    }
    const routeById = new Map(routes.map((r) => [r.id, r]));
    const done = new Set<number>();
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (dist.get(open[i])! < dist.get(open[bi])!) bi = i;
      const k = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (done.has(k)) continue;
      done.add(k);
      const stop = Math.floor(k / K);
      const rid = k % K;
      const d = dist.get(k)!;
      const f = first.get(k)!;
      const relax = (nk: number, nd: number) => {
        if (nd < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nd);
          first.set(nk, f);
          open.push(nk);
        }
      };
      const r = routeById.get(rid)!;
      const n = r.orders.length;
      for (let i = 0; i < n; i++) if (r.orders[i].stopId === stop) relax(r.orders[(i + 1) % n].stopId * K + rid, d + 1);
      for (const r2 of byStop.get(stop) ?? []) if (r2.id !== rid) relax(stop * K + r2.id, d + TRANSFER_PENALTY);
    }
    // 目的地ごとに最小コストの状態の「最初の路線」を採用
    const best = new Map<number, number>();
    const next = new Map<number, number>();
    for (const [k, d] of dist) {
      const stop = Math.floor(k / K);
      if (stop === src) continue;
      if (d < (best.get(stop) ?? Infinity)) {
        best.set(stop, d);
        next.set(stop, first.get(k)!);
      }
    }
    open = [];
    const dests = [...next.keys()];
    const cum = new Float64Array(dests.length);
    let acc = 0;
    dests.forEach((d, i) => {
      acc += this.weightOf(d);
      cum[i] = acc;
    });
    return { next, dests, cum };
  }
}
