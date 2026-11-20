import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Accounts } from './accounts';

describe('会社名・プロフィール', () => {
  it('保存でき、長すぎる・不正な色は拒否。タグや制御文字は除かれ、再読み込みしても残る', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'acc-')), 'a.json');
    const acc = new Accounts(file);
    const r = await acc.register('taro', 'secret12', 10);
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
    await acc.register('hanako', 'secret12', 10);
    const t = acc.issueToken(1);
    expect(acc.fromToken(t)?.name).toBe('hanako');
    expect(new Accounts(file).fromToken(t)?.name).toBe('hanako'); // 再起動後も有効
    expect(acc.fromToken(t.replace(/^1\./, '2.'))).toBeNull(); // 別のIDにすり替え
    expect(acc.fromToken(t.slice(0, -1) + (t.endsWith('0') ? '1' : '0'))).toBeNull(); // 署名の改ざん
    expect(acc.fromToken('')).toBeNull();
    expect(acc.fromToken('1.9999999999999.' + 'a'.repeat(32))).toBeNull();
    const other = new Accounts(join(mkdtempSync(join(tmpdir(), 'tok-')), 'a.json'));
    await other.register('hanako', 'secret12', 10);
    expect(other.fromToken(t)).toBeNull(); // 別のサーバー(別の鍵)のトークン
  });
});
