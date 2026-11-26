import type { ChatMsg } from '../src/shared/protocol';

export const CHAT_MAX_CHARS = 100;
export const CHAT_KEEP = 100;
/** 連投の制限: この時間(ms)のうちに、この件数まで */
const WINDOW_MS = 10_000;
const WINDOW_MAX = 5;
/** 同じ文を、この時間のうちに続けて送れない */
const REPEAT_MS = 30_000;

/**
 * 全体チャット。記録はメモリの中だけ(直近 CHAT_KEEP 件)で、ディスクには保存しない。サーバーを再起動すると消える。
 * 運営が通報を受けたとき、その発言を通報に添える(通報の側に残る)。
 */
export class Chat {
  private log: ChatMsg[] = [];
  private nextId = 1;
  private recent = new Map<number, { at: number; text: string }[]>();
  private mutedUntil = new Map<number, number>();

  /** 発言を受け付ける。できなければ理由 */
  post(from: { id: number; name: string }, text: unknown, now = Date.now()): { ok: true; msg: ChatMsg } | { ok: false; reason: string } {
    if (typeof text !== 'string') return { ok: false, reason: '発言を入力してください' };
    const t = text
      .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return { ok: false, reason: '発言を入力してください' };
    if ([...t].length > CHAT_MAX_CHARS) return { ok: false, reason: '発言は100文字までです' };
    const until = this.mutedUntil.get(from.id) ?? 0;
    if (until > now) return { ok: false, reason: '発言を停止されています' };
    const mine = (this.recent.get(from.id) ?? []).filter((r) => now - r.at < REPEAT_MS);
    if (mine.filter((r) => now - r.at < WINDOW_MS).length >= WINDOW_MAX) return { ok: false, reason: '発言が多すぎます。少し待ってください' };
    if (mine.some((r) => r.text === t)) return { ok: false, reason: '同じ発言を続けて送れません' };
    mine.push({ at: now, text: t });
    this.recent.set(from.id, mine);
    const msg: ChatMsg = { id: this.nextId++, from: from.id, name: from.name, text: t, at: now };
    this.log.push(msg);
    if (this.log.length > CHAT_KEEP) this.log.splice(0, this.log.length - CHAT_KEEP);
    return { ok: true, msg };
  }

  /** 直近の発言(新しいものが後ろ) */
  recentLog(): ChatMsg[] {
    return [...this.log];
  }

  /** 発言を止める(分。0 で解除)。サーバーの再起動で解ける */
  mute(id: number, minutes: number, now = Date.now()): void {
    if (minutes <= 0) this.mutedUntil.delete(id);
    else this.mutedUntil.set(id, now + minutes * 60000);
  }

  /** そのアカウントの発言を、履歴から消す(退会・BAN のとき) */
  forget(id: number): void {
    this.log = this.log.filter((m) => m.from !== id);
    this.recent.delete(id);
    this.mutedUntil.delete(id);
  }
}
