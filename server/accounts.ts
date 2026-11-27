import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AI_ID_BASE } from '../src/shared/sim/economy/aiCompanies';
import { isReservedName } from './reservedNames';

export interface Account {
  id: number;
  name: string;
  salt: string;
  hash: string;
  createdAt: number;
  /** Company color */
  color: number;
  /** Company name (display name; falls back to the account name) and profile (self-introduction) */
  company?: string;
  bio?: string;
  /** Last place viewed (tile). The next login starts here */
  last?: { x: number; y: number };
  /** Suspension (ban). The reason is shown to the player */
  banned?: { reason: string; at: number };
}

const kdf = (pw: string, salt: Buffer) => new Promise<Buffer>((res, rej) => scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));

export const validName = (n: string) => /^[\p{L}\p{N}_\-]{2,16}$/u.test(n);
export const validPassword = (p: string) => p.length >= 6 && p.length <= 72;

/** Account storage settings */
export interface AccountsOptions {
  /**
   * Follower mode: use the accounts owned by another server (the live one), read-only. Reads accounts.json and token.secret from that directory.
   * Registration, bans, and password changes can only be done on the live side. Only the per-world values (company name, profile, color, last place) are kept, in profiles.json in this world's own data directory.
   */
  followFrom?: string;
  /** In follower mode, how often (ms) to check whether the live side's files changed */
  refreshMs?: number;
}

/** Per-world values kept in follower mode */
type Overlay = Pick<Account, 'color' | 'company' | 'bio' | 'last'>;

/** Account storage (a JSON file; writes go through a temporary file so they are atomic) */
export class Accounts {
  private list: Account[] = [];
  /** Indexes by ID and by lower-cased name, so a large number of accounts does not mean scanning everyone each time */
  private byIdMap = new Map<number, Account>();
  private byNameMap = new Map<string, Account>();
  /** Token signing key (stored in the data directory, so logins survive a server restart) */
  private secret: Buffer;
  /** The next account ID to hand out. IDs of deleted accounts are never reused (so a new person cannot inherit a previous player's facilities). Stored in its own file */
  private nextId = 1;
  private readonly idFile: string;
  /** State of follower mode (using the live side's accounts read-only) */
  private readonly followDir?: string;
  private readonly refreshMs: number;
  private overlay: Record<number, Partial<Overlay>> = {};
  private sharedMtime = 0;
  private checkedAt = 0;

  /** Whether this is follower mode (registration, bans, and password changes are not possible) */
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

  /** Follower mode: re-read the live side's accounts.json and overlay this world's own values */
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

  /** Follower mode: re-read the live side's files if they changed (so registrations and bans take effect immediately) */
  private refresh(): void {
    if (!this.followDir) return;
    const now = Date.now();
    if (now - this.checkedAt < this.refreshMs) return;
    this.checkedAt = now;
    const sharedFile = `${this.followDir}/accounts.json`;
    const m = existsSync(sharedFile) ? statSync(sharedFile).mtimeMs : 0;
    if (m !== this.sharedMtime) this.loadShared();
  }

  /** Follower mode: record this world's own values */
  private recordOverlay(a: Account): void {
    this.overlay[a.id] = { color: a.color, company: a.company ?? '', bio: a.bio ?? '', last: a.last };
  }

  private index(a: Account): void {
    this.byIdMap.set(a.id, a);
    this.byNameMap.set(a.name.toLowerCase(), a);
  }

  /** The signature also mixes in part of the password hash (changing the password invalidates every earlier token) */
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

  /** Set company name, profile, and color. On invalid input, returns the reason */
  setProfile(id: number, p: { company?: unknown; bio?: unknown; color?: unknown }): string | null {
    const a = this.byId(id);
    if (!a) return 'アカウントがありません';
    const clean = (s: unknown, max: number): string | null => {
      if (typeof s !== 'string') return null;
      const v = s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim(); // strip control characters and tags
      return [...v].length > max ? null : v;
    };
    const company = clean(p.company, 20);
    const bio = clean(p.bio, 120);
    if (company === null) return '会社名は20文字までです';
    if (company && isReservedName(company)) return 'その名前は使われています'; // hide the reason for the ban: use the same wording as "already taken"
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

  /** Save (on disconnect and periodically) */
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

  /** Register. There is no cap on the number of accounts (only concurrent connections are capped) */
  async register(name: string, password: string): Promise<{ ok: true; account: Account } | { ok: false; reason: string }> {
    if (this.followDir) return { ok: false, reason: '新規登録は本稼働側で行ってください(同じ名前とパスワードで、こちらでも遊べます)' };
    if (!validName(name)) return { ok: false, reason: '名前は2〜16文字(文字・数字・_-)です' };
    if (isReservedName(name)) return { ok: false, reason: 'その名前は使われています' }; // hide the reason for the ban: use the same wording as "already taken"
    if (!validPassword(password)) return { ok: false, reason: 'パスワードは6文字以上です' };
    if (this.byNameMap.has(name.toLowerCase())) return { ok: false, reason: 'その名前は使われています' };
    // IDs above this are kept for the computer-run companies (the tile owner layers are 16-bit)
    if (this.nextId >= AI_ID_BASE) return { ok: false, reason: '登録できる人数の上限に達しました' };
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
    // There is an await (the hash computation) after the checks, so check once more right before saving that nobody registered the same name meanwhile
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
    // Take the same time even for a name that does not exist (defends against username probing)
    const salt = a ? Buffer.from(a.salt, 'hex') : Buffer.alloc(16);
    const h = await kdf(password, salt);
    if (!a) return null;
    return timingSafeEqual(h, Buffer.from(a.hash, 'hex')) ? a : null;
  }

  /** Login token (account ID, expiry, signature). The server keeps no state, so it stays valid across restarts */
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

  /** Find an account by name (or #ID) */
  find(who: string): Account | undefined {
    return /^#\d+$/.test(who) ? this.byId(Number(who.slice(1))) : this.byName(who);
  }

  /** Suspend / lift the suspension */
  setBan(id: number, reason: string | null): boolean {
    if (this.followDir) return false; // suspending and lifting can only be done on the live side
    const a = this.byId(id);
    if (!a) return false;
    a.banned = reason === null ? undefined : { reason: reason.slice(0, 100), at: Date.now() };
    this.save();
    return true;
  }

  /** Remove an inappropriate company name and profile (the company name reverts to the account name) */
  clearText(id: number): boolean {
    if (this.followDir) return false;
    const a = this.byId(id);
    if (!a) return false;
    a.company = undefined;
    a.bio = undefined;
    this.save();
    return true;
  }

  /** Change the password (the owner confirms with the current one; an operator needs no confirmation). Changing it invalidates every issued token */
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

  /** Delete the account (the caller cleans up the world's company data) */
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
