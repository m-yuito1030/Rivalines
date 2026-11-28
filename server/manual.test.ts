import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AIRPORT_PRICES, LOAN_STEP, PRICES, START_CASH, TAX_RATE, TOLL, TRAINING, PAYOUT_OPTIONS } from '../src/shared/sim/economy/economy';
import { DEV } from '../src/shared/sim/economy/development';
import { PACT_DISCOUNTS } from '../src/shared/sim/economy/pacts';
import { AD_COOLDOWN_DAYS } from '../src/shared/sim/facility/facilityVisitors';
import { LISTING_DAYS } from '../src/shared/sim/facility/listings';
import { MAX_ROUTES_PER_PLAYER } from './commands/util';
import { AIRPORT_SIZES, airportFootprint, buildLayout } from '../src/shared/world/airportLayout';
import { CHAT_MAX_CHARS, CHAT_KEEP } from './chat';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ja = read('public/manual.html');
const en = read('public/manual.en.html');
const yen = (n: number) => `¥${n.toLocaleString('en-US')}`;
const ids = (html: string) => [...html.matchAll(/<h2 id="([a-z]+)">/g)].map((m) => m[1]);

describe('マニュアル(public/manual.html と manual.en.html)', () => {
  it('日本語版と英語版の章(h2 の id)が同じ並びで、目次のリンク先がすべてある', () => {
    expect(ids(ja)).toEqual(ids(en));
    expect(ids(ja).length).toBeGreaterThanOrEqual(15);
    for (const html of [ja, en]) {
      const links = [...html.matchAll(/<a href="#([a-z]+)">/g)].map((m) => m[1]);
      expect(links).toEqual(ids(html));
    }
  });

  it('題・説明・正規の URL・hreflang が互いに指し合っている。h1 は 1 つ', () => {
    expect(ja).toContain('<link rel="canonical" href="https://rivalines.com/manual.html">');
    expect(en).toContain('<link rel="canonical" href="https://rivalines.com/manual.en.html">');
    for (const html of [ja, en]) {
      expect(html).toContain('hreflang="en" href="https://rivalines.com/manual.en.html"');
      expect(html).toContain('hreflang="ja" href="https://rivalines.com/manual.html"');
      expect(html.match(/<h1[ >]/g)?.length).toBe(1);
      const desc = /<meta name="description" content="([^"]+)"/.exec(html)![1];
      expect(desc.length).toBeGreaterThan(60);
      expect(desc.length).toBeLessThanOrEqual(260);
    }
    expect(ja).toContain('href="./manual.en.html"');
    expect(en).toContain('href="./manual.html"');
  });

  it('費用の表が、実際のゲームの値と同じ(値を変えたら、マニュアルも直す)', () => {
    for (const html of [ja, en]) {
      for (const n of [
        PRICES.road,
        PRICES.rail,
        PRICES.bridge,
        PRICES.tunnel,
        PRICES.stop,
        PRICES.stationBase,
        PRICES.stationTile,
        PRICES.waypoint,
        PRICES.signal,
        PRICES.depotRoad,
        PRICES.depotRail,
        PRICES.depotAir,
        PRICES.terraform,
        ...Object.values(AIRPORT_PRICES),
        START_CASH,
        TOLL.rail,
        TOLL.road,
      ]) {
        expect(html, yen(n)).toContain(yen(n));
      }
    }
  });

  it('決まりの数字が、実際の値と同じ(法人税・研修・開発・広告・売り出し・提携・配当・路線数・チャット)', () => {
    for (const html of [ja, en]) {
      expect(html).toContain(`${Math.round(TAX_RATE * 100)}%`);
      expect(html).toContain(`${Math.round(TRAINING.costCut * 100)}%`);
      expect(html).toContain(`${Math.round(TRAINING.demandUp * 100)}%`);
      expect(html).toContain(`${Math.round(DEV.demandUp * 100)}%`);
      expect(html).toContain(`${TRAINING.max}`);
      expect(html).toContain(`${DEV.max}`);
      expect(html).toContain(String(AD_COOLDOWN_DAYS));
      expect(html).toContain(String(LISTING_DAYS));
      expect(html).toContain(String(MAX_ROUTES_PER_PLAYER));
      expect(html).toContain(String(CHAT_MAX_CHARS));
      expect(html).toContain(String(CHAT_KEEP));
      for (const d of PACT_DISCOUNTS) expect(html).toContain(`${Math.round(d * 100)}%`);
      for (const p of PAYOUT_OPTIONS) expect(html).toContain(`${Math.round(p * 100)}%`);
    }
    // 借入のボタンは、100万・500万・2000万円(画面の値と同じ)
    expect(LOAN_STEP).toBe(1_000_000);
    expect(en).toContain(yen(1 * LOAN_STEP));
    expect(en).toContain(yen(5 * LOAN_STEP));
    expect(en).toContain(yen(20 * LOAN_STEP));
    expect(ja).toContain('2,000万円');
  });

  it('ツールバーの道具の名前が、画面の表示(英語・日本語のカタログ)と同じ', () => {
    const jaUi = read('src/shared/i18n/ja/ui.ts');
    const enUi = read('src/shared/i18n/en/ui.ts');
    for (const [html, ui, names] of [
      [ja, jaUi, ['バス停 (B)', '車両基地', '線路を自動敷設', '信号を並べる', '経営 (F)', '不動産物件', '入札・独占権', '経営分析', '統計 (I)', 'ランキング', 'ダイヤ']],
      [
        en,
        enUi,
        ['Bus stop (B)', 'Depot', 'Auto-lay track', 'Signal line', 'Finance (F)', 'Real estate', 'Bids & monopolies', 'Analysis', 'Statistics (I)', 'Rankings', 'Timetable'],
      ],
    ] as const) {
      for (const n of names) {
        expect(ui, `画面の表示にない: ${n}`).toContain(n);
        expect(html.replace(/&amp;/g, '&'), `マニュアルにない: ${n}`).toContain(n);
      }
    }
  });

  it('メニュー・入口・紹介ページ・サイトマップから、マニュアルへ行ける。他社のゲーム名・商標がない', () => {
    expect(read('index.html')).toContain('data-legal="manual"');
    expect(read('portal/index.html')).toContain('data-legal="manual"');
    expect(read('public/ja.html')).toContain('./manual.html');
    const sitemap = read('public/sitemap.xml');
    expect(sitemap).toContain('<loc>https://rivalines.com/manual.html</loc>');
    expect(sitemap).toContain('<loc>https://rivalines.com/manual.en.html</loc>');
    for (const html of [ja, en]) expect(html).not.toMatch(/OpenTTD|Transport Tycoon|Simcity|Cities: Skylines|Mini Metro/i);
  });

  it('空港の表が、実際のレイアウトと同じ(大きさ・滑走路・駐機場・使える機体)', () => {
    const rows: Record<string, [string, string]> = { S: ['小', 'Small'], M: ['中', 'Medium'], L: ['大', 'Large'], H: ['ハブ', 'Hub'] };
    for (const size of AIRPORT_SIZES) {
      const { w, h } = airportFootprint(size, 'x');
      const lay = buildLayout(size, 'x');
      for (const [html, label] of [
        [ja, rows[size][0]],
        [en, rows[size][1]],
      ] as const) {
        const tr = new RegExp(`<tr><td>${label}</td><td>${w}×${h}</td><td>${lay.runways}</td><td>${lay.stands}</td>`);
        expect(html, `${size}: ${label}`).toMatch(tr);
        expect(html).toContain(yen(AIRPORT_PRICES[size]));
      }
    }
  });
});
