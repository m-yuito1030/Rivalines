import type { CmdResult } from '../../src/shared/protocol';
import { DAY_TICKS } from '../../src/shared/sim/network/transit';

export const fail = (msg: string): CmdResult => ({ ok: false, msg });

/** 名前: 文字列だけ受け付ける。制御文字を除き、24文字まで */
export const clampName = (n: unknown): string => (typeof n === 'string' ? [...n.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 24).join('') : '');

/** 1人あたりの路線数の上限(無料の複製・作成で世界を肥大化させない) */
export const MAX_ROUTES_PER_PLAYER = 300;
/** 1つの路線のオーダー数の上限(無料の挿入で、全員に配信するデータを肥大化させない) */
export const MAX_ORDERS_PER_ROUTE = 200;

/** ゲーム内の1分(tick) */
export const MINT = DAY_TICKS / 1440;
