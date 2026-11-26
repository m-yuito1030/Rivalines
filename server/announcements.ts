import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Announcement {
  id: number;
  at: number;
  title: string;
  body: string;
}

const MAX_KEPT = 30;
const clean = (s: string, max: number): string | null => {
  const v = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, '').trim(); // 改行は残す
  return v && [...v].length <= max ? v : null;
};

/**
 * 運営からのお知らせ(メニューに出る)。運営の操作(admin)で足す・消す。
 * 次期バージョンは、本稼働のお知らせを読む(読み取り専用。file を本稼働のデータの場所に向ける)。
 */
export class Announcements {
  private cache: Announcement[] = [];
  private mtime = -1;

  constructor(
    private readonly file: string,
    readonly readOnly = false,
  ) {}

  /** 新しい順 */
  list(): Announcement[] {
    try {
      const m = statSync(this.file).mtimeMs;
      if (m !== this.mtime) {
        this.cache = JSON.parse(readFileSync(this.file, 'utf8')) as Announcement[];
        this.mtime = m;
      }
    } catch {
      this.cache = [];
      this.mtime = -1;
    }
    return [...this.cache].sort((a, b) => b.id - a.id);
  }

  /** 足す。できなければ理由 */
  add(title: string, body: string, now = Date.now()): { ok: true; item: Announcement } | { ok: false; reason: string } {
    if (this.readOnly) return { ok: false, reason: 'お知らせは本稼働側で書いてください' };
    const t = clean(title, 40);
    const b = clean(body, 500);
    if (!t) return { ok: false, reason: 'タイトルは1〜40文字です' };
    if (!b) return { ok: false, reason: '本文は1〜500文字です' };
    const all = this.list();
    const item = { id: Math.max(0, ...all.map((a) => a.id)) + 1, at: now, title: t, body: b };
    this.save([item, ...all].slice(0, MAX_KEPT));
    return { ok: true, item };
  }

  remove(id: number): boolean {
    if (this.readOnly) return false;
    const all = this.list();
    if (!all.some((a) => a.id === id)) return false;
    this.save(all.filter((a) => a.id !== id));
    return true;
  }

  private save(list: Announcement[]): void {
    if (!existsSync(dirname(this.file))) mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(list));
    renameSync(this.file + '.tmp', this.file);
    this.mtime = -1;
  }
}
