import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { CommandContext } from './context';
import { fail } from './util';
import { blockingRight } from '../../src/shared/sim/economy/auctions';
import { placeAirport } from '../../src/shared/world/airports';
import { AIRPORT_DESIGNS, AIRPORT_NAMES, AIRPORT_SIZES, type AirportSize, airportFootprint } from '../../src/shared/world/airportLayout';
import { STATIONMALL_RANGE, nearRailStop } from '../../src/shared/world/facilities';
import { DESIGN_COUNT, FACILITY_SPECS, FACILITY_TYPES, SPRITE_TYPES, facilityCost, facilityDims, placeFacility, planFacility } from '../../src/shared/world/facilities';
import type { FacilitySize, FacilityType } from '../../src/shared/world/facilities';
import { AIRPORT_PRICES, PRICES, yen } from '../economyApi';

/** ensureStop */
export function ensureStop(cmd: Extract<Cmd, { t: 'ensureStop' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { t, co, who } = ctx;
  {
    const ex = t.stopAtTile(cmd.x, cmd.y, cmd.kind);
    if (ex && !t.mayUse(ex, who)) return fail(tr('「{name}」は他社の停留所です。持ち主の許可がないと使えません', { name: ex.name }));
  }
  if (t.stopAtTile(cmd.x, cmd.y, cmd.kind)) {
    const st = t.addStop(cmd.x, cmd.y, cmd.kind);
    return st ? { ok: true, id: st.id } : fail(tr('停留所を置けません'));
  }
  const cost = cmd.kind === 'rail' ? PRICES.stationBase + PRICES.stationTile : PRICES.stop;
  if (!co.afford(cost)) return fail(tr('資金が足りません(新しい停留所 {cost})', { cost: yen(cost) }));
  const st = t.addStop(cmd.x, cmd.y, cmd.kind);
  if (!st) return fail(tr('ここには停留所を置けません'));
  co.spend('build', cost);
  return { ok: true, id: st.id };
}

/** place */
export function place(cmd: Extract<Cmd, { t: 'place' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { sim, map, t, co, who, facOcc, charge } = ctx;
  const { tool, x, y } = cmd;
  if (tool === 'stop') {
    const had = !!t.stopAtTile(x, y, 'road');
    if (!had && !co.afford(PRICES.stop)) return fail(tr('資金が足りません(バス停 {PRICES})', { PRICES: yen(PRICES.stop) }));
    const st = t.addStop(x, y, 'road');
    if (!st) return fail(tr('ここにはバス停を置けません'));
    if (!had) co.spend('build', PRICES.stop);
    return { ok: true, id: st.id };
  }
  if (tool === 'station') {
    const o = cmd.opts;
    if (!o) return fail(tr('駅の設定がありません'));
    const cost = PRICES.stationBase + PRICES.stationTile * o.len * o.tracks;
    if (!co.afford(cost)) return fail(tr('資金が足りません(駅 {cost})', { cost: yen(cost) }));
    const r = t.addStation(x, y, o);
    if (!r.stop) return fail(tr('駅を置けません: {reason}', { reason: tr(r.reason ?? '') }));
    co.spend('build', cost);
    return {
      ok: true,
      id: r.stop.id,
      msg: tr('{name}を設置しました({tracks}番線・ホーム長{len}・{cost})。両端の線路を自分でつなぎます', { name: r.stop.name, tracks: o.tracks, len: o.len, cost: yen(cost) }),
    };
  }
  if ((FACILITY_TYPES as string[]).includes(tool)) {
    const type = tool as FacilityType;
    const spec = FACILITY_SPECS[type];
    const sprite = SPRITE_TYPES.includes(type);
    if (blockingRight(sim.auctions, map.towns, who, type, x, y))
      return fail(tr('この街の{name}の独占権は他社が持っています(別の街に建てるか、次の競りに参加してください)', { name: spec.name }));
    // The player may choose any design and size (if unspecified: the largest size, with the design determined by location)
    const nDesign = DESIGN_COUNT[type] ?? 20;
    const size: FacilitySize = cmd.fac?.size ?? 'L';
    if (!['S', 'M', 'L'].includes(size)) return fail(tr('大きさが正しくありません'));
    if (cmd.fac && !(Number.isInteger(cmd.fac.design) && cmd.fac.design >= 0 && cmd.fac.design < nDesign)) return fail(tr('デザインが正しくありません'));
    const plan = planFacility(map, x, y, type, facOcc, sprite ? facilityDims(type, size) : undefined);
    if (!plan.ok) return fail(tr('{name}を建てられません: {reason}', { name: spec.name, reason: tr(plan.reason ?? '') }));
    if (type === 'stationmall' && !nearRailStop(t.stops.values(), plan, STATIONMALL_RANGE))
      return fail(tr('駅ビルは鉄道の駅から{STATIONMALL_RANGE}タイル以内にだけ建てられます', { STATIONMALL_RANGE }));
    const cost = sprite ? facilityCost(type, size) : spec.cost;
    const bad = charge(cost, 'build', spec.name);
    if (bad) return bad;
    const f = placeFacility(map, plan, type);
    f.playerId = who;
    if (sprite) {
      f.size = size;
      f.design = cmd.fac?.design ?? (plan.x0 * 31 + plan.y0 * 17 + f.id * 7) % nDesign;
    }
    return { ok: true, msg: tr('{name}を建設しました({cost})。{desc}', { name: f.name, cost: yen(cost), desc: spec.desc }) };
  }
  if (tool === 'depot') {
    const r = t.addDepot(x, y);
    if (!r.depot) return fail(tr('車両基地を置けません: {reason}', { reason: tr(r.reason ?? '') }));
    const cost = r.depot.kind === 'road' ? PRICES.depotRoad : r.depot.kind === 'rail' ? PRICES.depotRail : PRICES.depotAir;
    if (!co.spend('build', cost)) {
      t.removeDepot(r.depot.id);
      return fail(tr('資金が足りません(車両基地 {cost})', { cost: yen(cost) }));
    }
    return { ok: true, id: r.depot.id, msg: tr('{name}を設置しました({cost})。タップして車両を購入できます', { name: r.depot.name, cost: yen(cost) }) };
  }
  if (tool === 'waypoint') {
    if (!co.afford(PRICES.waypoint)) return fail(tr('資金が足りません'));
    const w = t.addWaypoint(x, y);
    if (!w) return fail(tr('経由点は直線の線路(駅・他の経由点以外)にだけ置けます'));
    co.spend('build', PRICES.waypoint);
    return { ok: true, id: w.id, msg: tr('{name}を設置しました。路線作成中にクリックすると経路に追加できます', { name: w.name }) };
  }
  if (tool === 'signal') {
    const before = t.signalMask(map.idx(x, y));
    if (before === 0 && !co.afford(PRICES.signal)) return fail(tr('資金が足りません(信号 {PRICES})', { PRICES: yen(PRICES.signal) }));
    const mk = t.cycleSignal(x, y);
    if (mk === null) return fail(tr('信号は直線の線路(駅・橋以外)にだけ置けます'));
    if (before === 0) co.spend('build', PRICES.signal);
    const names = [tr('北向き'), tr('東向き'), tr('南向き'), tr('西向き'), tr('北東向き'), tr('南東向き'), tr('南西向き'), tr('北西向き')];
    return { ok: true, msg: mk === 0 ? tr('信号を撤去しました') : tr('信号: {d}の列車用(一方向)', { d: names.filter((_, d) => mk & (1 << d)).join(tr('・')) }) };
  }
  if (tool === 'airport') {
    const size = AIRPORT_SIZES.includes(cmd.air?.size as AirportSize) ? (cmd.air!.size as AirportSize) : 'S';
    const axis = cmd.air?.axis === 'y' ? 'y' : 'x';
    const design = Number.isInteger(cmd.air?.design) && cmd.air!.design! >= 0 && cmd.air!.design! < AIRPORT_DESIGNS ? cmd.air!.design! : 0;
    const price = AIRPORT_PRICES[size];
    if (!co.afford(price)) return fail(tr('資金が足りません(空港 {PRICES})', { PRICES: yen(price) }));
    const a = placeAirport(map, x, y, size, axis, design);
    if (!a) {
      const { w, h } = airportFootprint(size, axis, design);
      return fail(tr('空港を置けません({w}×{h}の平らな空き地が必要です)', { w, h }));
    }
    co.spend('build', price);
    const st = t.addStop(a.x, a.y, 'air');
    return { ok: true, id: st?.id, msg: tr('空港({size})を建設しました({PRICES})', { size: tr(AIRPORT_NAMES[size].ja), PRICES: yen(price) }) };
  }
  return fail(tr('不正な操作です'));
}
