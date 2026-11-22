import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { CommandContext } from './context';
import { MAX_ORDERS_PER_ROUTE, MAX_ROUTES_PER_PLAYER, MINT, clampName, fail } from './util';
import { clampCars, modelOf } from '../../src/shared/data/models';
import { TX_METHODS } from '../../src/shared/protocol';
import { clampFareMul } from '../../src/shared/sim/network/fares';
import { DAY_TICKS, RANKS } from '../../src/shared/sim/network/transit';
import type { Route } from '../../src/shared/sim/network/transit';
import { vehiclePrice, yen } from '../economyApi';

/** 自社の路線が上限に達していれば、失敗の結果(路線を増やす操作の前に確かめる) */
function routeLimit(ctx: CommandContext): CmdResult | null {
  let n = 0;
  for (const r of ctx.t.routes.values()) if (r.owner === ctx.who) n++;
  return n >= MAX_ROUTES_PER_PLAYER ? fail(`路線は1社${MAX_ROUTES_PER_PLAYER}本までです`) : null;
}

/** routeCreate */
export function routeCreate(cmd: Extract<Cmd, { t: 'routeCreate' }>, ctx: CommandContext): CmdResult {
  const { t, who } = ctx;
  if (!Array.isArray(cmd.stops) || cmd.stops.length > 200 || !cmd.stops.every((s) => Number.isInteger(s))) return fail('停留所の指定が正しくありません');
  const full = routeLimit(ctx);
  if (full) return full;
  if (new Set(cmd.stops).size < 2) return fail('路線には異なる停留所を2つ以上選んでください');
  const foreign = cmd.stops.map((id) => t.stops.get(id)).find((s) => s && !t.mayUse(s, who));
  if (foreign) return fail(`「${foreign.name}」は他社の停留所です。持ち主の許可がないと路線に使えません`);
  const r = t.addRoute(cmd.stops);
  return r ? { ok: true, id: r.id } : fail('路線を作れません(同じ種別の停留所を2つ以上選んでください)');
}

/** tx の引数の型: id=整数のID・添え字 / dir=+1か-1 / num=有限の数 */
const TX_ARGS: Record<(typeof TX_METHODS)[number], ('id' | 'dir' | 'num')[]> = {
  removeRoute: ['id'],
  shareRoute: ['id'],
  unshareRoute: ['id'],
  removeDepot: ['id'],
  removeVehicle: ['id'],
  departHeld: ['id'],
  moveOrder: ['id', 'id', 'dir'],
  insertOrder: ['id', 'id', 'id'],
  removeOrder: ['id', 'id'],
  autoTimetable: ['id', 'num'],
  splitTrain: ['id', 'id'],
  coupleTrains: ['id', 'id'],
};
/** tx の引数 a が、メソッド m の決まった形(個数・整数・方向・有限の数)か */
export function validTxArgs(m: string, a: unknown): boolean {
  const spec = (TX_ARGS as Record<string, ('id' | 'dir' | 'num')[] | undefined>)[m];
  if (!spec || !Array.isArray(a) || a.length !== spec.length) return false;
  return spec.every((kind, i) => (kind === 'id' ? Number.isSafeInteger(a[i]) : kind === 'dir' ? a[i] === 1 || a[i] === -1 : typeof a[i] === 'number' && Number.isFinite(a[i])));
}

/** tx */
export function tx(cmd: Extract<Cmd, { t: 'tx' }>, ctx: CommandContext): CmdResult {
  const { sim, t, who, mine } = ctx;
  if (!TX_METHODS.includes(cmd.m)) return fail('不正な操作です');
  const a = cmd.a;
  // 引数は、個数・型・範囲をメソッドごとに厳密に確かめる(小数・NaN・文字列・余分な引数で、順序や車両の番号が壊れるのを防ぐ)
  if (!validTxArgs(cmd.m, a)) return fail('不正な操作です');
  const vehOwner = (vid: number) => t.routes.get(t.vehicles.find((v) => v.id === vid)?.routeId ?? -1)?.owner;
  switch (cmd.m) {
    case 'removeDepot': {
      const d = t.depots.get(a[0]);
      if (!d || d.owner !== who) return fail('自社の基地ではありません');
      t.removeDepot(a[0]);
      return { ok: true };
    }
    case 'removeVehicle':
    case 'splitTrain':
    case 'departHeld':
      if (vehOwner(a[0]) !== who) return fail('自社の車両ではありません');
      break;
    case 'coupleTrains':
      if (vehOwner(a[0]) !== who || vehOwner(a[1]) !== who) return fail('自社の車両ではありません');
      break;
    default:
      if (!mine(t.routes.get(a[0]))) return fail('自社の路線ではありません');
  }
  let res: unknown;
  switch (cmd.m) {
    case 'removeRoute':
      t.removeRoute(a[0]);
      res = true;
      break;
    case 'moveOrder':
      res = t.moveOrder(a[0], a[1], a[2] as -1 | 1);
      break;
    case 'insertOrder':
      if ((t.routes.get(a[0])?.orders.length ?? 0) >= MAX_ORDERS_PER_ROUTE) return fail(`1つの路線のオーダーは${MAX_ORDERS_PER_ROUTE}個までです`);
      res = t.insertOrder(a[0], a[1], a[2]);
      break;
    case 'removeOrder':
      res = t.removeOrder(a[0], a[1]);
      break;
    case 'shareRoute': {
      const full = routeLimit(ctx);
      if (full) return full;
      res = t.shareRoute(a[0]);
      break;
    }
    case 'unshareRoute':
      t.unshareRoute(a[0]);
      res = true;
      break;
    case 'autoTimetable':
      res = t.autoTimetable(a[0], a[1]);
      if (res) t.syncOrders(a[0]);
      else return fail('時刻表を作れません(経路が見つからない区間があります)');
      break;
    case 'removeVehicle':
      t.removeVehicle(a[0]);
      res = true;
      break;
    case 'splitTrain':
      res = t.splitTrain(a[0], a[1], sim.tick);
      if (!res) return fail('分割できません(後ろに線路が足りない/停車中でない)');
      break;
    case 'departHeld':
      res = t.departHeld(a[0], sim.tick);
      if (!res) return fail('出発できません');
      break;
    case 'coupleTrains':
      res = t.coupleTrains(a[0], a[1]);
      if (!res) return fail('連結できません(端がつながっていない/両数が多すぎる)');
      break;
  }
  if (res && typeof res === 'object' && 'ok' in res && !(res as { ok: boolean }).ok) return fail((res as { reason?: string }).reason ?? '失敗しました');
  return { ok: true, id: res && typeof res === 'object' && 'id' in res ? (res as { id: number }).id : undefined };
}

/** routeSet */
export function routeSet(cmd: Extract<Cmd, { t: 'routeSet' }>, ctx: CommandContext): CmdResult {
  const { t, mine } = ctx;
  const r = t.routes.get(cmd.routeId);
  if (!mine(r)) return fail('自社の路線ではありません');
  const p = cmd.patch;
  if (p.name !== undefined) r.name = clampName(p.name) || r.name;
  if (p.modelId !== undefined) {
    const m = modelOf(p.modelId);
    if (m.mode !== r.mode) return fail('種別が違います');
    r.modelId = m.id;
    r.cars = m.defaultCars;
  }
  if (p.cars !== undefined) r.cars = clampCars(modelOf(r.modelId), Number(p.cars));
  if (p.fareMul !== undefined && !Number.isFinite(Number(p.fareMul))) return fail('運賃の倍率が不正です');
  if (p.fareMul !== undefined) r.fareMul = clampFareMul(p.fareMul) === 1 ? undefined : clampFareMul(p.fareMul);
  if (p.period !== undefined && Number(p.period) > 0) {
    // 運行の周期は 15分〜7日(tick)の範囲だけ。極端な値でダイヤが壊れないように
    r.period = Math.max(DAY_TICKS / 96, Math.min(DAY_TICKS * 7, Number(p.period)));
    t.syncOrders(r.id);
  }
  t.version++;
  return { ok: true };
}

/** orderSet */
export function orderSet(cmd: Extract<Cmd, { t: 'orderSet' }>, ctx: CommandContext): CmdResult {
  const { t, mine } = ctx;
  const r = t.routes.get(cmd.routeId);
  if (!mine(r)) return fail('自社の路線ではありません');
  const o = Number.isInteger(cmd.index) ? r.orders[cmd.index] : undefined;
  if (!o) return fail('オーダーがありません');
  const p = cmd.patch;
  if (p.kind === 'dwell' || p.kind === 'full' || p.kind === 'timed') o.kind = p.kind;
  if (typeof p.pass === 'boolean') {
    const stopsHere = r.orders.filter((x, i) => i !== cmd.index && !x.pass && !t.stops.get(x.stopId)?.waypoint).length;
    if (p.pass && (t.stops.get(o.stopId)?.waypoint || stopsHere < 2)) return fail('停車する駅が2つ未満になるため通過にできません');
    o.pass = p.pass ? true : undefined;
    r.legMeasured = undefined;
  }
  if (typeof p.dwell === 'number') o.dwell = Math.max(10, Math.min(6000, p.dwell));
  if (typeof p.maxWait === 'number') o.maxWait = Math.max(10, Math.min(36000, p.maxWait));
  if (typeof p.departTod === 'number' && Number.isFinite(p.departTod)) o.departTod = Math.max(0, Math.min(DAY_TICKS - 1, p.departTod));
  if ('cond' in p) {
    const c = p.cond as { kind?: string; op?: string; value?: number; to?: number } | null;
    o.cond =
      c && (c.kind === 'load' || c.kind === 'wait' || c.kind === 'tod') && (c.op === 'ge' || c.op === 'lt')
        ? { kind: c.kind, op: c.op, value: Number(c.value) || 0, to: Math.max(0, Math.min(r.orders.length - 1, Number(c.to) || 0)) }
        : undefined;
  }
  t.syncOrders(r.id);
  t.version++;
  return { ok: true };
}

/** routeClone */
export function routeClone(cmd: Extract<Cmd, { t: 'routeClone' }>, ctx: CommandContext): CmdResult {
  const { t, mine } = ctx;
  const src = t.routes.get(cmd.routeId);
  if (!mine(src)) return fail('自社の路線ではありません');
  const full = routeLimit(ctx);
  if (full) return full;
  const copy = t.cloneRoute(src.id, !!cmd.reverse, Math.round(Number(cmd.shiftMin) || 0) * MINT);
  return copy ? { ok: true, id: copy.id, msg: `「${copy.name}」を作りました。車両は基地から購入してください` } : fail('複製できません');
}

/** routeRank */
export function routeRank(cmd: Extract<Cmd, { t: 'routeRank' }>, ctx: CommandContext): CmdResult {
  const { t, mine } = ctx;
  const src = t.routes.get(cmd.routeId);
  if (!mine(src)) return fail('自社の路線ではありません');
  const rank = Math.round(Number(cmd.rank));
  if (!(rank >= 0 && rank < RANKS.length)) return fail('種別が不正です');
  let target: Route | null = src;
  if (cmd.copy) {
    const full = routeLimit(ctx);
    if (full) return full;
    target = t.cloneRoute(src.id, false, Math.round(Number(cmd.shiftMin ?? 5)) * MINT);
    if (!target) return fail('複製できません');
    target.name = `${src.name.replace(/\((複製|\+\d+分)\)$/, '')}(${RANKS[rank].name})`;
  }
  if (!t.applyRank(target.id, rank)) return fail('種別を設定できません');
  return {
    ok: true,
    id: target.id,
    msg: `${RANKS[rank].name}にしました(停車駅 ${target.orders.filter((o) => !o.pass && !t.stops.get(o.stopId)?.waypoint).length}/${target.orders.length})。通過駅は各駅の「通過」で変えられます`,
  };
}

/** orderShift */
export function orderShift(cmd: Extract<Cmd, { t: 'orderShift' }>, ctx: CommandContext): CmdResult {
  const { t, mine } = ctx;
  const r = t.routes.get(cmd.routeId);
  if (!mine(r)) return fail('自社の路線ではありません');
  if (!Number.isSafeInteger(cmd.from)) return fail('不正な操作です');
  const delta = Math.round(Number(cmd.delta) || 0);
  for (let i = Math.max(0, cmd.from); i < r.orders.length; i++) {
    const o = r.orders[i];
    if (o.kind === 'timed') o.departTod = (((o.departTod + delta) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  }
  t.syncOrders(r.id);
  t.version++;
  return { ok: true };
}

/** routeBulk */
export function routeBulk(cmd: Extract<Cmd, { t: 'routeBulk' }>, ctx: CommandContext): CmdResult {
  const { sim, t, co, who, mine } = ctx;
  // 運行本数の一括設定: 時刻表がなければ作り、間隔に合う本数の編成を等間隔のずれで走らせる(足りなければ買い足す)
  const r = t.routes.get(cmd.routeId);
  if (!mine(r)) return fail('自社の路線ではありません');
  const interval = Math.round(Number(cmd.intervalMin));
  if (!(interval >= 1)) return fail('間隔(分)を指定してください');
  if (!r.orders.some((o) => o.kind === 'timed') && !t.autoTimetable(r.id, (Math.round(Number(cmd.firstMin) || 0) % 1440) * MINT))
    return fail('時刻表を作れません(経路が見つからない区間があります)');
  const P = r.period;
  const n = Math.max(1, Math.min(24, Math.round(P / (interval * MINT))));
  const mine_ = t.vehicles.filter((v) => v.routeId === r.id);
  const depot = t.nearestDepot(r.id);
  let bought = 0;
  let lack = '';
  for (let k = mine_.length; k < n; k++) {
    const m = modelOf(r.modelId);
    const cars = m.mode === 'rail' ? clampCars(m, r.cars ?? m.defaultCars) : 1;
    const price = vehiclePrice(m, cars);
    if (!depot || (depot.owner && depot.owner !== who)) {
      lack = '車両基地がありません';
      break;
    }
    if (!co.afford(price)) {
      lack = '資金が足りません';
      break;
    }
    const res = t.buyVehicle(depot.id, r.id, m.id, cars, sim.tick);
    if (!res.vehicle) {
      lack = res.reason ?? '購入できません';
      break;
    }
    co.spend('vehicle', price);
    bought++;
  }
  const vs = t.vehicles.filter((v) => v.routeId === r.id);
  vs.forEach((v, i) => (v.offset = Math.round(((i % n) * (P / n)) / MINT) * MINT));
  t.version++;
  return {
    ok: true,
    msg: `${vs.length}本で運行(${Math.round(P / Math.min(n, Math.max(1, vs.length)) / MINT)}分間隔)${bought ? `、${bought}本を購入` : ''}${lack ? `。${lack}のため ${n} 本には届きませんでした` : ''}`,
  };
}

/** routeReplace */
export function routeReplace(cmd: Extract<Cmd, { t: 'routeReplace' }>, ctx: CommandContext): CmdResult {
  const { t, co, mine } = ctx;
  const r = t.routes.get(cmd.routeId);
  if (!mine(r)) return fail('自社の路線ではありません');
  const m = modelOf(r.modelId);
  let changed = 0;
  let paid = 0;
  for (const v of t.vehicles.filter((x) => x.routeId === r.id)) {
    if (v.modelId === m.id) continue;
    const oldM = modelOf(v.modelId);
    if (oldM.mode !== m.mode) continue;
    const cars = m.mode === 'rail' ? clampCars(m, v.cars) : 1;
    if (m.mode === 'rail' && cars !== v.cars) continue; // 両数が変わる車種へは置き換えない(編成の長さが変わるため)
    const net_ = vehiclePrice(m, cars) - vehiclePrice(oldM, v.cars) * 0.5;
    if (net_ > 0 && !co.afford(net_)) return { ok: changed > 0, msg: `資金が足りません。${changed}両を置き換えました(${yen(paid)})` };
    if (net_ > 0) co.spend('vehicle', net_);
    else co.earn('sale', -net_);
    paid += net_;
    v.modelId = m.id;
    v.cap = m.cap * cars;
    v.speed = m.speed;
    v.load = Math.min(v.load, v.cap);
    changed++;
  }
  t.version++;
  return changed
    ? { ok: true, msg: `${changed}両を「${m.name}」に置き換えました(差額 ${yen(paid)}。旧車両は評価額の50%で下取り)` }
    : fail('置き換える車両がありません(すでに同じ車種、または両数が合いません)');
}
