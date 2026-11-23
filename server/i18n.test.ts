import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LANG, En, Ja, LOCALES, detectLang, format } from '../src/shared/i18n/index';
import { JA } from '../src/shared/i18n/ja';
import { EN } from '../src/shared/i18n/en';

const ROOT = join(__dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });

describe('言語の決め方', () => {
  it('本人が選んだ言語が最優先。なければブラウザの言語の順。どれにも当てはまらなければ英語', () => {
    expect(detectLang('en', ['ja-JP'])).toBe('en');
    expect(detectLang(null, ['ja-JP', 'en-US'])).toBe('ja');
    expect(detectLang(null, ['fr-FR', 'en-GB', 'ja'])).toBe('en'); // 対応していない言語は飛ばして、次の言語を見る
    expect(detectLang(undefined, ['ja_JP'])).toBe('ja');
    expect(detectLang(null, ['fr-FR', 'de'])).toBe(DEFAULT_LANG);
    expect(detectLang('xx', [])).toBe(DEFAULT_LANG);
    expect(detectLang('', [])).toBe(DEFAULT_LANG);
  });
});

describe('言語のクラス(Locale → Ja → En)', () => {
  it('英語は日本語を継承し、訳がない文は日本語で補う。キーも訳もなければ、キーをそのまま返す', () => {
    const ja = new Ja();
    const en = new En();
    expect(en).toBeInstanceOf(Ja);
    expect(ja.t('ui.go')).toBe('ログイン');
    expect(en.t('ui.go')).toBe('Log in');
    expect(en.tr('試合')).toBe('Match');
    expect(ja.tr('試合')).toBe('試合');
    expect(en.tr('訳のない文')).toBe('訳のない文'); // 訳がなければ日本語のまま
    expect(en.t('no.such.key')).toBe('no.such.key');
    expect(LOCALES.en.code).toBe('en');
  });
  it('{名前} を差し込み、足りない値はそのまま残す', () => {
    expect(format('{a} と {b}', { a: 1 })).toBe('1 と {b}');
    expect(LOCALES.en.tr('🏆 {rank}位/{total}社', { rank: 3, total: 21 })).toBe('🏆 #3 of 21');
    expect(LOCALES.ja.tr('🏆 {rank}位/{total}社', { rank: 3, total: 21 })).toBe('🏆 3位/21社');
  });
  it('日付・金額・数の書き方が言語ごとに違う', () => {
    expect(LOCALES.ja.date(2026, 4, 1, 3)).toBe('2026年4月1日(水)');
    expect(LOCALES.en.date(2026, 4, 1, 3)).toBe('Wed, Apr 1, 2026');
    expect(LOCALES.ja.money(1234567)).toBe('¥1,234,567');
    expect(LOCALES.en.money(1234567)).toBe('¥1,234,567');
    expect(LOCALES.ja.compactMoney(20000000)).toBe('2,000万');
    expect(LOCALES.en.compactMoney(20000000)).toBe('¥20M');
  });
});

describe('訳の抜けがない', () => {
  it('index.html の data-i18n のキーは、日本語にも英語にもある', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const keys = [...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(100);
    for (const k of new Set(keys)) {
      expect(JA[k], `日本語がない: ${k}`).toBeTruthy();
      expect(EN[k], `英語がない: ${k}`).toBeTruthy();
    }
  });
  it('日本語のカタログの文は、HTML の元の文と同じ(キーと文の取り違えがない)', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    for (const m of html.matchAll(/data-i18n-title="([^"]+)"/g)) {
      const k = m[1];
      expect(html).toContain(`title="${JA[k]}"`);
    }
  });
  it("プログラムの tr('日本語') は、すべて英語に訳してある(クライアントの画面の部分)", () => {
    const files = [...walk(join(ROOT, 'src', 'client')), ...walk(join(ROOT, 'src', 'shared')).filter((f) => !f.includes('/i18n/'))];
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\btr\(\s*(?:[\w.]+ \? )?'((?:[^'\\]|\\.)*)'(?: : '((?:[^'\\]|\\.)*)')?/g)) {
        for (const ja of [m[1], m[2]]) if (ja && !(`ja:${ja}` in EN)) missing.push(`${f.replace(ROOT, '')}: ${ja}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('英語のカタログに、日本語のキーがないものが混ざっていない(typo の検出)', () => {
    for (const k of Object.keys(EN)) if (!k.startsWith('ja:')) expect(JA[k], `日本語にない英語のキー: ${k}`).toBeDefined();
  });
  it('施設・駅のデザイン名は、すべて英訳がある', async () => {
    const sheets = (await import('../src/shared/data/facilitySprites.json')).default as Record<string, { names: string[] }>;
    const kit = (await import('../src/shared/data/stationKit.json')).default;
    for (const v of Object.values(sheets)) for (const n of v.names) expect(EN[`ja:${n}`], n).toBeTruthy();
    for (const s of kit.styles) expect(EN[`ja:${s.name}`], s.name).toBeTruthy();
  });
});
