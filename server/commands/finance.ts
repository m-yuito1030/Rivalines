import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { CommandContext } from './context';
import { fail } from './util';
import { LISTING_DAYS } from '../../src/shared/sim/facility/listings';
import { TRAINING } from '../../src/shared/sim/economy/economy';
import { acquireRival, divestRival } from '../../src/shared/sim/economy/rivals';
import { acquirePrice, assetValueFor, facilityValue, yen } from '../economyApi';

/** gift */
export function gift(cmd: Extract<Cmd, { t: 'gift' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { sim, co, who } = ctx;
  // Funding: send money to another company (within your own cash)
  const amount = Math.floor(Number(cmd.amount));
  if (!(amount >= 10_000)) return fail(tr('1万円以上を指定してください'));
  if (cmd.to === who || !sim.players.has(cmd.to)) return fail(tr('送り先が見つかりません'));
  if (!co.spend('gift-out', amount)) return fail(tr('資金が足りません(現金 {co})', { co: yen(co.cash) }));
  sim.playerCompany(cmd.to).earn('gift-in', amount);
  return { ok: true, msg: tr('{amount}を送金しました', { amount: yen(amount) }) };
}

/** fin */
export function fin(cmd: Extract<Cmd, { t: 'fin' }>, ctx: CommandContext): CmdResult {
  const tr = ctx.tr;
  const { sim, map, co, who } = ctx;
  const amount = Number(cmd.amount ?? 0);
  const assets = assetValueFor(sim, who);
  if (cmd.op === 'payout') {
    if (![0, 0.2, 0.4].includes(amount)) return fail(tr('不正な値です'));
    co.payout = amount;
    return { ok: true, msg: co.payout > 0 ? tr('配当性向を {co}% にしました', { co: Math.round(co.payout * 100) }) : tr('配当をしないことにしました') };
  }
  if (cmd.op === 'train') {
    const err = co.startTraining();
    return err ? fail(err) : { ok: true, msg: tr('従業員の研修を始めました({days}日後にレベル{to}になります)', { days: TRAINING.days, to: co.trainingPending!.to }) };
  }
  if (cmd.op === 'borrow') {
    const err = co.borrow(amount, co.credit, assets);
    return err ? fail(err) : { ok: true, msg: tr('{amount}を借り入れました', { amount: yen(amount) }) };
  }
  if (cmd.op === 'repay') {
    const paid = co.repay(amount === 0 ? Infinity : amount);
    return paid > 0 ? { ok: true, msg: tr('{paid}を返済しました', { paid: yen(paid) }) } : fail(tr('返済できません(現金不足または借入なし)'));
  }
  if (cmd.op === 'rival-buy' || cmd.op === 'rival-sell') {
    const r = sim.rivals.find((x) => x.id === cmd.id);
    if (!r) return fail(tr('見つかりません'));
    if (cmd.op === 'rival-buy') {
      const err = acquireRival(co, r, map, who);
      return err ? fail(err) : { ok: true, msg: tr('{name}を買収しました({acquirePrice})', { name: r.name, acquirePrice: yen(acquirePrice(r)) }) };
    }
    const get = divestRival(co, r, who);
    return get > 0 ? { ok: true, msg: tr('{name}を手放しました({get})', { name: r.name, get: yen(get) }) } : fail(tr('傘下の会社ではありません'));
  }
  if (cmd.op === 'acquire' || cmd.op === 'sell') {
    const f = map.facilities.find((x) => x.id === cmd.id);
    if (!f) return fail(tr('見つかりません'));
    const v = facilityValue(f);
    if (cmd.op === 'acquire') {
      if ((f.owner ?? 'player') === 'player' || f.owner === 'public') return fail(tr('買収できません'));
      if (!co.spend('acquire', v)) return fail(tr('資金が足りません(買収額 {v})', { v: yen(v) }));
      f.owner = 'player';
      f.playerId = who;
      f.listedDay = undefined; // the listing ends
      map.facilityVer++;
      return { ok: true, msg: tr('{name}を {v} で購入しました', { name: f.name, v: yen(v) }) };
    }
    if (f.playerId !== who) return fail(tr('自社の施設ではありません'));
    const get = Math.round(v * 0.6);
    co.earn('sale', get);
    f.owner = 'city';
    f.ownerId = undefined; // becomes a listed property owned by no company
    f.playerId = undefined;
    f.listedDay = sim.day;
    map.facilityVer++;
    return {
      ok: true,
      msg: tr('{name}を {get} で売却しました。不動産物件として売りに出され、{LISTING_DAYS}日間買い手がつかないと取り壊されて更地に戻ります', {
        name: f.name,
        get: yen(get),
        LISTING_DAYS,
      }),
    };
  }
  return fail(tr('不正な操作です'));
}
