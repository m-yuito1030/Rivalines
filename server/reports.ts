import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Report {
  id: number;
  /** 通報した人・された人(アカウントID)と、その時点の名前(消えたあとでも読めるように) */
  from: number;
  fromName: string;
  target: number;
  targetName: string;
  reason: string;
  at: number;
}

const MAX_STORED = 500;
const PER_DAY = 5;
const DAY = 24 * 3600 * 1000;

/** プレイヤーからの通報(運営が見る)。公開しない・個人情報は持たない(ID・名前・理由・時刻だけ) */
export class Reports {
  private list: Report[] = [];
  private nextId = 1;

  constructor(private file: string) {
    if (existsSync(file)) {
      this.list = JSON.parse(readFileSync(file, 'utf8')) as Report[];
      this.nextId = Math.max(0, ...this.list.map((r) => r.id)) + 1;
    }
  }

  /** 通報する。できなければ理由 */
  add(from: { id: number; name: string }, target: { id: number; name: string }, reason: unknown, now = Date.now()): string | null {
    if (from.id === target.id) return '自分は通報できません';
    if (typeof reason !== 'string') return '理由を書いてください';
    const text = reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!text) return '理由を書いてください';
    if ([...text].length > 200) return '理由は200文字までです';
    if (this.list.filter((r) => r.from === from.id && now - r.at < DAY).length >= PER_DAY) return `通報は1日${PER_DAY}件までです`;
    if (this.list.some((r) => r.from === from.id && r.target === target.id && now - r.at < DAY)) return 'この人は、すでに通報しました';
    this.list.push({ id: this.nextId++, from: from.id, fromName: from.name, target: target.id, targetName: target.name, reason: text, at: now });
    if (this.list.length > MAX_STORED) this.list.splice(0, this.list.length - MAX_STORED); // 古いものから捨てる
    this.save();
    return null;
  }

  all(): Report[] {
    return [...this.list];
  }

  /** 対応済みにして消す(ID を指定。target を指定すると、その人への通報をまとめて) */
  dismiss(spec: { id?: number; target?: number }): number {
    const before = this.list.length;
    this.list = this.list.filter((r) => !(spec.id !== undefined ? r.id === spec.id : r.target === spec.target));
    if (this.list.length !== before) this.save();
    return before - this.list.length;
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.list));
    renameSync(this.file + '.tmp', this.file);
  }
}
