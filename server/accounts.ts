import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Account {
  id: number;
  name: string;
  salt: string;
  hash: string;
  createdAt: number;
  /** 会社の色 */
  color: number;
  /** 最後に見ていた場所(タイル)。次のログインでここから始まる */
  last?: { x: number; y: number };
}

const kdf = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((res, rej) => scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));

export const validName = (n: string) => /^[\p{L}\p{N}_\-]{2,16}$/u.test(n);
export const validPassword = (p: string) => p.length >= 6 && p.length <= 72;

/** アカウントの保存(JSONファイル。書き込みは一時ファイル経由で原子的に) */
export class Accounts {
  private list: Account[] = [];
  private tokens = new Map<string, { id: number; exp: number }>();

  constructor(private file: string) {
    if (existsSync(file)) this.list = JSON.parse(readFileSync(file, 'utf8')) as Account[];
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.list));
    renameSync(this.file + '.tmp', this.file);
  }

  setLast(id: number, x: number, y: number): void {
    const a = this.byId(id);
    if (a) a.last = { x, y };
  }

  /** 保存(切断時・定期) */
  flush(): void {
    this.save();
  }

  get count(): number {
    return this.list.length;
  }

  byId(id: number): Account | undefined {
    return this.list.find((a) => a.id === id);
  }

  async register(name: string, password: string, maxUsers: number): Promise<{ ok: true; account: Account } | { ok: false; reason: string }> {
    if (!validName(name)) return { ok: false, reason: '名前は2〜16文字(文字・数字・_-)です' };
    if (!validPassword(password)) return { ok: false, reason: 'パスワードは6文字以上です' };
    if (this.list.some((a) => a.name.toLowerCase() === name.toLowerCase())) return { ok: false, reason: 'その名前は使われています' };
    if (this.list.length >= maxUsers) return { ok: false, reason: `参加人数の上限(${maxUsers}人)に達しています` };
    const salt = randomBytes(16);
    const hash = await kdf(password, salt);
    const account: Account = { id: (this.list.at(-1)?.id ?? 0) + 1, name, salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: Date.now(), color: Math.floor(Math.random() * 0xffffff) };
    this.list.push(account);
    this.save();
    return { ok: true, account };
  }

  async verify(name: string, password: string): Promise<Account | null> {
    const a = this.list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    // 存在しない名前でも同じ時間をかける(ユーザー名の探り出し対策)
    const salt = a ? Buffer.from(a.salt, 'hex') : Buffer.alloc(16);
    const h = await kdf(password, salt);
    if (!a) return null;
    return timingSafeEqual(h, Buffer.from(a.hash, 'hex')) ? a : null;
  }

  issueToken(id: number): string {
    const t = randomBytes(24).toString('hex');
    this.tokens.set(t, { id, exp: Date.now() + 7 * 24 * 3600 * 1000 });
    return t;
  }

  fromToken(t: string): Account | null {
    const e = this.tokens.get(t);
    if (!e) return null;
    if (e.exp < Date.now()) {
      this.tokens.delete(t);
      return null;
    }
    return this.byId(e.id) ?? null;
  }
}
