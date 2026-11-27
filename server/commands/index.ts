/**
 * Command bus: dispatches each player action (Cmd) to the handler for its type and runs it.
 * Only the server mutates the world. Handlers are split by kind into files (build / place / route / fleet / access / business / finance).
 */
import type { Cmd, CmdResult } from '../../src/shared/protocol';
import type { Simulation } from '../../src/shared/sim/simulation';
import { LOCALES, type LangCode } from '../../src/shared/i18n';
import { CommandContext } from './context';
import { fail } from './util';
import { bulldoze, build, signalLine } from './build';
import { ensureStop, place } from './place';
import { orderSet, orderShift, routeBulk, routeClone, routeCreate, routeRank, routeReplace, routeSet, tx } from './route';
import { buyVehicle, rename, vehOffset, vehPlan } from './fleet';
import { companyAllow, stopAllow } from './access';
import { ad, bid, develop, facPrice, facRedesign, facRenovate, facUpgrade, pact } from './business';
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
  facPrice,
  facUpgrade,
  facRenovate,
  facRedesign,
  bid,
  pact,
  develop,
  gift,
  fin,
};

/** After a change, report the affected area (paths touching it are searched again at the next departure) */
function touchChanged(cmd: Cmd, ctx: CommandContext): void {
  const t = ctx.t;
  if (cmd.t === 'signalLine') t.touchNetwork(Math.min(cmd.a.x, cmd.b.x), Math.min(cmd.a.y, cmd.b.y), Math.max(cmd.a.x, cmd.b.x), Math.max(cmd.a.y, cmd.b.y));
  else if (cmd.t === 'place' && cmd.tool === 'signal') t.touchNetworkTiles([[cmd.x, cmd.y]]);
  else if (cmd.t === 'place' && ['station', 'airport', 'waypoint'].includes(cmd.tool)) t.touchNetwork(cmd.x - 12, cmd.y - 12, cmd.x + 12, cmd.y + 12);
}

/** Validate and run player `who`'s action */
export function execute(sim: Simulation, who: number, cmd: Cmd, lang: LangCode = 'ja'): CmdResult {
  const handler = cmd && Object.hasOwn(handlers, cmd.t) ? (handlers[cmd.t] as (c: Cmd, x: CommandContext) => CmdResult) : null;
  if (!handler) return fail(LOCALES[lang].tr('不正な操作です'));
  const ctx = new CommandContext(sim, who, lang);
  ctx.t.actor = who; // TODO: pass "who acted" to Transit as an argument and remove this write
  try {
    const res = handler(cmd, ctx);
    if (res.ok) touchChanged(cmd, ctx);
    return res;
  } finally {
    ctx.t.actor = 0;
  }
}
