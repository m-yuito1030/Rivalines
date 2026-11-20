import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { CommandContext } from './context';
import { MINT, clampName, fail } from './util';
import { clampCars, modelOf } from '../../src/shared/data/models';
import { vehiclePrice, yen } from '../economyApi';

/** rename */
export function rename(cmd: Extract<Cmd, { t: 'rename' }>, ctx: CommandContext): CmdResult {
  const { t, who } = ctx;
  const name = clampName(cmd.name);
  if (!name) return fail('名前を入力してください');
  const e = cmd.kind === 'stop' ? t.stops.get(cmd.id) : t.depots.get(cmd.id);
  if (!e) return fail('見つかりません');
  if (e.owner && e.owner !== who) return fail('他社のものは名前を変えられません');
  e.name = name;
  t.version++;
  return { ok: true };
}

/** buyVehicle */
export function buyVehicle(cmd: Extract<Cmd, { t: 'buyVehicle' }>, ctx: CommandContext): CmdResult {
  const { sim, t, co, who, mine } = ctx;
  const r = t.routes.get(cmd.routeId);
  if (!mine(r)) return fail('自社の路線ではありません');
  const depot = cmd.depotId !== undefined ? t.depots.get(cmd.depotId) : t.nearestDepot(r.id);
  if (!depot) return fail('車両基地がありません。先に基地を置いてください');
  if (depot.owner && depot.owner !== who) return fail('他社の基地は使えません');
  const m = modelOf(cmd.modelId);
  const cars = m.mode === 'rail' ? clampCars(m, cmd.cars) : 1;
  const price = vehiclePrice(m, cars);
  if (!co.afford(price)) return fail(`資金が足りません(車両 ${yen(price)} / 現金 ${yen(co.cash)})。経営画面(F)で融資を受けられます`);
  const res = t.buyVehicle(depot.id, r.id, m.id, cars, sim.tick);
  if (!res.vehicle) return fail(`購入できません: ${res.reason}`);
  co.spend('vehicle', price);
  return { ok: true, id: res.vehicle.id, msg: `${m.name}を購入しました(${yen(price)})。路線のオーダーで運行します` };
}

/** vehPlan */
export function vehPlan(cmd: Extract<Cmd, { t: 'vehPlan' }>, ctx: CommandContext): CmdResult {
  const { t } = ctx;
  const plan = t.planAhead(Number(cmd.id), 3);
  return plan ? { ok: true, data: plan } : fail('車両が見つかりません');
}

/** vehOffset */
export function vehOffset(cmd: Extract<Cmd, { t: 'vehOffset' }>, ctx: CommandContext): CmdResult {
  const { t, mine } = ctx;
  const v = t.vehicles.find((x) => x.id === cmd.id);
  if (!v || !mine(t.routes.get(v.routeId))) return fail('自社の車両ではありません');
  const P = t.routes.get(v.routeId)!.period;
  v.offset = Math.round((((cmd.offset % P) + P) % P) / MINT) * MINT;
  t.version++;
  return { ok: true };
}
