import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const terms = read('public/terms.html');
const privacy = read('public/privacy.html');
const index = read('index.html');
const termsEn = read('public/terms.en.html');
const privacyEn = read('public/privacy.en.html');

describe('利用規約・プライバシーポリシー', () => {
  it('ログイン画面とメニューから、どちらも開ける。同意の文言がある', () => {
    for (const page of ['terms.html', 'privacy.html']) {
      // ログイン画面(#start)とメニュー(#menu)の両方にリンクがある
      expect(index.split(`./${page}`).length - 1, page).toBeGreaterThanOrEqual(2);
    }
    expect(index).toMatch(/利用規約<\/a><span[^>]*>に同意したものとみなします/);
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

  it('英語版がある。日本語ページから英語へ、英語ページから日本語へ行ける。日本語版が優先と書いてある', () => {
    expect(terms).toContain('terms.en.html');
    expect(privacy).toContain('privacy.en.html');
    expect(termsEn).toContain('./terms.html');
    expect(privacyEn).toContain('./privacy.html');
    for (const page of [termsEn, privacyEn]) {
      expect(page).toContain('the Japanese version prevails');
      expect(page).toContain('github.com/m-yuito1030/rivalines/issues');
      expect(page).toContain('personal information');
      expect(page).not.toMatch(/@gmail\.com|@[a-z0-9-]+\.(com|jp)/i);
    }
  });

  it('英語版にも、決めた方針と実際の設定が書かれている(1人1アカウント・複数アカウント禁止・退会・IP を保存しない・メール等を取らない)', () => {
    expect(termsEn).toContain('One account per person');
    expect(termsEn).toContain('Creating or using more than one account');
    expect(termsEn).toMatch(/suspending an account/);
    expect(termsEn).toContain('Report');
    expect(termsEn).toContain('does not clean up inactive accounts');
    expect(privacyEn).toContain('email address');
    expect(privacyEn).toContain('not saved to files or logs');
    expect(privacyEn).toContain('access log');
    expect(privacyEn).toContain('valid for 14 days');
  });

  it('規約・ポリシーの日本語版と英語版は、最終更新の日付が同じ', () => {
    const d = (s: string) =>
      s
        .match(/最終更新: (\d+)年(\d+)月(\d+)日/)!
        .slice(1)
        .map(Number);
    const e = (s: string) => {
      const m = s.match(/Last updated: ([A-Za-z]+) (\d+), (\d+)/)!;
      return [
        Number(m[3]),
        ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(m[1]) + 1,
        Number(m[2]),
      ];
    };
    expect(e(termsEn)).toEqual(d(terms));
    expect(e(privacyEn)).toEqual(d(privacy));
  });

  it('画面のリンクは、言語に合わせて切り替わる(data-legal)', () => {
    expect(index.split('data-legal="terms"').length - 1).toBeGreaterThanOrEqual(2);
    expect(index.split('data-legal="privacy"').length - 1).toBeGreaterThanOrEqual(2);
    expect(read('src/client/i18n.ts')).toContain('.en.html');
  });

  it('チャットの扱い(メモリ上だけ・直近100件)が、実装と食い違わずに書かれている', () => {
    expect(privacy).toContain('直近の100件');
    expect(privacy).toContain('ファイルには保存しません');
    const chat = read('server/chat.ts');
    expect(chat).toContain('export const CHAT_KEEP = 100');
    expect(chat).not.toMatch(/writeFileSync|appendFile/); // ディスクに書かない
    expect(terms).toContain('チャットの発言');
    expect(privacyEn).toContain('most recent 100 messages');
    expect(privacyEn).toContain('not saved to files');
    expect(termsEn).toContain('chat messages');
  });
});
