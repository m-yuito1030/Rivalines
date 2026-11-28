import { legacyCarsOf, modelOf } from '../../data/models';
import { KIND_INDEX, Stop, TransitSave } from './types';
import type { Transit } from './transit';

/** Save/load (turn Transit's state into a form for saving) */
export class TransitStore {
  constructor(private readonly t: Transit) {}

  save(): TransitSave {
    return {
      nextId: this.t.nextId,
      delivered: this.t.delivered,
      transfers: this.t.transfers,
      stops: [...this.t.stops.values()].map((s) => ({ ...s, wait: [...s.wait] })),
      routes: [...this.t.routes.values()],
      signals: [...this.t.signals],
      grants: [...this.t.grants].map(([o, l]) => [o, [...l]] as [number, number[]]),
      depots: [...this.t.depots.values()],
      vehicles: this.t.vehicles.map((v) => ({ ...v, path: Array.from(v.path), cargo: [...v.cargo] })),
    };
  }

  restore(d: TransitSave): void {
    this.t.nextId = d.nextId;
    this.t.delivered = d.delivered;
    this.t.transfers = d.transfers ?? 0;
    this.t.stops = new Map(d.stops.map((s) => [s.id, { ...s, wait: new Map(s.wait) }]));
    this.t.stopAt = new Map(d.stops.flatMap((s) => this.t.stopTiles(s as unknown as Stop).map((i) => [i * 3 + KIND_INDEX[s.kind], s.id] as [number, number])));
    this.t.routes = new Map(d.routes.map((r) => [r.id, r]));
    this.t.signals = new Map(d.signals ?? []);
    this.t.grants = new Map((d.grants ?? []).map(([o, l]) => [o, new Set(l)]));
    this.t.depots = new Map((d.depots ?? []).map((x) => [x.id, x]));
    this.t.depotAt = new Map((d.depots ?? []).map((x) => [x.idx, x.id]));
    this.t.vehicles = d.vehicles.map((v) => ({
      ...v,
      path: Uint32Array.from(v.path),
      cargo: new Map(v.cargo),
      cars: v.cars ?? legacyCarsOf(v.modelId) ?? modelOf(v.modelId).defaultCars,
      hold: v.hold ?? false,
      resTo: v.resTo ?? v.path.length - 1,
    }));
    this.t.reserved.clear();
    this.t.lane.clear();
    for (const v of this.t.vehicles) {
      if (v.mode === 'road') this.t.lane.set(this.t.laneKey(v), v.id);
      if (v.mode !== 'rail') continue;
      for (const t of v.trail) this.t.reserved.set(t, v.id);
      if (v.state === 'move') for (let i = v.pi + 1; i <= Math.min(v.resTo, v.path.length - 1); i++) this.t.reserved.set(v.path[i], v.id);
    }
    this.t.air.afterRestore();
    this.t.version++;
  }
}
