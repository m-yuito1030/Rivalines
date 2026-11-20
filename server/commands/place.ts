import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { CommandContext } from './context';
import { fail } from './util';
import { blockingRight } from '../../src/shared/sim/economy/auctions';
import { placeAirport } from '../../src/shared/world/airports';
import { DESIGN_COUNT, FACILITY_SPECS, FACILITY_TYPES, SPRITE_TYPES, facilityCost, facilityDims, placeFacility, planFacility } from '../../src/shared/world/facilities';
import type { FacilitySize, FacilityType } from '../../src/shared/world/facilities';
import { PRICES, yen } from '../economyApi';

/** ensureStop */
export function ensureStop(cmd: Extract<Cmd, { t: 'ensureStop' }>, ctx: CommandContext): CmdResult {
  const { t, co, who } = ctx;
  {
    const ex = t.stopAtTile(cmd.x, cmd.y, cmd.kind);
    if (ex && !t.mayUse(ex, who)) return fail(`「${ex.name}」は他社の停留所です。持ち主の許可がないと使えません`);
  }
  if (t.stopAtTile(cmd.x, cmd.y, cmd.kind)) {
    const st = t.addStop(cmd.x, cmd.y, cmd.kind);
    return st ? { ok: true, id: st.id } : fail('停留所を置けません');
  }
  const cost = cmd.kind === 'rail' ? PRICES.stationBase + PRICES.stationTile : PRICES.stop;
  if (!co.afford(cost)) return fail(`資金が足りません(新しい停留所 ${yen(cost)})`);
  const st = t.addStop(cmd.x, cmd.y, cmd.kind);
  if (!st) return fail('ここには停留所を置けません');
  co.spend('build', cost);
  return { ok: true, id: st.id };
}

/** place */
export function place(cmd: Extract<Cmd, { t: 'place' }>, ctx: CommandContext): CmdResult {
  const { sim, map, t, co, who, facOcc, charge } = ctx;
  const { tool, x, y } = cmd;
  if (tool === 'stop') {
    const had = !!t.stopAtTile(x, y, 'road');
    if (!had && !co.afford(PRICES.stop)) return fail(`資金が足りません(バス停 ${yen(PRICES.stop)})`);
    const st = t.addStop(x, y, 'road');
    if (!st) return fail('ここにはバス停を置けません');
    if (!had) co.spend('build', PRICES.stop);
    return { ok: true, id: st.id };
  }
  if (tool === 'station') {
    const o = cmd.opts;
    if (!o) return fail('駅の設定がありません');
    const cost = PRICES.stationBase + PRICES.stationTile * o.len * o.tracks;
    if (!co.afford(cost)) return fail(`資金が足りません(駅 ${yen(cost)})`);
    const r = t.addStation(x, y, o);
    if (!r.stop) return fail(`駅を置けません: ${r.reason}`);
    co.spend('build', cost);
    return { ok: true, id: r.stop.id, msg: `${r.stop.name}を設置しました(${o.tracks}番線・ホーム長${o.len}・${yen(cost)})。両端の線路を自分でつなぎます` };
  }
  if ((FACILITY_TYPES as string[]).includes(tool)) {
    const type = tool as FacilityType;
    const spec = FACILITY_SPECS[type];
    const sprite = SPRITE_TYPES.includes(type);
    if (blockingRight(sim.auctions, map.towns, who, type, x, y)) return fail(`この街の${spec.name}の独占権は他社が持っています(別の街に建てるか、次の競りに参加してください)`);
    // 好きなデザイン・大きさを選べる(指定がなければ最大の大きさ・場所で決まるデザイン)
    const nDesign = DESIGN_COUNT[type] ?? 20;
    const size: FacilitySize = cmd.fac?.size ?? 'L';
    if (!['S', 'M', 'L'].includes(size)) return fail('大きさが正しくありません');
    if (cmd.fac && !(Number.isInteger(cmd.fac.design) && cmd.fac.design >= 0 && cmd.fac.design < nDesign)) return fail('デザインが正しくありません');
    const plan = planFacility(map, x, y, type, facOcc, sprite ? facilityDims(type, size) : undefined);
    if (!plan.ok) return fail(`${spec.name}を建てられません: ${plan.reason}`);
    const cost = sprite ? facilityCost(type, size) : spec.cost;
    const bad = charge(cost, 'build', spec.name);
    if (bad) return bad;
    const f = placeFacility(map, plan, type);
    f.playerId = who;
    if (sprite) {
      f.size = size;
      f.design = cmd.fac?.design ?? (plan.x0 * 31 + plan.y0 * 17 + f.id * 7) % nDesign;
    }
    return { ok: true, msg: `${f.name}を建設しました(${yen(cost)})。${spec.desc}` };
  }
  if (tool === 'depot') {
    const r = t.addDepot(x, y);
    if (!r.depot) return fail(`車両基地を置けません: ${r.reason}`);
    const cost = r.depot.kind === 'road' ? PRICES.depotRoad : r.depot.kind === 'rail' ? PRICES.depotRail : PRICES.depotAir;
    if (!co.spend('build', cost)) {
      t.removeDepot(r.depot.id);
      return fail(`資金が足りません(車両基地 ${yen(cost)})`);
    }
    return { ok: true, id: r.depot.id, msg: `${r.depot.name}を設置しました(${yen(cost)})。タップして車両を購入できます` };
  }
  if (tool === 'waypoint') {
    if (!co.afford(PRICES.waypoint)) return fail('資金が足りません');
    const w = t.addWaypoint(x, y);
    if (!w) return fail('経由点は直線の線路(駅・他の経由点以外)にだけ置けます');
    co.spend('build', PRICES.waypoint);
    return { ok: true, id: w.id, msg: `${w.name}を設置しました。路線作成中にクリックすると経路に追加できます` };
  }
  if (tool === 'signal') {
    const before = t.signalMask(map.idx(x, y));
    if (before === 0 && !co.afford(PRICES.signal)) return fail(`資金が足りません(信号 ${yen(PRICES.signal)})`);
    const mk = t.cycleSignal(x, y);
    if (mk === null) return fail('信号は直線の線路(駅・橋以外)にだけ置けます');
    if (before === 0) co.spend('build', PRICES.signal);
    const names = ['北向き', '東向き', '南向き', '西向き', '北東向き', '南東向き', '南西向き', '北西向き'];
    return { ok: true, msg: mk === 0 ? '信号を撤去しました' : `信号: ${names.filter((_, d) => mk & (1 << d)).join('・')}の列車用(一方向)` };
  }
  if (tool === 'airport') {
    if (!co.afford(PRICES.airport)) return fail(`資金が足りません(空港 ${yen(PRICES.airport)})`);
    const a = placeAirport(map, x, y);
    if (!a) return fail('空港を置けません(3×3の平らな空き地が必要です)');
    co.spend('build', PRICES.airport);
    const st = t.addStop(a.x, a.y, 'air');
    return { ok: true, id: st?.id, msg: `空港を建設しました(${yen(PRICES.airport)})` };
  }
  return fail('不正な操作です');
}
