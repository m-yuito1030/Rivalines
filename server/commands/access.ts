import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { CommandContext } from './context';
import { fail } from './util';

/** stopAllow */
export function stopAllow(cmd: Extract<Cmd, { t: 'stopAllow' }>, ctx: CommandContext): CmdResult {
  const { sim, t, who } = ctx;
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

/** companyAllow */
export function companyAllow(cmd: Extract<Cmd, { t: 'companyAllow' }>, ctx: CommandContext): CmdResult {
  const { sim, t, who } = ctx;
  if (!Number.isInteger(cmd.who) || cmd.who === who || !sim.players.has(cmd.who)) return fail('許可する会社が正しくありません');
  const set = new Set(t.grants.get(who) ?? []);
  if (cmd.allow) set.add(cmd.who);
  else set.delete(cmd.who);
  if (set.size) t.grants.set(who, set);
  else t.grants.delete(who);
  t.version++;
  return { ok: true, msg: cmd.allow ? '自社の全停留所をその会社に開放しました' : 'その会社への全体の許可を取り消しました' };
}
