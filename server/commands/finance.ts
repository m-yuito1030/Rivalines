import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { CommandContext } from './context';
import { fail } from './util';
import { TRAINING } from '../../src/shared/sim/economy/economy';
import { acquireRival, divestRival } from '../../src/shared/sim/economy/rivals';
import { acquirePrice, assetValueFor, facilityValue, yen } from '../economyApi';

/** gift */
export function gift(cmd: Extract<Cmd, { t: 'gift' }>, ctx: CommandContext): CmdResult {
  const { sim, co, who } = ctx;
  // 資金支援: 他の会社へ送金する(自社の現金の範囲で)
  const amount = Math.floor(Number(cmd.amount));
  if (!(amount >= 10_000)) return fail('1万円以上を指定してください');
  if (cmd.to === who || !sim.players.has(cmd.to)) return fail('送り先が見つかりません');
  if (!co.spend('gift-out', amount)) return fail(`資金が足りません(現金 ${yen(co.cash)})`);
  sim.playerCompany(cmd.to).earn('gift-in', amount);
  return { ok: true, msg: `${yen(amount)}を送金しました` };
}

/** fin */
export function fin(cmd: Extract<Cmd, { t: 'fin' }>, ctx: CommandContext): CmdResult {
  const { sim, map, co, who } = ctx;
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
