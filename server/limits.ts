import type { Cmd } from '../src/shared/protocol';

/** 1接続あたりの毎秒のメッセージ数の上限(正常な操作は 視界の更新+操作で毎秒20件程度)。超えた分は捨て、3倍を超えたら切断する */
export const MSG_PER_SEC = 80;

/** 接続ごとの頻度制限。メッセージを1件受け取るたびに呼ぶ: 'ok' = 処理する / 'drop' = 捨てる / 'close' = 接続を切る */
export function messageLimit(now: () => number = Date.now): () => 'ok' | 'drop' | 'close' {
  let windowStart = now();
  let count = 0;
  return () => {
    const t = now();
    if (t - windowStart >= 1000) {
      windowStart = t;
      count = 0;
    }
    count++;
    if (count > MSG_PER_SEC * 3) return 'close';
    return count > MSG_PER_SEC ? 'drop' : 'ok';
  };
}

/** 1回でサーバーを長く止めうる操作(長距離の自動敷設は、失敗しても1秒前後かかる) */
export const isHeavy = (cmd: unknown): boolean => !!cmd && typeof cmd === 'object' && (cmd as Cmd).t === 'build' && (cmd as { tool?: unknown }).tool === 'railauto';

/**
 * 重い操作の、サーバー全体の間隔。1回かかった時間の3倍は、次の重い操作を受け付けない
 * (全プレイヤーの重い操作を合わせても、サーバーの時間の4分の1までしか使わない)。最低でも 1.5秒
 */
export class Governor {
  private until = 0;

  constructor(private now: () => number = Date.now) {}

  /** いま重い操作を受け付けられない(直前の重い操作の後始末の時間中)か */
  busy(): boolean {
    return this.now() < this.until;
  }

  /** 重い操作が ms ミリ秒かかった */
  used(ms: number): void {
    this.until = this.now() + Math.max(1500, ms * 3);
  }
}

/**
 * 一定時間(既定1時間)あたりの件数の上限。サーバー全体の新規登録の数に使う
 * (登録できる人数に上限はないが、ボットに短時間で大量のアカウントを作られないようにする)
 */
export class WindowLimiter {
  private times: number[] = [];

  constructor(
    private max: number,
    private windowMs = 3_600_000,
    private now: () => number = Date.now,
  ) {}

  /** 1件分を受け付けられるなら、数えて true。上限に達していれば false */
  tryTake(): boolean {
    const t = this.now();
    while (this.times.length && t - this.times[0] >= this.windowMs) this.times.shift();
    if (this.times.length >= this.max) return false;
    this.times.push(t);
    return true;
  }
}
