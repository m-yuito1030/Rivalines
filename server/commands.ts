import type { Simulation } from '../src/sim/simulation';
import type { Cmd, CmdResult } from '../src/multi/protocol';
import { TX_METHODS } from '../src/multi/protocol';
import { DRAG_TOOLS, applyBuild } from '../src/world/buildApply';
import { disconnectRail, railLineTiles } from '../src/world/rails';
import { disconnect, removeBuilding } from '../src/world/roads';
import { removeSpansAround } from '../src/world/spans';
import { removeAirport } from '../src/world/airports';
import { TRAINING } from '../src/sim/economy';
import { PRICES, acquirePrice, assetValueFor, facilityValue, vehiclePrice, yen } from './economyApi';
import { FACILITY_SPECS, FACILITY_TYPES, type FacilityType, SPRITE_TYPES, DESIGN_COUNT, type FacilitySize, facilityCost, facilityDims, planFacility, placeFacility } from '../src/world/facilities';
import { placeAirport } from '../src/world/airports';
import { modelOf, clampCars } from '../src/data/models';
import { DAY_TICKS, RANKS } from '../src/sim/transit';
import { clampFareMul } from '../src/sim/fares';
import { DEV, devCost } from '../src/sim/development';
import { blockingRight } from '../src/sim/auctions';
const MINT = DAY_TICKS / 1440;
import { acquireRival, divestRival } from '../src/sim/rivals';
import { AD_TYPES, adAvailable, adCost } from '../src/sim/facilityVisitors';
import type { Route } from '../src/sim/transit';

const fail = (msg: string): CmdResult => ({ ok: false, msg });
const clampName = (n: unknown) => (typeof n === 'string' ? [...n.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 24).join('') : '');
/** 1ステップごとの上限(1人あたりの路線数。無料の複製・作成で世界を肥大化させない) */
const MAX_ROUTES_PER_PLAYER = 1000;

/** プレイヤーの操作を検証して実行する(サーバーだけが世界を書き換える) */
export function execute(sim: Simulation, who: number, cmd: Cmd): CmdResult {
  const map = sim.map;
  const t = sim.transit;
  const co = sim.playerCompany(who);
  // run() はすぐ実行されるので、run が使う const はその前に定義する(後ろに書くと初期化前アクセスのエラーになる)
  const facOcc = (i: number) => !!t.stopAtTile(i % map.size, Math.floor(i / map.size)) || !!t.depotAtTile(i % map.size, Math.floor(i / map.size));
  const charge = (cost: number, cat: string, what: string): CmdResult | null => (co.spend(cat, cost) ? null : fail(`資金が足りません(${what} ${yen(cost)} / 現金 ${yen(co.cash)})。経営画面(F)で融資を受けられます`));
  t.actor = who;
  try {
    const res = run();
    // 線路・道路・信号・駅が変わったら、ネットワークの世代を進める(経路は路線ごとに遅延して計算し直される)
    if (res.ok) {
      // 線路・道路・信号・駅が変わったら、変更した範囲を知らせる(その範囲に関わる経路が、次の出発時に探し直される)
      if (cmd.t === 'signalLine') t.touchNetwork(Math.min(cmd.a.x, cmd.b.x), Math.min(cmd.a.y, cmd.b.y), Math.max(cmd.a.x, cmd.b.x), Math.max(cmd.a.y, cmd.b.y));
      else if (cmd.t === 'place' && cmd.tool === 'signal') t.touchNetworkTiles([[cmd.x, cmd.y]]);
      else if (cmd.t === 'place' && ['station', 'airport', 'waypoint'].includes(cmd.tool)) t.touchNetwork(cmd.x - 12, cmd.y - 12, cmd.x + 12, cmd.y + 12);
    }
    return res;
  } finally {
    t.actor = 0;
  }

  function mine(r: Route | undefined): r is Route {
    return !!r && r.owner === who;
  }

  function run(): CmdResult {
    switch (cmd.t) {
      case 'build': {
        if (!DRAG_TOOLS.includes(cmd.tool)) return fail('不正な操作です');
        if (![cmd.a.x, cmd.a.y, cmd.b.x, cmd.b.y].every(Number.isInteger)) return fail('不正な操作です');
        if (Math.max(Math.abs(cmd.a.x - cmd.b.x), Math.abs(cmd.a.y - cmd.b.y)) > 512) return fail('一度に敷設できるのは512タイルまでです');
        const msgs: string[] = [];
        const changed: [number, number][] = [];
        applyBuild(map, cmd.tool, cmd.a, cmd.b, { afford: (c) => co.afford(c), pay: (c) => co.spend('build', c), msg: (m) => msgs.push(m), owner: who, touched: (x, y) => changed.push([x, y]) });
        t.touchNetworkTiles(changed); // 変更したタイルを通る経路は、次の出発/次のタイルで探し直される
        return { ok: true, msg: msgs.join(' ') || undefined };
      }
      case 'ensureStop': {
        { const ex = t.stopAtTile(cmd.x, cmd.y, cmd.kind); if (ex && !t.mayUse(ex, who)) return fail(`「${ex.name}」は他社の停留所です。持ち主の許可がないと使えません`); }
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
      case 'place': {
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
      case 'stopAllow': {
        const s = t.stops.get(cmd.stopId);
        if (!s || s.owner !== who) return fail('自社の停留所ではありません');
        if (!Number.isInteger(cmd.who) || cmd.who === who || !sim.players.has(cmd.who)) return fail('許可する会社が正しくありません');
        const set = new Set(s.allow ?? []);
        if (cmd.allow) set.add(cmd.who);
        else set.delete(cmd.who);
        s.allow = set.size ? [...set] : undefined;
        t.version++;
        return { ok: true, msg: cmd.allow ? `${s.name}を他社が使えるようにしました` : `${s.name}の使用許可を取り消しました` };
      }
      case 'companyAllow': {
        if (!Number.isInteger(cmd.who) || cmd.who === who || !sim.players.has(cmd.who)) return fail('許可する会社が正しくありません');
        const set = new Set(t.grants.get(who) ?? []);
        if (cmd.allow) set.add(cmd.who);
        else set.delete(cmd.who);
        if (set.size) t.grants.set(who, set);
        else t.grants.delete(who);
        t.version++;
        return { ok: true, msg: cmd.allow ? '自社の全停留所をその会社に開放しました' : 'その会社への全体の許可を取り消しました' };
      }
      case 'routeCreate': {
        if (!Array.isArray(cmd.stops) || cmd.stops.length > 200 || !cmd.stops.every((s) => Number.isInteger(s))) return fail('停留所の指定が正しくありません');
        if ([...t.routes.values()].filter((r) => r.owner === who).length >= MAX_ROUTES_PER_PLAYER) return fail(`路線は1社${MAX_ROUTES_PER_PLAYER}本までです`);
        if (new Set(cmd.stops).size < 2) return fail('路線には異なる停留所を2つ以上選んでください');
        const foreign = cmd.stops.map((id) => t.stops.get(id)).find((s) => s && !t.mayUse(s, who));
        if (foreign) return fail(`「${foreign.name}」は他社の停留所です。持ち主の許可がないと路線に使えません`);
        const r = t.addRoute(cmd.stops);
        return r ? { ok: true, id: r.id } : fail('路線を作れません(同じ種別の停留所を2つ以上選んでください)');
      }
      case 'tx': {
        if (!TX_METHODS.includes(cmd.m)) return fail('不正な操作です');
        const a = cmd.a;
        if (!Array.isArray(a) || a.length > 4) return fail('不正な操作です');
        // 添え字・IDは整数だけ(小数・NaN・文字列で順序や車両の番号がずれるのを防ぐ)
        if ((cmd.m === 'insertOrder' || cmd.m === 'removeOrder' || cmd.m === 'moveOrder') && !a.slice(0, cmd.m === 'insertOrder' ? 3 : 2).every(Number.isInteger)) return fail('不正な操作です');
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
          case 'removeRoute': t.removeRoute(a[0]); res = true; break;
          case 'moveOrder': res = t.moveOrder(a[0], a[1], a[2] as -1 | 1); break;
          case 'insertOrder': res = t.insertOrder(a[0], a[1], a[2]); break;
          case 'removeOrder': res = t.removeOrder(a[0], a[1]); break;
          case 'shareRoute': res = t.shareRoute(a[0]); break;
          case 'unshareRoute': t.unshareRoute(a[0]); res = true; break;
          case 'autoTimetable': res = t.autoTimetable(a[0], a[1]); if (res) t.syncOrders(a[0]); else return fail('時刻表を作れません(経路が見つからない区間があります)'); break;
          case 'removeVehicle': t.removeVehicle(a[0]); res = true; break;
          case 'splitTrain': res = t.splitTrain(a[0], a[1], sim.tick); if (!res) return fail('分割できません(後ろに線路が足りない/停車中でない)'); break;
          case 'departHeld': res = t.departHeld(a[0], sim.tick); if (!res) return fail('出発できません'); break;
          case 'coupleTrains': res = t.coupleTrains(a[0], a[1]); if (!res) return fail('連結できません(端がつながっていない/両数が多すぎる)'); break;
        }
        if (res && typeof res === 'object' && 'ok' in res && !(res as { ok: boolean }).ok) return fail((res as { reason?: string }).reason ?? '失敗しました');
        return { ok: true, id: res && typeof res === 'object' && 'id' in res ? (res as { id: number }).id : undefined };
      }
      case 'routeSet': {
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
      case 'orderSet': {
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
          o.cond = c && (c.kind === 'load' || c.kind === 'wait' || c.kind === 'tod') && (c.op === 'ge' || c.op === 'lt') ? { kind: c.kind, op: c.op, value: Number(c.value) || 0, to: Math.max(0, Math.min(r.orders.length - 1, Number(c.to) || 0)) } : undefined;
        }
        t.syncOrders(r.id);
        t.version++;
        return { ok: true };
      }
      case 'rename': {
        const name = clampName(cmd.name);
        if (!name) return fail('名前を入力してください');
        const e = cmd.kind === 'stop' ? t.stops.get(cmd.id) : t.depots.get(cmd.id);
        if (!e) return fail('見つかりません');
        if (e.owner && e.owner !== who) return fail('他社のものは名前を変えられません');
        e.name = name;
        t.version++;
        return { ok: true };
      }
      case 'buyVehicle': {
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
      case 'ad': {
        const f = map.facilities.find((x) => x.id === cmd.facilityId);
        if (!f || (f.owner ?? 'player') !== 'player' || f.playerId !== who) return fail('自社の施設ではありません');
        if (!(cmd.kind in AD_TYPES)) return fail('広告の種類が不正です');
        const why = adAvailable(f, sim.day);
        if (why) return fail(why);
        const cost = adCost(f, cmd.kind);
        if (!co.spend('ad', cost)) return fail(`資金が足りません(広告費 ${yen(cost)} / 現金 ${yen(co.cash)})`);
        f.ad = { kind: cmd.kind, from: sim.day };
        map.facilityVer++;
        const a = AD_TYPES[cmd.kind];
        return { ok: true, msg: `${FACILITY_SPECS[f.type].name}に${a.name}広告を出しました(${yen(cost)})。${a.days}日間、来場者が約${Math.round((a.mul - 1) * 100)}%増え、近くの他の施設は約${Math.round((1 - a.rival) * 100)}%減ります` };
      }
      case 'bulldoze': {
        const k = cmd.kinds;
        if (!k || ![cmd.a.x, cmd.a.y, cmd.b.x, cmd.b.y].every(Number.isInteger)) return fail('不正な操作です');
        const x0 = Math.max(0, Math.min(cmd.a.x, cmd.b.x));
        const x1 = Math.min(map.size - 1, Math.max(cmd.a.x, cmd.b.x));
        const y0 = Math.max(0, Math.min(cmd.a.y, cmd.b.y));
        const y1 = Math.min(map.size - 1, Math.max(cmd.a.y, cmd.b.y));
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 16384) return fail('範囲が広すぎます(128×128タイルまで)');
        const count = { road: 0, rail: 0, signal: 0, stop: 0, depot: 0, waypoint: 0, span: 0, building: 0, airport: 0 };
        const changed: [number, number][] = [];
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const i = map.idx(x, y);
            const own = map.infraOwner.get(i);
            const mineInfra = !own || own === who; // 他社の線路・道路は撤去できない
            let hit = false;
            if (k.span && mineInfra && map.span.get(i) && removeSpansAround(map, x, y)) (count.span++, (hit = true));
            if (k.road && mineInfra && map.road.get(i)) {
              for (let d = 0; d < 4; d++) disconnect(map, x, y, d);
              count.road++;
              hit = true;
            }
            if (k.rail && mineInfra && map.rail.get(i)) {
              for (let d = 0; d < 8; d++) disconnectRail(map, x, y, d);
              count.rail++;
              hit = true;
            }
            if (k.signal && mineInfra && t.signals.has(i)) (t.signals.delete(i), t.version++, count.signal++, (hit = true));
            if (k.stop) {
              for (const kind of ['road', 'rail', 'air'] as const) {
                const s = t.stopAtTile(x, y, kind);
                if (s && !s.waypoint && (!s.owner || s.owner === who)) (t.removeStop(s.id), count.stop++, (hit = true));
              }
            }
            if (k.waypoint) {
              const w = t.stopAtTile(x, y, 'rail');
              if (w?.waypoint && (!w.owner || w.owner === who)) (t.removeStop(w.id), count.waypoint++, (hit = true));
            }
            if (k.depot) {
              const d = t.depotAtTile(x, y);
              if (d && (!d.owner || d.owner === who)) (t.removeDepot(d.id), count.depot++, (hit = true));
            }
            if (k.building && map.building.get(i) && removeBuilding(map, x, y)) (count.building++, (hit = true));
            if (k.airport && map.air.get(i)) (removeAirport(map, x, y), count.airport++, (hit = true));
            if (hit) {
              changed.push([x, y]);
              if (!map.road.get(i) && !map.rail.get(i) && !map.span.get(i)) map.infraOwner.set(i, 0);
              map.touch(x, y);
            }
          }
        }
        t.touchNetworkTiles(changed);
        const names: [keyof typeof count, string][] = [['road', '道路'], ['rail', '線路'], ['signal', '信号'], ['stop', '停留所・駅'], ['depot', '基地'], ['waypoint', '経由点'], ['span', '橋・トンネル'], ['building', '建物'], ['airport', '空港']];
        const parts = names.filter(([key]) => count[key] > 0).map(([key, label]) => `${label}${count[key]}`);
        return { ok: true, msg: parts.length ? `撤去しました: ${parts.join('・')}` : '選んだ種類の要素はありませんでした' };
      }
      case 'signalLine': {
        if (![cmd.a.x, cmd.a.y, cmd.b.x, cmd.b.y].every(Number.isInteger) || Math.max(Math.abs(cmd.a.x - cmd.b.x), Math.abs(cmd.a.y - cmd.b.y)) > 400) return fail('範囲が不正です(400タイルまで)');
        const step = Math.max(1, Math.min(20, Math.round(Number(cmd.interval) || 3)));
        const tiles = railLineTiles(cmd.a.x, cmd.a.y, cmd.b.x, cmd.b.y);
        let placed = 0;
        let cost = 0;
        for (let i = 0; i < tiles.length - 1 && placed < 200; i += step) {
          const tl = tiles[i];
          const idx = map.idx(tl.x, tl.y);
          const had = t.signalMask(idx);
          if (had === 1 << tl.d) continue;
          if (!co.afford(PRICES.signal)) {
            return { ok: true, msg: `資金が足りません。${placed}か所に信号を置きました(${yen(cost)})` };
          }
          if (t.setSignal(tl.x, tl.y, 1 << tl.d)) {
            if (!had) {
              co.spend('build', PRICES.signal);
              cost += PRICES.signal;
            }
            placed++;
          }
        }
        return placed ? { ok: true, msg: `信号を${placed}か所に置きました(${yen(cost)})` } : fail('信号を置ける直線の線路がありません(駅・分岐・橋の上には置けません)');
      }
      case 'routeReplace': {
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
        return changed ? { ok: true, msg: `${changed}両を「${m.name}」に置き換えました(差額 ${yen(paid)}。旧車両は評価額の50%で下取り)` } : fail('置き換える車両がありません(すでに同じ車種、または両数が合いません)');
      }
      case 'vehPlan': {
        const plan = t.planAhead(Number(cmd.id), 3);
        return plan ? { ok: true, data: plan } : fail('車両が見つかりません');
      }
      case 'vehOffset': {
        const v = t.vehicles.find((x) => x.id === cmd.id);
        if (!v || !mine(t.routes.get(v.routeId))) return fail('自社の車両ではありません');
        const P = t.routes.get(v.routeId)!.period;
        v.offset = Math.round(((((cmd.offset % P) + P) % P) / MINT)) * MINT;
        t.version++;
        return { ok: true };
      }
      case 'routeClone': {
        const src = t.routes.get(cmd.routeId);
        if (!mine(src)) return fail('自社の路線ではありません');
        if (t.routes.size > 100000) return fail('路線が多すぎます');
        const copy = t.cloneRoute(src.id, !!cmd.reverse, Math.round(Number(cmd.shiftMin) || 0) * MINT);
        return copy ? { ok: true, id: copy.id, msg: `「${copy.name}」を作りました。車両は基地から購入してください` } : fail('複製できません');
      }
      case 'routeRank': {
        const src = t.routes.get(cmd.routeId);
        if (!mine(src)) return fail('自社の路線ではありません');
        const rank = Math.round(Number(cmd.rank));
        if (!(rank >= 0 && rank < RANKS.length)) return fail('種別が不正です');
        let target: Route | null = src;
        if (cmd.copy) {
          target = t.cloneRoute(src.id, false, Math.round(Number(cmd.shiftMin ?? 5)) * MINT);
          if (!target) return fail('複製できません');
          target.name = `${src.name.replace(/\((複製|\+\d+分)\)$/, '')}(${RANKS[rank].name})`;
        }
        if (!t.applyRank(target.id, rank)) return fail('種別を設定できません');
        return { ok: true, id: target.id, msg: `${RANKS[rank].name}にしました(停車駅 ${target.orders.filter((o) => !o.pass && !t.stops.get(o.stopId)?.waypoint).length}/${target.orders.length})。通過駅は各駅の「通過」で変えられます` };
      }
      case 'orderShift': {
        const r = t.routes.get(cmd.routeId);
        if (!mine(r)) return fail('自社の路線ではありません');
        const delta = Math.round(Number(cmd.delta) || 0);
        for (let i = Math.max(0, cmd.from); i < r.orders.length; i++) {
          const o = r.orders[i];
          if (o.kind === 'timed') o.departTod = (((o.departTod + delta) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
        }
        t.syncOrders(r.id);
        t.version++;
        return { ok: true };
      }
      case 'routeBulk': {
        // 運行本数の一括設定: 時刻表がなければ作り、間隔に合う本数の編成を等間隔のずれで走らせる(足りなければ買い足す)
        const r = t.routes.get(cmd.routeId);
        if (!mine(r)) return fail('自社の路線ではありません');
        const interval = Math.round(Number(cmd.intervalMin));
        if (!(interval >= 1)) return fail('間隔(分)を指定してください');
        if (!r.orders.some((o) => o.kind === 'timed') && !t.autoTimetable(r.id, (Math.round(Number(cmd.firstMin) || 0) % 1440) * MINT)) return fail('時刻表を作れません(経路が見つからない区間があります)');
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
        return { ok: true, msg: `${vs.length}本で運行(${Math.round(P / Math.min(n, Math.max(1, vs.length)) / MINT)}分間隔)${bought ? `、${bought}本を購入` : ''}${lack ? `。${lack}のため ${n} 本には届きませんでした` : ''}` };
      }
      case 'bid': {
        const lot = sim.auctions.lots.find((l) => l.id === Number(cmd.lotId));
        if (!lot) return fail('競りが見つかりません');
        const amount = Math.floor(Number(cmd.amount));
        if (!co.afford(amount)) return fail(`資金が足りません(入札額 ${yen(amount)} / 現金 ${yen(co.cash)})`);
        const err = sim.auctions.bid(who, lot.id, amount);
        return err ? fail(err) : { ok: true, msg: `${yen(amount)}で入札しました(締め切りまで あと${lot.left}日。落札すると、その時点で支払います)` };
      }
      case 'pact': {
        const pa = sim.pacts;
        if (cmd.op === 'propose') {
          const to = Number(cmd.to);
          if (!sim.players.has(to)) return fail('相手が見つかりません');
          const err = pa.propose(who, to, Number(cmd.discount));
          return err ? fail(err) : { ok: true, msg: '提携を申し込みました。相手の承諾を待ちます' };
        }
        const id = Number(cmd.id);
        if (cmd.op === 'accept' || cmd.op === 'reject') {
          const err = pa.respond(who, id, cmd.op === 'accept');
          return err ? fail(err) : { ok: true, msg: cmd.op === 'accept' ? '提携しました。互いの通行料が割り引かれます' : '申し込みを断りました' };
        }
        if (cmd.op === 'cancel') {
          const err = pa.cancel(who, id);
          return err ? fail(err) : { ok: true, msg: '提携を解消(または取り下げ)しました' };
        }
        return fail('不正な操作です');
      }
      case 'develop': {
        const s = t.stops.get(cmd.stopId);
        if (!s || s.waypoint) return fail('停留所が見つかりません');
        if (s.owner !== who) return fail('自社の停留所だけ開発できます');
        const lv = s.dev ?? 0;
        if (lv >= DEV.max) return fail('最高の開発度です');
        const cost = devCost(lv);
        const bad = charge(cost, 'build', '沿線開発');
        if (bad) return bad;
        s.dev = lv + 1;
        t.version++;
        return { ok: true, msg: `${s.name}の周りを開発しました(開発度${s.dev}・${yen(cost)})。乗客が増え、不動産収入が毎日入ります` };
      }
      case 'gift': {
        // 資金支援: 他の会社へ送金する(自社の現金の範囲で)
        const amount = Math.floor(Number(cmd.amount));
        if (!(amount >= 10_000)) return fail('1万円以上を指定してください');
        if (cmd.to === who || !sim.players.has(cmd.to)) return fail('送り先が見つかりません');
        if (!co.spend('gift-out', amount)) return fail(`資金が足りません(現金 ${yen(co.cash)})`);
        sim.playerCompany(cmd.to).earn('gift-in', amount);
        return { ok: true, msg: `${yen(amount)}を送金しました` };
      }
      case 'fin': {
        const amount = Number(cmd.amount ?? 0);
        const assets = assetValueFor(sim, who);
        if (cmd.op === 'payout') {
          if (![0, 0.2, 0.4].includes(amount)) return fail('不正な値です');
          co.payout = amount;
          return { ok: true, msg: co.payout > 0 ? `配当性向を ${Math.round(co.payout * 100)}% にしました` : '配当をしないことにしました' };
        }
        if (cmd.op === 'train') {
          const err = co.startTraining();
          return err ? fail(err) : { ok: true, msg: `従業員の研修を始めました(${TRAINING.days}日後にレベル${co.trainingPending!.to}になります)` };
        }
        if (cmd.op === 'borrow') {
          const err = co.borrow(amount, co.credit, assets);
          return err ? fail(err) : { ok: true, msg: `${yen(amount)}を借り入れました` };
        }
        if (cmd.op === 'repay') {
          const paid = co.repay(amount === 0 ? Infinity : amount);
          return paid > 0 ? { ok: true, msg: `${yen(paid)}を返済しました` } : fail('返済できません(現金不足または借入なし)');
        }
        if (cmd.op === 'rival-buy' || cmd.op === 'rival-sell') {
          const r = sim.rivals.find((x) => x.id === cmd.id);
          if (!r) return fail('見つかりません');
          if (cmd.op === 'rival-buy') {
            const err = acquireRival(co, r, map, who);
            return err ? fail(err) : { ok: true, msg: `${r.name}を買収しました(${yen(acquirePrice(r))})` };
          }
          const get = divestRival(co, r, who);
          return get > 0 ? { ok: true, msg: `${r.name}を手放しました(${yen(get)})` } : fail('傘下の会社ではありません');
        }
        if (cmd.op === 'acquire' || cmd.op === 'sell') {
          const f = map.facilities.find((x) => x.id === cmd.id);
          if (!f) return fail('見つかりません');
          const v = facilityValue(f);
          if (cmd.op === 'acquire') {
            if ((f.owner ?? 'player') === 'player' || f.owner === 'public') return fail('買収できません');
            if (!co.spend('acquire', v)) return fail(`資金が足りません(買収額 ${yen(v)})`);
            f.owner = 'player';
            f.playerId = who;
            map.facilityVer++;
            return { ok: true, msg: `${f.name}を ${yen(v)} で買収しました` };
          }
          if (f.playerId !== who) return fail('自社の施設ではありません');
          const get = Math.round(v * 0.6);
          co.earn('sale', get);
          f.owner = 'city';
          f.playerId = undefined;
          map.facilityVer++;
          return { ok: true, msg: `${f.name}を ${yen(get)} で売却しました` };
        }
        return fail('不正な操作です');
      }
      default:
        return fail('不正な操作です');
    }
  }
}
