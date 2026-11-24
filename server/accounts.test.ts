import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Accounts } from './accounts';

describe('会社名・プロフィール', () => {
  it('保存でき、長すぎる・不正な色は拒否。タグや制御文字は除かれ、再読み込みしても残る', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'acc-')), 'a.json');
    const acc = new Accounts(file);
    const r = await acc.register('taro', 'secret12');
    expect(r.ok).toBe(true);
    const id = acc.byId(1)!.id;
    expect(acc.setProfile(id, { company: '白見<b>急行</b>', bio: 'よろしく\n', color: 0x112233 })).toBeNull();
    expect(acc.byId(id)!.company).toBe('白見b急行/b');
    expect(acc.setProfile(id, { company: 'あ'.repeat(21), bio: '', color: 0 })).toMatch(/20文字/);
    expect(acc.setProfile(id, { company: 'a', bio: 'x'.repeat(121), color: 0 })).toMatch(/120文字/);
    expect(acc.setProfile(id, { company: 'a', bio: '', color: -1 })).toMatch(/色/);
    expect(acc.setProfile(id, { company: 'a', bio: '', color: 1.5 })).toMatch(/色/);
    expect(acc.setProfile(id, { company: '', bio: '', color: 5 })).toBeNull();
    expect(acc.byId(id)!.company).toBeUndefined(); // 空にすると未設定(アカウント名)に戻る
    expect(new Accounts(file).byId(id)!.color).toBe(5);
  });
});

describe('ログインのトークン', () => {
  it('署名つきで、サーバーを作り直しても有効。改ざん・期限切れ・別の鍵は無効', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tok-'));
    const file = join(dir, 'a.json');
    const acc = new Accounts(file);
    await acc.register('hanako', 'secret12');
    const t = acc.issueToken(1);
    expect(acc.fromToken(t)?.name).toBe('hanako');
    expect(new Accounts(file).fromToken(t)?.name).toBe('hanako'); // 再起動後も有効
    expect(acc.fromToken(t.replace(/^1\./, '2.'))).toBeNull(); // 別のIDにすり替え
    expect(acc.fromToken(t.slice(0, -1) + (t.endsWith('0') ? '1' : '0'))).toBeNull(); // 署名の改ざん
    expect(acc.fromToken('')).toBeNull();
    expect(acc.fromToken('1.9999999999999.' + 'a'.repeat(32))).toBeNull();
    const other = new Accounts(join(mkdtempSync(join(tmpdir(), 'tok-')), 'a.json'));
    await other.register('hanako', 'secret12');
    expect(other.fromToken(t)).toBeNull(); // 別のサーバー(別の鍵)のトークン
  });
});

describe('登録', () => {
  it('登録できる人数に上限はない(名前の重複と、検査後の同時登録は拒否)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'many-'));
    const file = join(dir, 'a.json');
    const acc = new Accounts(file);
    for (let i = 0; i < 101; i++) expect((await acc.register(`user${i}`, 'secret12')).ok).toBe(true); // 以前の上限(100人)を超えても登録できる
    expect(acc.count).toBe(101);
    expect(acc.byId(101)?.name).toBe('user100');
    expect(acc.byId(0)).toBeUndefined();
    // 名前の重複(大文字小文字を区別しない)
    expect((await acc.register('USER5', 'secret12')).ok).toBe(false);
    // 同時に同じ名前で登録しても、1つだけ成功する
    const results = await Promise.all([acc.register('same', 'secret12'), acc.register('SAME', 'secret12'), acc.register('Same', 'secret12')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(acc.count).toBe(102);
    // 再読み込みしても索引が作られ、名前でログインできる
    const again = new Accounts(file);
    expect((await again.verify('USER7', 'secret12'))?.id).toBe(8);
    expect(await again.verify('user7', 'wrong-password')).toBeNull();
    // パスワードのハッシュ(scrypt)を百回以上計算するので、他のテストと同時に走ると遅くなる。30秒では足りないことがあった
  }, 120_000);
});

describe('追随モード(次期バージョンが本稼働側のアカウントを読み取り専用で使う)', () => {
  const setup = async () => {
    const owner = mkdtempSync(join(tmpdir(), 'own-'));
    const mine = mkdtempSync(join(tmpdir(), 'fol-'));
    const live = new Accounts(join(owner, 'accounts.json'));
    await live.register('taro', 'secret12');
    live.flush();
    const next = new Accounts(join(mine, 'accounts.json'), { followFrom: owner, refreshMs: 0 });
    return { owner, mine, live, next };
  };
  it('同じ名前・パスワード・ログイン用トークンで使える。トークンは相互に有効', async () => {
    const { live, next } = await setup();
    expect((await next.verify('taro', 'secret12'))?.id).toBe(1);
    expect(await next.verify('taro', 'wrong-pass')).toBeNull();
    expect(next.fromToken(live.issueToken(1))?.name).toBe('taro'); // 本稼働のトークンで入れる
    expect(live.fromToken(next.issueToken(1))?.name).toBe('taro');
  });
  it('新規登録・停止・パスワード変更・退会は、追随側ではできない', async () => {
    const { next } = await setup();
    expect(next.readOnly).toBe(true);
    expect((await next.register('hanako', 'secret12')).ok).toBe(false);
    expect(next.setBan(1, 'x')).toBe(false);
    expect(next.clearText(1)).toBe(false);
    expect(await next.setPassword(1, 'newsecret12')).toMatch(/本稼働/);
    expect(next.remove(1)).toBe(false);
    expect(next.byId(1)).toBeDefined();
  });
  it('本稼働側の登録・停止がすぐ反映され、世界ごとの会社名・色・場所は本稼働側を変えない', async () => {
    const { owner, mine, live, next } = await setup();
    expect((await live.register('hanako', 'secret12')).ok).toBe(true);
    live.flush();
    expect(next.byName('hanako')?.id).toBe(2); // あとから登録された人も入れる
    expect(live.setBan(2, '規約違反')).toBe(true);
    expect(next.byId(2)?.banned?.reason).toBe('規約違反');
    expect(next.fromToken(live.issueToken(1))).not.toBeNull();
    // この世界だけの会社名・色・最後の場所
    expect(next.setProfile(1, { company: '次期鉄道', bio: 'テスト', color: 0x123456 })).toBeNull();
    next.setLast(1, 10, 20);
    next.flush();
    expect(next.byId(1)?.company).toBe('次期鉄道');
    expect(new Accounts(join(owner, 'accounts.json')).byId(1)?.company).toBeUndefined(); // 本稼働側は変わらない
    // 作り直しても残る
    const again = new Accounts(join(mine, 'accounts.json'), { followFrom: owner, refreshMs: 0 });
    expect(again.byId(1)?.company).toBe('次期鉄道');
    expect(again.byId(1)?.last).toEqual({ x: 10, y: 20 });
    expect(again.byId(1)?.color).toBe(0x123456);
  });
  it('本稼働側の token.secret がなければ起動しない', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nos-'));
    expect(() => new Accounts(join(mkdtempSync(join(tmpdir(), 'fol-')), 'a.json'), { followFrom: empty })).toThrow(/token\.secret/);
  });
});
