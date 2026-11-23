import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { CommandContext } from './context';
import { fail } from './util';
import { DEV, devCost } from '../../src/shared/sim/economy/development';
import { GRADE_MAX, freshness, gradeOf, renovateCost, repOf, upgradeCost } from '../../src/shared/world/facilityQuality';
import { DESIGN_COUNT, facilityBuildCost, redesignCost, redesignRule } from '../../src/shared/world/facilities';
import { PRICE_LEVELS } from '../../src/shared/sim/facility/pricing';
import { AD_TYPES, VISITOR_TYPES, adAvailable, adCost } from '../../src/shared/sim/facility/facilityVisitors';
import { FACILITY_SPECS } from '../../src/shared/world/facilities';
import { yen } from '../economyApi';

/** ad */
export function ad(cmd: Extract<Cmd, { t: 'ad' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { sim, map, co, who } = ctx;
  const f = map.facilities.find((x) => x.id === cmd.facilityId);
  if (!f || (f.owner ?? 'player') !== 'player' || f.playerId !== who) return fail(tr('自社の施設ではありません'));
  if (!(cmd.kind in AD_TYPES)) return fail(tr('広告の種類が不正です'));
  const why = adAvailable(f, sim.day);
  if (why) return fail(why);
  const cost = adCost(f, cmd.kind);
  if (!co.spend('ad', cost)) return fail(tr('資金が足りません(広告費 {cost} / 現金 {co})', { cost: yen(cost), co: yen(co.cash) }));
  f.ad = { kind: cmd.kind, from: sim.day };
  map.facilityVer++;
  const a = AD_TYPES[cmd.kind];
  return {
    ok: true,
    msg: tr('{name}に{name2}広告を出しました({cost})。{days}日間、来場者が約{a}%増え、近くの他の施設は約{a2}%減ります', {
      name: FACILITY_SPECS[f.type].name,
      name2: a.name,
      cost: yen(cost),
      days: a.days,
      a: Math.round((a.mul - 1) * 100),
      a2: Math.round((1 - a.rival) * 100),
    }),
  };
}

/** facPrice */
export function facPrice(cmd: Extract<Cmd, { t: 'facPrice' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { map, who } = ctx;
  const f = map.facilities.find((x) => x.id === cmd.facilityId);
  if (!f || (f.owner ?? 'player') !== 'player' || f.playerId !== who) return fail(tr('自社の施設ではありません'));
  if (!VISITOR_TYPES.includes(f.type) || FACILITY_SPECS[f.type].spend <= 0) return fail(tr('この施設は料金を設定できません(売上がありません)'));
  if (!Number.isInteger(cmd.level) || cmd.level < 0 || cmd.level >= PRICE_LEVELS.length) return fail(tr('料金の段階が正しくありません'));
  f.price = cmd.level;
  map.facilityVer++;
  return { ok: true, msg: tr('{name}の料金を「{label}」にしました。来場者と売上は明日以降に反映されます', { name: f.name, label: PRICE_LEVELS[cmd.level].label }) };
}

/** facUpgrade: グレードを1つ上げる */
export function facUpgrade(cmd: Extract<Cmd, { t: 'facUpgrade' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { map, co, who } = ctx;
  const f = map.facilities.find((x) => x.id === cmd.facilityId);
  if (!f || (f.owner ?? 'player') !== 'player' || f.playerId !== who) return fail(tr('自社の施設ではありません'));
  if (!VISITOR_TYPES.includes(f.type) || FACILITY_SPECS[f.type].spend <= 0) return fail(tr('この施設はグレードを上げられません'));
  const g = gradeOf(f);
  if (g >= GRADE_MAX) return fail(tr('最高のグレードです'));
  const cost = upgradeCost(facilityBuildCost(f), g);
  if (!co.spend('build', cost)) return fail(tr('資金が足りません(グレードアップ {cost} / 現金 {co})', { cost: yen(cost), co: yen(co.cash) }));
  f.grade = g + 1;
  map.facilityVer++;
  return { ok: true, msg: tr('{name}を★{g}にしました({cost})。客単価・来場者の上限・維持費が増えます。料金も見直すと評判を保てます', { name: f.name, g: g + 1, cost: yen(cost) }) };
}

/** facRenovate: 改装(新しさを戻し、評判を少し上げる) */
export function facRenovate(cmd: Extract<Cmd, { t: 'facRenovate' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { sim, map, co, who } = ctx;
  const f = map.facilities.find((x) => x.id === cmd.facilityId);
  if (!f || (f.owner ?? 'player') !== 'player' || f.playerId !== who) return fail(tr('自社の施設ではありません'));
  if (!VISITOR_TYPES.includes(f.type) || FACILITY_SPECS[f.type].spend <= 0) return fail(tr('この施設は改装できません'));
  if (freshness(f, sim.day) >= 0.99) return fail(tr('まだ新しいので、改装は不要です'));
  const cost = renovateCost(facilityBuildCost(f));
  if (!co.spend('build', cost)) return fail(tr('資金が足りません(改装 {cost} / 現金 {co})', { cost: yen(cost), co: yen(co.cash) }));
  f.renov = sim.day;
  f.rep = Math.min(100, repOf(f) + 10);
  map.facilityVer++;
  return { ok: true, msg: tr('{name}を改装しました({cost})。人気が戻り、評判も少し上がります', { name: f.name, cost: yen(cost) }) };
}

/** facRedesign: 建てた施設のデザインを、同じ大きさのまま変える(費用を払う) */
export function facRedesign(cmd: Extract<Cmd, { t: 'facRedesign' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { map, co, who } = ctx;
  const f = map.facilities.find((x) => x.id === cmd.facilityId);
  if (!f || (f.owner ?? 'player') !== 'player' || f.playerId !== who) return fail(tr('自社の施設ではありません'));
  const rule = redesignRule(f);
  if (!rule.ok) return fail(rule.reason);
  const n = DESIGN_COUNT[f.type] ?? 1;
  if (!Number.isInteger(cmd.design) || cmd.design < 0 || cmd.design >= n) return fail(tr('デザインが正しくありません'));
  if (f.design === cmd.design) return fail(tr('今と同じデザインです'));
  const cost = redesignCost(f);
  if (!co.spend('build', cost)) return fail(tr('資金が足りません(デザイン変更 {cost} / 現金 {co})', { cost: yen(cost), co: yen(co.cash) }));
  f.design = cmd.design;
  f.size = rule.size;
  map.facilityVer++;
  return { ok: true, msg: tr('{name}のデザインを変更しました({cost})。大きさ・敷地はそのままです', { name: f.name, cost: yen(cost) }) };
}

/** bid */
export function bid(cmd: Extract<Cmd, { t: 'bid' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { sim, co, who } = ctx;
  const lot = sim.auctions.lots.find((l) => l.id === Number(cmd.lotId));
  if (!lot) return fail(tr('競りが見つかりません'));
  const amount = Math.floor(Number(cmd.amount));
  if (!co.afford(amount)) return fail(tr('資金が足りません(入札額 {amount} / 現金 {co})', { amount: yen(amount), co: yen(co.cash) }));
  const err = sim.auctions.bid(who, lot.id, amount);
  return err ? fail(err) : { ok: true, msg: tr('{amount}で入札しました(締め切りまで あと{left}日。落札すると、その時点で支払います)', { amount: yen(amount), left: lot.left }) };
}

/** pact */
export function pact(cmd: Extract<Cmd, { t: 'pact' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { sim, who } = ctx;
  const pa = sim.pacts;
  if (cmd.op === 'propose') {
    const to = Number(cmd.to);
    if (!sim.players.has(to)) return fail(tr('相手が見つかりません'));
    const err = pa.propose(who, to, Number(cmd.discount));
    return err ? fail(err) : { ok: true, msg: tr('提携を申し込みました。相手の承諾を待ちます') };
  }
  const id = Number(cmd.id);
  if (cmd.op === 'accept' || cmd.op === 'reject') {
    const err = pa.respond(who, id, cmd.op === 'accept');
    return err ? fail(err) : { ok: true, msg: cmd.op === 'accept' ? tr('提携しました。互いの通行料が割り引かれます') : tr('申し込みを断りました') };
  }
  if (cmd.op === 'cancel') {
    const err = pa.cancel(who, id);
    return err ? fail(err) : { ok: true, msg: tr('提携を解消(または取り下げ)しました') };
  }
  return fail(tr('不正な操作です'));
}

/** develop */
export function develop(cmd: Extract<Cmd, { t: 'develop' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { t, who, charge } = ctx;
  const s = t.stops.get(cmd.stopId);
  if (!s || s.waypoint) return fail(tr('停留所が見つかりません'));
  if (s.owner !== who) return fail(tr('自社の停留所だけ開発できます'));
  const lv = s.dev ?? 0;
  if (lv >= DEV.max) return fail(tr('最高の開発度です'));
  const cost = devCost(lv);
  const bad = charge(cost, 'build', tr('沿線開発'));
  if (bad) return bad;
  s.dev = lv + 1;
  t.version++;
  return { ok: true, msg: tr('{name}の周りを開発しました(開発度{dev}・{cost})。乗客が増え、不動産収入が毎日入ります', { name: s.name, dev: s.dev, cost: yen(cost) }) };
}
