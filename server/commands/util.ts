import type { CmdResult } from '../../src/shared/protocol';
import { DAY_TICKS } from '../../src/shared/sim/network/transit';

export const fail = (msg: string): CmdResult => ({ ok: false, msg });

/** Name: only strings are accepted. Control characters are stripped and the length is capped at 24 */
export const clampName = (n: unknown): string => (typeof n === 'string' ? [...n.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 24).join('') : '');

/** Max routes per player (so free duplication/creation cannot bloat the world) */
export const MAX_ROUTES_PER_PLAYER = 300;
/** Max orders per route (so free insertion cannot bloat the data broadcast to everyone) */
export const MAX_ORDERS_PER_ROUTE = 200;

/** One in-game minute (ticks) */
export const MINT = DAY_TICKS / 1440;
