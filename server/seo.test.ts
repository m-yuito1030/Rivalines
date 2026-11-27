import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const portal = read('portal/index.html');
const ja = read('public/ja.html');
const attr = (html: string, re: RegExp) => re.exec(html)?.[1];

describe('検索エンジン対策(SEO)', () => {
  it('トップ(英語)と日本語の紹介ページに、題・説明(長すぎない)・正規の URL・見出しがある', () => {
    for (const [html, url] of [
      [portal, 'https://rivalines.com/'],
      [ja, 'https://rivalines.com/ja.html'],
    ] as const) {
      const title = attr(html, /<title>([^<]+)<\/title>/)!;
      const desc = attr(html, /<meta name="description" content="([^"]+)"/)!;
      expect(title.length).toBeGreaterThan(20);
      expect(title.length).toBeLessThanOrEqual(75);
      expect(desc.length).toBeGreaterThan(60);
      expect(desc.length).toBeLessThanOrEqual(160);
      expect(attr(html, /<link rel="canonical" href="([^"]+)"/)).toBe(url);
      expect(html.match(/<h1[ >]/g)?.length).toBe(1); // 見出し1は 1 つだけ
      expect(html).toContain('<h2');
    }
  });

  it('英語と日本語が、互いを hreflang で指し合っている(x-default は英語のトップ)', () => {
    for (const html of [portal, ja]) {
      expect(html).toContain('hreflang="en" href="https://rivalines.com/"');
      expect(html).toContain('hreflang="ja" href="https://rivalines.com/ja.html"');
      expect(html).toContain('hreflang="x-default" href="https://rivalines.com/"');
    }
    expect(portal).toContain('<html lang="en">');
    expect(ja).toContain('<html lang="ja">');
  });

  it('構造化データ(JSON-LD)が正しい JSON で、ゲームの情報(無料・マルチプレイ)を持つ', () => {
    for (const html of [portal, ja]) {
      const json = attr(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/)!;
      const d = JSON.parse(json);
      expect(d['@type']).toBe('VideoGame');
      expect(d.name).toBe('Rivalines');
      expect(d.isAccessibleForFree).toBe(true);
      expect(d.playMode).toBe('MultiPlayer');
      expect(d.offers.price).toBe('0');
      expect(d.image).toMatch(/^https:\/\/rivalines\.com\/og\.png$/);
    }
  });

  it('robots.txt: 全体を許可し、API を除き、サイトマップを指す。サイトマップは、トップと日本語ページだけ', () => {
    const robots = read('public/robots.txt');
    expect(robots).toMatch(/^User-agent: \*/m);
    expect(robots).toMatch(/^Disallow: \/api\//m);
    expect(robots).toContain('Sitemap: https://rivalines.com/sitemap.xml');
    // 巡回を禁じたページには、noindex が読まれない。ゲームの画面は、巡回は許して、noindex の見出しで外す
    expect(robots).not.toMatch(/^Disallow: \/(live|next)\//m);
    const sitemap = read('public/sitemap.xml');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(['https://rivalines.com/', 'https://rivalines.com/ja.html']);
  });

  it('ゲーム本体(/live/ と /next/)は、検索結果に出さない(X-Robots-Tag: noindex)。トップには付けない', () => {
    const conf = read('deploy/nginx.gateway.conf');
    for (const env of ['live', 'next']) {
      const line = conf.split('\n').find((l) => l.includes(`location /${env}/ {`))!;
      expect(line, env).toContain('X-Robots-Tag "noindex"');
    }
    const top = conf.split('\n').find((l) => l.trimStart().startsWith('location / {'))!;
    expect(top).not.toContain('noindex');
  });

  it('トップの本文に、遊べること・特長(静的な文)があり、JavaScript なしでも検索エンジンが読める', () => {
    const body = portal.slice(portal.indexOf('<body>'));
    for (const w of ['multiplayer', 'roads', 'free', 'browser']) expect(body.toLowerCase()).toContain(w);
    expect(portal).toContain('<a href="./ja.html" hreflang="ja">');
    expect(ja).toContain('href="/?lang=ja"');
  });

  it('ゲームの名前以外の、他社のゲーム名・商標を、題・説明・本文に使っていない', () => {
    for (const html of [portal, ja]) expect(html).not.toMatch(/OpenTTD|Transport Tycoon|Simcity|Cities: Skylines|Mini Metro/i);
  });
});
