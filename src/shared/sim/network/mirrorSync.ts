import { Depot, Flight, KIND_INDEX, Route, Stop, Vehicle } from './types';
import type { Transit } from './transit';

/** クライアント: サーバーから届いた構造・待ち人数・車両を反映し、なめらかに動かす */
export class MirrorSync {
  constructor(private readonly t: Transit) {}

  /** クライアント(閲覧側): サーバーから受け取った構造(停留所・路線・基地・信号)で置き換える。待ち人数の内訳は持たない */
  mirrorStruct(d: { nextId: number; routes: Route[]; stops: Stop[]; depots: Depot[]; signals: [number, number][]; grants?: [number, number[]][] }): void {
    this.t.nextId = d.nextId;
    this.t.grants = new Map((d.grants ?? []).map(([o, l]) => [o, new Set(l)]));
    const old = this.t.stops;
    this.t.stops = new Map(d.stops.map((s) => [s.id, { ...s, wait: new Map(), waiting: old.get(s.id)?.waiting ?? 0 }]));
    this.t.stopAt = new Map(d.stops.flatMap((s) => this.t.stopTiles(s).map((i) => [i * 3 + KIND_INDEX[s.kind], s.id] as [number, number])));
    this.t.routes = new Map(d.routes.map((r) => [r.id, r]));
    this.t.signals = new Map(d.signals);
    this.t.depots = new Map(d.depots.map((x) => [x.id, x]));
    this.t.depotAt = new Map(d.depots.map((x) => [x.idx, x.id]));
    this.t.version++;
  }

  /** クライアント: 待っている人の数だけ更新する */
  mirrorWaiting(list: [number, number][]): void {
    for (const s of this.t.stops.values()) s.waiting = 0;
    for (const [id, n] of list) {
      const s = this.t.stops.get(id);
      if (s) s.waiting = n;
    }
  }

  /** クライアント: 視界内の車両の最新状態を反映する(経路は変わったときだけ届くので前回のものを保つ) */
  mirrorVehicles(list: (Omit<Vehicle, 'path' | 'cargo'> & { path?: number[] })[], gone: number[]): void {
    for (const id of gone) {
      this.t.mirrorVeh.delete(id);
      this.t.snaps.delete(id);
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let changed = false;
    for (const m of list) {
      const prev = this.t.mirrorVeh.get(m.id);
      const path = m.path ? Uint32Array.from(m.path) : prev?.path;
      if (!path) continue; // 経路が未着(通常は起こらない)
      this.t.mirrorVeh.set(m.id, { ...(prev ?? ({ arrived: 0, until: 0, retryAt: 0, offset: 0 } as Vehicle)), ...m, path, cargo: prev?.cargo ?? new Map() } as Vehicle);
      if (!prev) changed = true;
      // 補間用に今回の状態を記録する(経路が同じときだけ、前回の状態との間を補間できる)
      const old = this.t.snaps.get(m.id);
      const same = old !== undefined && old.path === path;
      const flight = m.flight as Flight | null;
      this.t.snaps.set(m.id, {
        path,
        prev: same ? old.cur : null,
        prevAt: same ? old.curAt : now,
        curAt: now,
        cur: { pi: m.pi, t: m.t, trail: m.trail, done: flight ? flight.done : 0 },
      });
    }
    this.t.vehicles = [...this.t.mirrorVeh.values()];
    if (changed || gone.length) this.t.version++;
  }

  /**
   * クライアント: 描画のたびに呼ぶ。サーバーの状態は約10Hzでしか届かないので、直近2回の状態の間を、1区間ぶん遅らせて
   * 線形に補間し(経路上の進み pi+t、鉄道は編成の軌跡、飛行機は飛行距離)、60fpsでもなめらかに動かす。
   * 届くのが遅れたときは少しだけ先まで進め(外挿)、それ以上は止める。経路が変わったときは補間せず、そのまま出す。
   */
  smoothMirror(now: number = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
    for (const [id, v] of this.t.mirrorVeh) {
      const sn = this.t.snaps.get(id);
      if (!sn || !sn.prev) continue;
      const dt = sn.curAt - sn.prevAt;
      if (dt <= 0 || dt > 600) continue;
      const delay = Math.min(250, Math.max(60, dt));
      const a = Math.max(0, Math.min(1.25, (now - delay - sn.prevAt) / dt));
      const { prev, cur, path } = sn;
      if (v.flight) {
        const f = v.flight as Flight;
        f.done = Math.min(f.dist, prev.done + (cur.done - prev.done) * a);
        continue;
      }
      const last = path.length - 1;
      const p = Math.max(0, Math.min(last, prev.pi + prev.t + (cur.pi + cur.t - (prev.pi + prev.t)) * a));
      const pi = Math.min(last, Math.floor(p));
      v.pi = pi;
      v.t = pi >= last ? 0 : p - pi;
      if (v.mode === 'rail' && cur.trail.length) {
        // 先頭が pi にあるときの編成の軌跡(頭からの順): 現在のサーバーの軌跡と経路から組み立てる
        const diff = cur.pi - pi; // 表示の頭は、サーバーの頭より diff タイル後ろ
        const tr: number[] = [];
        for (let j = 0; j < cur.trail.length; j++) {
          const n = j + diff; // サーバーの頭から n タイル後ろ
          let tile: number;
          if (n < 0) tile = path[Math.min(last, cur.pi - n)];
          else if (n < cur.trail.length) tile = cur.trail[n];
          else tile = cur.pi - n >= 0 ? path[cur.pi - n] : cur.trail[cur.trail.length - 1];
          tr.push(tile);
        }
        v.trail = tr;
      }
    }
  }
}
