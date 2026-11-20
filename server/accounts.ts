import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
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
  /** 会社名(表示名。なければアカウント名)とプロフィール(自己紹介) */
  company?: string;
  bio?: string;
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
  /** トークンの署名鍵(データ置き場に保存する。サーバーを再起動してもログインが切れない) */
  private secret: Buffer;

  constructor(private file: string) {
    if (existsSync(file)) this.list = JSON.parse(readFileSync(file, 'utf8')) as Account[];
    const sf = `${dirname(file)}/token.secret`;
    if (existsSync(sf)) this.secret = Buffer.from(readFileSync(sf, 'utf8').trim(), 'hex');
    else {
      this.secret = randomBytes(32);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(sf, this.secret.toString('hex'), { mode: 0o600 });
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex').slice(0, 32);
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.list));
    renameSync(this.file + '.tmp', this.file);
  }

  /** 会社名・プロフィール・色の設定。不正なら理由を返す */
  setProfile(id: number, p: { company?: unknown; bio?: unknown; color?: unknown }): string | null {
    const a = this.byId(id);
    if (!a) return 'アカウントがありません';
    const clean = (s: unknown, max: number): string | null => {
      if (typeof s !== 'string') return null;
      const v = s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim(); // 制御文字・タグは除く
      return [...v].length > max ? null : v;
    };
    const company = clean(p.company, 20);
    const bio = clean(p.bio, 120);
    if (company === null) return '会社名は20文字までです';
    if (bio === null) return 'プロフィールは120文字までです';
    if (!Number.isInteger(p.color) || (p.color as number) < 0 || (p.color as number) > 0xffffff) return '色が正しくありません';
    a.company = company || undefined;
    a.bio = bio || undefined;
    a.color = p.color as number;
    this.save();
    return null;
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

  /** ログイン用のトークン(アカウントID・期限・署名)。サーバーに状態を持たないので、再起動しても有効 */
  issueToken(id: number): string {
    const body = `${id}.${Date.now() + 14 * 24 * 3600 * 1000}`;
    return `${body}.${this.sign(body)}`;
  }

  fromToken(t: string): Account | null {
    const m = /^(\d{1,9})\.(\d{10,15})\.([0-9a-f]{32})$/.exec(t);
    if (!m) return null;
    const ok = timingSafeEqual(Buffer.from(this.sign(`${m[1]}.${m[2]}`)), Buffer.from(m[3]));
    if (!ok || Number(m[2]) < Date.now()) return null;
    return this.byId(Number(m[1])) ?? null;
  }
}
