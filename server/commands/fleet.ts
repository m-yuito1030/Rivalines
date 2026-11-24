import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { CommandContext } from './context';
import { MINT, clampName, fail } from './util';
import { clampCars, modelOf } from '../../src/shared/data/models';
import { vehiclePrice, yen } from '../economyApi';
import { isReservedName } from '../reservedNames';

/** rename */
export function rename(cmd: Extract<Cmd, { t: 'rename' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { t, who } = ctx;
  const name = clampName(cmd.name);
  if (!name) return fail(tr('名前を入力してください'));
  if (cmd.kind === 'facility') {
    // 施設: 自社の施設だけ。運営や公式と紛らわしい名前は使えない
    const f = ctx.map.facilities.find((x) => x.id === cmd.id);
    if (!f) return fail(tr('見つかりません'));
    if ((f.owner ?? 'player') !== 'player' || f.playerId !== who) return fail(tr('自社の施設ではありません'));
    if (isReservedName(name)) return fail(tr('運営や公式と紛らわしい名前は使えません'));
    f.name = name;
    ctx.map.facilityVer++; // 施設の一覧を、接続中の全員に送り直す
    return { ok: true };
  }
  const e = cmd.kind === 'stop' ? t.stops.get(cmd.id) : t.depots.get(cmd.id);
  if (!e) return fail(tr('見つかりません'));
  if (e.owner && e.owner !== who) return fail(tr('他社のものは名前を変えられません'));
  e.name = name;
  t.version++;
  return { ok: true };
}

/** buyVehicle */
export function buyVehicle(cmd: Extract<Cmd, { t: 'buyVehicle' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { sim, t, co, who, mine } = ctx;
  const r = t.routes.get(cmd.routeId);
  if (!mine(r)) return fail(tr('自社の路線ではありません'));
  const depot = cmd.depotId !== undefined ? t.depots.get(cmd.depotId) : t.nearestDepot(r.id);
  if (!depot) return fail(tr('車両基地がありません。先に基地を置いてください'));
  if (depot.owner && depot.owner !== who) return fail(tr('他社の基地は使えません'));
  const m = modelOf(cmd.modelId);
  const cars = m.mode === 'rail' ? clampCars(m, cmd.cars) : 1;
  const price = vehiclePrice(m, cars);
  if (!co.afford(price)) return fail(tr('資金が足りません(車両 {price} / 現金 {co})。経営画面(F)で融資を受けられます', { price: yen(price), co: yen(co.cash) }));
  const res = t.buyVehicle(depot.id, r.id, m.id, cars, sim.tick);
  if (!res.vehicle) return fail(tr('購入できません: {reason}', { reason: tr(res.reason ?? '') }));
  co.spend('vehicle', price);
  return { ok: true, id: res.vehicle.id, msg: tr('{name}を購入しました({price})。路線のオーダーで運行します', { name: m.name, price: yen(price) }) };
}

/** vehPlan */
export function vehPlan(cmd: Extract<Cmd, { t: 'vehPlan' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { t } = ctx;
  const plan = t.planAhead(Number(cmd.id), 3);
  return plan ? { ok: true, data: plan } : fail(tr('車両が見つかりません'));
}

/** vehOffset */
export function vehOffset(cmd: Extract<Cmd, { t: 'vehOffset' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { t, mine } = ctx;
  const v = t.vehicles.find((x) => x.id === cmd.id);
  if (!v || !mine(t.routes.get(v.routeId))) return fail(tr('自社の車両ではありません'));
  const P = t.routes.get(v.routeId)!.period;
  v.offset = Math.round((((cmd.offset % P) + P) % P) / MINT) * MINT;
  t.version++;
  return { ok: true };
}
