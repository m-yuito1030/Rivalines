import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { CommandContext } from './context';
import { fail } from './util';
import { removeAirport } from '../../src/shared/world/airports';
import { DRAG_TOOLS, applyBuild } from '../../src/shared/world/buildApply';
import { disconnectRail, railLineTiles } from '../../src/shared/world/rails';
import { disconnect, removeBuilding } from '../../src/shared/world/roads';
import { removeSpansAround } from '../../src/shared/world/spans';
import { PRICES, yen } from '../economyApi';

/** build */
export function build(cmd: Extract<Cmd, { t: 'build' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { map, t, co, who } = ctx;
  if (!DRAG_TOOLS.includes(cmd.tool)) return fail(tr('不正な操作です'));
  if (![cmd.a.x, cmd.a.y, cmd.b.x, cmd.b.y].every(Number.isInteger)) return fail(tr('不正な操作です'));
  if (Math.max(Math.abs(cmd.a.x - cmd.b.x), Math.abs(cmd.a.y - cmd.b.y)) > 512) return fail(tr('一度に敷設できるのは512タイルまでです'));
  const msgs: string[] = [];
  const changed: [number, number][] = [];
  applyBuild(map, cmd.tool, cmd.a, cmd.b, {
    afford: (c) => co.afford(c),
    pay: (c) => co.spend('build', c),
    msg: (m) => msgs.push(m),
    owner: who,
    touched: (x, y) => changed.push([x, y]),
  });
  t.touchNetworkTiles(changed); // 変更したタイルを通る経路は、次の出発/次のタイルで探し直される
  return { ok: true, msg: msgs.join(' ') || undefined };
}

/** bulldoze */
export function bulldoze(cmd: Extract<Cmd, { t: 'bulldoze' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { map, t, who } = ctx;
  const k = cmd.kinds;
  if (!k || ![cmd.a.x, cmd.a.y, cmd.b.x, cmd.b.y].every(Number.isInteger)) return fail(tr('不正な操作です'));
  const x0 = Math.max(0, Math.min(cmd.a.x, cmd.b.x));
  const x1 = Math.min(map.size - 1, Math.max(cmd.a.x, cmd.b.x));
  const y0 = Math.max(0, Math.min(cmd.a.y, cmd.b.y));
  const y1 = Math.min(map.size - 1, Math.max(cmd.a.y, cmd.b.y));
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 16384) return fail(tr('範囲が広すぎます(128×128タイルまで)'));
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
  const names: [keyof typeof count, string][] = [
    ['road', tr('道路')],
    ['rail', tr('線路')],
    ['signal', tr('信号')],
    ['stop', tr('停留所・駅')],
    ['depot', tr('基地')],
    ['waypoint', tr('経由点')],
    ['span', tr('橋・トンネル')],
    ['building', tr('建物')],
    ['airport', tr('空港')],
  ];
  const parts = names.filter(([key]) => count[key] > 0).map(([key, label]) => `${label}${count[key]}`);
  return { ok: true, msg: parts.length ? tr('撤去しました: {parts}', { parts: parts.join(tr('・')) }) : tr('選んだ種類の要素はありませんでした') };
}

/** signalLine */
export function signalLine(cmd: Extract<Cmd, { t: 'signalLine' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { map, t, co } = ctx;
  if (![cmd.a.x, cmd.a.y, cmd.b.x, cmd.b.y].every(Number.isInteger) || Math.max(Math.abs(cmd.a.x - cmd.b.x), Math.abs(cmd.a.y - cmd.b.y)) > 400)
    return fail(tr('範囲が不正です(400タイルまで)'));
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
      return { ok: true, msg: tr('資金が足りません。{placed}か所に信号を置きました({cost})', { placed, cost: yen(cost) }) };
    }
    if (t.setSignal(tl.x, tl.y, 1 << tl.d)) {
      if (!had) {
        co.spend('build', PRICES.signal);
        cost += PRICES.signal;
      }
      placed++;
    }
  }
  return placed
    ? { ok: true, msg: tr('信号を{placed}か所に置きました({cost})', { placed, cost: yen(cost) }) }
    : fail(tr('信号を置ける直線の線路がありません(駅・分岐・橋の上には置けません)'));
}
