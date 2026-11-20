/**
 * コマンドバス: プレイヤーの操作(Cmd)を、種類ごとのハンドラに振り分けて実行する。
 * サーバーだけが世界を書き換える。ハンドラは種類ごとのファイルに分けてある(build / place / route / fleet / access / business / finance)。
 */
import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { Simulation } from '../../src/shared/sim/simulation';
import { CommandContext } from './context';
import { fail } from './util';
import { bulldoze, build, signalLine } from './build';
import { ensureStop, place } from './place';
import { orderSet, orderShift, routeBulk, routeClone, routeCreate, routeRank, routeReplace, routeSet, tx } from './route';
import { buyVehicle, rename, vehOffset, vehPlan } from './fleet';
import { companyAllow, stopAllow } from './access';
import { ad, bid, develop, pact } from './business';
import { fin, gift } from './finance';

type Handlers = { [K in Cmd['t']]: (cmd: Extract<Cmd, { t: K }>, ctx: CommandContext) => CmdResult };

const handlers: Handlers = {
  build,
  bulldoze,
  signalLine,
  ensureStop,
  place,
  routeCreate,
  tx,
  routeSet,
  orderSet,
  routeClone,
  routeRank,
  orderShift,
  routeBulk,
  routeReplace,
  rename,
  buyVehicle,
  vehPlan,
  vehOffset,
  stopAllow,
  companyAllow,
  ad,
  bid,
  pact,
  develop,
  gift,
  fin,
};

/** 変更したあと、影響を受けた範囲を知らせる(その範囲に関わる経路が、次の出発時に探し直される) */
function touchChanged(cmd: Cmd, ctx: CommandContext): void {
  const t = ctx.t;
  if (cmd.t === 'signalLine') t.touchNetwork(Math.min(cmd.a.x, cmd.b.x), Math.min(cmd.a.y, cmd.b.y), Math.max(cmd.a.x, cmd.b.x), Math.max(cmd.a.y, cmd.b.y));
  else if (cmd.t === 'place' && cmd.tool === 'signal') t.touchNetworkTiles([[cmd.x, cmd.y]]);
  else if (cmd.t === 'place' && ['station', 'airport', 'waypoint'].includes(cmd.tool)) t.touchNetwork(cmd.x - 12, cmd.y - 12, cmd.x + 12, cmd.y + 12);
}

/** プレイヤー who の操作を検証して実行する */
export function execute(sim: Simulation, who: number, cmd: Cmd): CmdResult {
  const handler = cmd && Object.hasOwn(handlers, cmd.t) ? (handlers[cmd.t] as (c: Cmd, x: CommandContext) => CmdResult) : null;
  if (!handler) return fail('不正な操作です');
  const ctx = new CommandContext(sim, who);
  ctx.t.actor = who; // TODO: Transit に「誰の操作か」を引数で渡すようにして、この書き込みをなくす
  try {
    const res = handler(cmd, ctx);
    if (res.ok) touchChanged(cmd, ctx);
    return res;
  } finally {
    ctx.t.actor = 0;
  }
}
