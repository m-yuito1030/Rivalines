import type { ChatMsg } from '../src/shared/protocol';

export const CHAT_MAX_CHARS = 100;
export const CHAT_KEEP = 100;
/** Rate limit: at most this many messages within this window (ms) */
const WINDOW_MS = 10_000;
const WINDOW_MAX = 5;
/** The same text cannot be sent again within this window (ms) */
const REPEAT_MS = 30_000;

/**
 * Public chat. The log lives in memory only (the latest CHAT_KEEP messages) and is never written to disk; it is lost on restart.
 * When the operators receive a report, the reported message is attached to the report (so it survives there).
 */
export class Chat {
  private log: ChatMsg[] = [];
  private nextId = 1;
  private recent = new Map<number, { at: number; text: string }[]>();
  private mutedUntil = new Map<number, number>();

  /** Accept a message. On failure, returns the reason (a Japanese message key for tr()) */
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

  /** Recent messages (newest last) */
  recentLog(): ChatMsg[] {
    return [...this.log];
  }

  /** Mute an account from chat (minutes; 0 lifts it). Cleared by a server restart */
  mute(id: number, minutes: number, now = Date.now()): void {
    if (minutes <= 0) this.mutedUntil.delete(id);
    else this.mutedUntil.set(id, now + minutes * 60000);
  }

  /** Remove an account's messages from the log (on account deletion or ban) */
  forget(id: number): void {
    this.log = this.log.filter((m) => m.from !== id);
    this.recent.delete(id);
    this.mutedUntil.delete(id);
  }
}
