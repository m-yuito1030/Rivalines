import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Accounts } from './accounts';
import { isReservedName, normalizeName } from './reservedNames';

describe('運営・公式を連想させる名前', () => {
  it('そのままの語・大文字小文字・全角・区切り・数字の置き換えでも見抜く', () => {
    for (const n of [
      'admin',
      'Admin',
      'ADMIN',
      'ａｄｍｉｎ',
      'adm1n',
      'ad_min',
      'a-d-m-i-n',
      'official',
      '0fficial',
      'Official_Rivalines',
      'rivalines',
      'Rivalines2',
      'moderator',
      'my_admin_1',
      'root',
      'Staff',
      'system',
      'support',
      'GM',
      'bot',
    ]) {
      expect(isReservedName(n), n).toBe(true);
    }
  });
  it('日本語の語も見抜く(全角・半角カナを含む)', () => {
    for (const n of ['運営', '公式', '運営チーム', '公式アカウント', '管理者', '管理人1', '事務局', 'サポート', 'ｻﾎﾟｰﾄ', 'スタッフ', 'ゲームマスター', 'アドミン']) {
      expect(isReservedName(n), n).toBe(true);
    }
  });
  it('ふつうの名前は通す(語の一部が重なるだけの名前は、完全一致の語のときだけ止める)', () => {
    for (const n of ['taro', 'ひなた交通', 'Yuki_2026', 'sakura', 'trainfan', 'rail-bus', 'mystaffy', 'supporter', 'modern', 'ecosystemx', '白見急行', 'みどり']) {
      expect(isReservedName(n), n).toBe(false);
    }
  });
  it('空や記号だけは対象外', () => {
    expect(isReservedName('')).toBe(false);
    expect(normalizeName('A_d-M 1N')).toBe('admin');
  });
  it('登録できない。会社名にも使えない。ふつうの名前は登録できる', async () => {
    const acc = new Accounts(join(mkdtempSync(join(tmpdir(), 'rsv-')), 'a.json'));
    const bad = await acc.register('admin', 'secret12');
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.reason).toBe('その名前は使われています');
    expect((await acc.register('Adm1n', 'secret12')).ok).toBe(false);
    const ok = await acc.register('taro', 'secret12');
    expect(ok.ok).toBe(true);
    const id = acc.byId(1)!.id;
    expect(acc.setProfile(id, { company: '公式鉄道', bio: '', color: 0 })).toBe('その名前は使われています');
    expect(acc.setProfile(id, { company: 'Official Line', bio: '', color: 0 })).toBe('その名前は使われています');
    expect(acc.setProfile(id, { company: '白見急行', bio: '', color: 0 })).toBeNull();
  });
});
