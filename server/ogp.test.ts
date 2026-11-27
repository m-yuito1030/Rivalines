import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const meta = (html: string, key: string): string | undefined => new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`).exec(html)?.[1];

describe('SNS に貼ったときのカード(OGP)', () => {
  for (const page of ['index.html', 'portal/index.html']) {
    it(`${page}: タイトル・説明・画像・カードの種類が入っていて、画像と URL は絶対 URL(https)`, () => {
      const html = read(page);
      expect(meta(html, 'og:title')).toMatch(/Rivalines/);
      expect(meta(html, 'og:description')!.length).toBeGreaterThan(40);
      expect(meta(html, 'description')!.length).toBeGreaterThan(40);
      expect(meta(html, 'og:type')).toBe('website');
      expect(meta(html, 'twitter:card')).toBe('summary_large_image');
      for (const k of ['og:url', 'og:image']) expect(meta(html, k), k).toMatch(/^https:\/\/[^/]+\//);
      expect(meta(html, 'og:image')).toMatch(/\/og\.png$/);
    });
  }

  it('og:image が指す画像が public にあり、PNG・1200x630・軽い(1MB 未満)。宣言した大きさと同じ', () => {
    const file = new URL('../public/og.png', import.meta.url);
    const buf = readFileSync(file);
    expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG の印
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    expect([w, h]).toEqual([1200, 630]);
    expect(statSync(file).size).toBeLessThan(1_000_000);
    const html = read('index.html');
    expect(Number(meta(html, 'og:image:width'))).toBe(w);
    expect(Number(meta(html, 'og:image:height'))).toBe(h);
  });

  it('正規の URL と og:url が同じ。公開用の名前(ドメイン)以外が混ざっていない', () => {
    const html = read('index.html');
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)![1];
    expect(meta(html, 'og:url')).toBe(canonical);
    expect(`${meta(html, 'og:image')}${canonical}`).not.toMatch(/localhost|127\.0\.0\.1|192\.168\./);
  });

  it('英語のカードの文言が、規約・ポリシーの方針と食い違わない(メールを求めない)', () => {
    expect(meta(read('index.html'), 'og:description')).toMatch(/no email needed/i);
    expect(read('public/privacy.en.html')).toContain('We do not ask for an email address');
  });
});
