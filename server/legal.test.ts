import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const terms = read('public/terms.html');
const privacy = read('public/privacy.html');
const index = read('index.html');

describe('利用規約・プライバシーポリシー', () => {
  it('ログイン画面とメニューから、どちらも開ける。同意の文言がある', () => {
    for (const page of ['terms.html', 'privacy.html']) {
      // ログイン画面(#start)とメニュー(#menu)の両方にリンクがある
      expect(index.split(`./${page}`).length - 1, page).toBeGreaterThanOrEqual(2);
    }
    expect(index).toContain('利用規約</a>に同意したものとみなします');
  });

  it('規約に、決めた方針が書かれている(1人1アカウント・複数アカウント禁止・不適切な文字・運営者の対応・退会)', () => {
    expect(terms).toContain('アカウントは、1人につき1つ');
    expect(terms).toContain('複数のアカウントを作成・利用すること');
    expect(terms).toContain('会社名・プロフィール・路線名');
    expect(terms).toMatch(/利用停止/);
    expect(terms).toContain('通報');
    expect(terms).toContain('退会');
    expect(terms).toContain('放置されたアカウントは、運営者が整理することはありません');
  });

  it('プライバシーポリシーの説明が、実際の設定と食い違わない(IP を保存しない・アクセスログなし・メール等を取らない)', () => {
    expect(privacy).toContain('メールアドレス');
    expect(privacy).toContain('ファイルやログには保存しません');
    expect(privacy).toContain('アクセスログは、無効');
    // 実際に nginx のアクセスログが無効になっている
    expect(read('nginx.conf')).toMatch(/^\s*access_log off;/m);
    // サーバーは、IP を永続化しない(試行回数の制限は、メモリ上の Map だけ)
    const server = read('server/index.ts');
    expect(server).toContain('const attempts = new Map<string, number[]>()');
    expect(server).not.toMatch(/writeFileSync\([^)]*(ip|addr)/i);
    // 画面が外部のサービスに接続しない(CSP の default-src が自分自身だけ)
    expect(read('security-headers.conf')).toContain("default-src 'self'");
    // アカウントの保存項目に、メールアドレスや IP がない
    const accounts = read('server/accounts.ts');
    expect(accounts).not.toMatch(/\b(email|mail|ip)\??:/i);
  });

  it('連絡先は公開の場所(GitHub Issues)で、個人情報を書かないよう注意している', () => {
    for (const page of [terms, privacy]) {
      expect(page).toContain('github.com/m-yuito1030/rivalines/issues');
      expect(page).toContain('個人情報');
    }
    expect(`${terms}${privacy}`).not.toMatch(/@gmail\.com|@[a-z0-9-]+\.(com|jp)/i);
  });
});
