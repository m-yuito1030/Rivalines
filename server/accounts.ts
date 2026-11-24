import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isReservedName } from './reservedNames';

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
  /** 利用停止(BAN)。理由は本人に見せる */
  banned?: { reason: string; at: number };
}

const kdf = (pw: string, salt: Buffer) => new Promise<Buffer>((res, rej) => scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));

export const validName = (n: string) => /^[\p{L}\p{N}_\-]{2,16}$/u.test(n);
export const validPassword = (p: string) => p.length >= 6 && p.length <= 72;

/** アカウントの保存の設定 */
export interface AccountsOptions {
  /**
   * 追随モード: 別のサーバー(本稼働側)が持つアカウントを、読み取り専用で使う。そのディレクトリの accounts.json と token.secret を読む。
   * 新規登録・停止(BAN)・パスワード変更などは、本稼働側だけができる。この世界ごとの値(会社名・プロフィール・色・最後の場所)だけを、自分のデータ置き場の profiles.json に持つ。
   */
  followFrom?: string;
  /** 追随モードで、本稼働側のファイルの更新を確かめる間隔(ミリ秒) */
  refreshMs?: number;
}

/** 追随モードで、世界ごとに持つ値 */
type Overlay = Pick<Account, 'color' | 'company' | 'bio' | 'last'>;

/** アカウントの保存(JSONファイル。書き込みは一時ファイル経由で原子的に) */
export class Accounts {
  private list: Account[] = [];
  /** ID・名前(小文字)から引く索引。アカウントが多くても、毎回全員を探さない */
  private byIdMap = new Map<number, Account>();
  private byNameMap = new Map<string, Account>();
  /** トークンの署名鍵(データ置き場に保存する。サーバーを再起動してもログインが切れない) */
  private secret: Buffer;
  /** 次に振るアカウントID。消したアカウントのIDを使い回さない(別の人が前の人の施設を引き継がないように)。専用ファイルに保存する */
  private nextId = 1;
  private readonly idFile: string;
  /** 追随モード(本稼働側のアカウントを読み取り専用で使う)の状態 */
  private readonly followDir?: string;
  private readonly refreshMs: number;
  private overlay: Record<number, Partial<Overlay>> = {};
  private sharedMtime = 0;
  private checkedAt = 0;

  /** 追随モードか(新規登録・停止・パスワード変更はできない) */
  get readOnly(): boolean {
    return !!this.followDir;
  }

  constructor(
    private file: string,
    opts: AccountsOptions = {},
  ) {
    this.followDir = opts.followFrom;
    this.refreshMs = opts.refreshMs ?? 1000;
    this.idFile = `${dirname(file)}/accounts.nextid`;
    if (this.followDir) {
      const sf = `${this.followDir}/token.secret`;
      if (!existsSync(sf)) throw new Error(`本稼働側の token.secret が見つかりません: ${sf}`);
      this.secret = Buffer.from(readFileSync(sf, 'utf8').trim(), 'hex');
      mkdirSync(dirname(file), { recursive: true });
      const of = this.overlayFile();
      if (existsSync(of)) this.overlay = JSON.parse(readFileSync(of, 'utf8')) as Record<number, Partial<Overlay>>;
      this.loadShared();
      return;
    }
    if (existsSync(file)) this.list = JSON.parse(readFileSync(file, 'utf8')) as Account[];
    for (const a of this.list) this.index(a);
    const saved = existsSync(this.idFile) ? Number(readFileSync(this.idFile, 'utf8').trim()) : 0;
    this.nextId = Math.max(saved || 0, ...this.list.map((a) => a.id + 1), 1);
    const sf = `${dirname(file)}/token.secret`;
    if (existsSync(sf)) this.secret = Buffer.from(readFileSync(sf, 'utf8').trim(), 'hex');
    else {
      this.secret = randomBytes(32);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(sf, this.secret.toString('hex'), { mode: 0o600 });
    }
  }

  private overlayFile(): string {
    return `${dirname(this.file)}/profiles.json`;
  }

  /** 追随モード: 本稼働側の accounts.json を読み直し、この世界ごとの値を重ねる */
  private loadShared(): void {
    const sharedFile = `${this.followDir}/accounts.json`;
    this.list = existsSync(sharedFile) ? (JSON.parse(readFileSync(sharedFile, 'utf8')) as Account[]) : [];
    this.sharedMtime = existsSync(sharedFile) ? statSync(sharedFile).mtimeMs : 0;
    this.byIdMap.clear();
    this.byNameMap.clear();
    for (const raw of this.list) {
      const o = this.overlay[raw.id] ?? {};
      const a: Account = { ...raw };
      if (o.color !== undefined) a.color = o.color;
      if ('company' in o) a.company = o.company || undefined;
      if ('bio' in o) a.bio = o.bio || undefined;
      if (o.last) a.last = o.last;
      this.index(a);
    }
  }

  /** 追随モード: 本稼働側のファイルが変わっていたら読み直す(登録・停止などがすぐ反映される) */
  private refresh(): void {
    if (!this.followDir) return;
    const now = Date.now();
    if (now - this.checkedAt < this.refreshMs) return;
    this.checkedAt = now;
    const sharedFile = `${this.followDir}/accounts.json`;
    const m = existsSync(sharedFile) ? statSync(sharedFile).mtimeMs : 0;
    if (m !== this.sharedMtime) this.loadShared();
  }

  /** 追随モード: この世界ごとの値を記録する */
  private recordOverlay(a: Account): void {
    this.overlay[a.id] = { color: a.color, company: a.company ?? '', bio: a.bio ?? '', last: a.last };
  }

  private index(a: Account): void {
    this.byIdMap.set(a.id, a);
    this.byNameMap.set(a.name.toLowerCase(), a);
  }

  /** 署名には、パスワードのハッシュの一部も混ぜる(パスワードを変えると、それまでのトークンが全部無効になる) */
  private sign(body: string, a: Account): string {
    return createHmac('sha256', this.secret)
      .update(`${body}.${a.hash.slice(0, 16)}`)
      .digest('hex')
      .slice(0, 32);
  }

  private save(): void {
    if (this.followDir) {
      writeFileSync(this.overlayFile() + '.tmp', JSON.stringify(this.overlay));
      renameSync(this.overlayFile() + '.tmp', this.overlayFile());
      return;
    }
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.list));
    renameSync(this.file + '.tmp', this.file);
    writeFileSync(this.idFile, String(this.nextId));
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
    if (company && isReservedName(company)) return '運営や公式と紛らわしい名前は使えません';
    if (bio === null) return 'プロフィールは120文字までです';
    if (!Number.isInteger(p.color) || (p.color as number) < 0 || (p.color as number) > 0xffffff) return '色が正しくありません';
    a.company = company || undefined;
    a.bio = bio || undefined;
    a.color = p.color as number;
    if (this.followDir) this.recordOverlay(a);
    this.save();
    return null;
  }

  setLast(id: number, x: number, y: number): void {
    const a = this.byId(id);
    if (!a) return;
    a.last = { x, y };
    if (this.followDir) this.recordOverlay(a);
  }

  /** 保存(切断時・定期) */
  flush(): void {
    this.save();
  }

  get count(): number {
    this.refresh();
    return this.list.length;
  }

  byId(id: number): Account | undefined {
    this.refresh();
    return this.byIdMap.get(id);
  }

  /** 新規登録。登録できる人数に上限はない(上限があるのは同時接続の数だけ) */
  async register(name: string, password: string): Promise<{ ok: true; account: Account } | { ok: false; reason: string }> {
    if (this.followDir) return { ok: false, reason: '新規登録は本稼働側で行ってください(同じ名前とパスワードで、こちらでも遊べます)' };
    if (!validName(name)) return { ok: false, reason: '名前は2〜16文字(文字・数字・_-)です' };
    if (isReservedName(name)) return { ok: false, reason: '運営や公式と紛らわしい名前は使えません' };
    if (!validPassword(password)) return { ok: false, reason: 'パスワードは6文字以上です' };
    if (this.byNameMap.has(name.toLowerCase())) return { ok: false, reason: 'その名前は使われています' };
    const salt = randomBytes(16);
    const hash = await kdf(password, salt);
    const account: Account = {
      id: 0,
      name,
      salt: salt.toString('hex'),
      hash: hash.toString('hex'),
      createdAt: Date.now(),
      color: Math.floor(Math.random() * 0xffffff),
    };
    // 検査のあとに await(ハッシュ計算)があるので、同時に同じ名前が登録されていないか、保存の直前にもう一度確かめる
    if (this.byNameMap.has(name.toLowerCase())) return { ok: false, reason: 'その名前は使われています' };
    account.id = this.nextId++;
    this.list.push(account);
    this.index(account);
    this.save();
    return { ok: true, account };
  }

  async verify(name: string, password: string): Promise<Account | null> {
    this.refresh();
    const a = this.byNameMap.get(name.toLowerCase());
    // 存在しない名前でも同じ時間をかける(ユーザー名の探り出し対策)
    const salt = a ? Buffer.from(a.salt, 'hex') : Buffer.alloc(16);
    const h = await kdf(password, salt);
    if (!a) return null;
    return timingSafeEqual(h, Buffer.from(a.hash, 'hex')) ? a : null;
  }

  /** ログイン用のトークン(アカウントID・期限・署名)。サーバーに状態を持たないので、再起動しても有効 */
  issueToken(id: number): string {
    const a = this.byId(id);
    if (!a) return '';
    const body = `${id}.${Date.now() + 14 * 24 * 3600 * 1000}`;
    return `${body}.${this.sign(body, a)}`;
  }

  fromToken(t: string): Account | null {
    const m = /^(\d{1,9})\.(\d{10,15})\.([0-9a-f]{32})$/.exec(t);
    if (!m) return null;
    const a = this.byId(Number(m[1]));
    if (!a || a.banned) return null;
    const ok = timingSafeEqual(Buffer.from(this.sign(`${m[1]}.${m[2]}`, a)), Buffer.from(m[3]));
    return ok && Number(m[2]) >= Date.now() ? a : null;
  }

  byName(name: string): Account | undefined {
    this.refresh();
    return this.byNameMap.get(name.toLowerCase());
  }

  /** 名前(または #ID)からアカウントを探す */
  find(who: string): Account | undefined {
    return /^#\d+$/.test(who) ? this.byId(Number(who.slice(1))) : this.byName(who);
  }

  /** 利用停止にする / 解除する */
  setBan(id: number, reason: string | null): boolean {
    if (this.followDir) return false; // 停止・解除は本稼働側だけ
    const a = this.byId(id);
    if (!a) return false;
    a.banned = reason === null ? undefined : { reason: reason.slice(0, 100), at: Date.now() };
    this.save();
    return true;
  }

  /** 不適切な会社名・プロフィールを消す(会社名は、アカウント名に戻る) */
  clearText(id: number): boolean {
    if (this.followDir) return false;
    const a = this.byId(id);
    if (!a) return false;
    a.company = undefined;
    a.bio = undefined;
    this.save();
    return true;
  }

  /** パスワードの変更(本人は現在のパスワードで確認、管理者は確認なし)。変えると、発行済みのトークンは無効になる */
  async setPassword(id: number, password: string): Promise<string | null> {
    if (this.followDir) return 'パスワードの変更は本稼働側で行ってください';
    const a = this.byId(id);
    if (!a) return 'アカウントがありません';
    if (!validPassword(password)) return 'パスワードは6文字以上72文字以下です';
    const salt = randomBytes(16);
    const hash = await kdf(password, salt);
    a.salt = salt.toString('hex');
    a.hash = hash.toString('hex');
    this.save();
    return null;
  }

  /** アカウントを消す(世界の会社のデータの片付けは、呼ぶ側で) */
  remove(id: number): boolean {
    if (this.followDir) return false;
    const a = this.byId(id);
    if (!a) return false;
    this.list = this.list.filter((x) => x.id !== id);
    this.byIdMap.delete(id);
    this.byNameMap.delete(a.name.toLowerCase());
    this.save();
    return true;
  }
}
