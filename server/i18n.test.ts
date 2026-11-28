import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LANG, En, Ja, LOCALES, detectLang, format } from '../src/shared/i18n/index';
import { JA } from '../src/shared/i18n/ja';
import { EN } from '../src/shared/i18n/en';
import { DE } from '../src/shared/i18n/de';
import { FR } from '../src/shared/i18n/fr';

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
    expect(detectLang(null, ['es-ES', 'en-GB', 'ja'])).toBe('en'); // 対応していない言語は飛ばして、次の言語を見る
    expect(detectLang(null, ['de-DE', 'en'])).toBe('de');
    expect(detectLang(null, ['fr-CA'])).toBe('fr');
    expect(detectLang(null, ['it', 'es'])).toBe(DEFAULT_LANG);
    expect(detectLang(undefined, ['ja_JP'])).toBe('ja');
    expect(detectLang(null, ['es-ES', 'it'])).toBe(DEFAULT_LANG);
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
  it("プログラムの tr('日本語') は、すべて英語に訳してある(画面・サーバーの返事)", () => {
    const files = [
      ...walk(join(ROOT, 'src', 'client')),
      ...walk(join(ROOT, 'src', 'shared')).filter((f) => !f.includes('/i18n/')),
      ...walk(join(ROOT, 'server', 'commands')),
      join(ROOT, 'server', 'index.ts'),
    ];
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\btr\(\s*(?:[\w.]+ \? )?'((?:[^'\\]|\\.)*)'(?: : '((?:[^'\\]|\\.)*)')?/g)) {
        for (const ja of [m[1], m[2]]) if (ja && !(`ja:${ja}` in EN)) missing.push(`${f.replace(ROOT, '')}: ${ja}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('英訳の {名前} は、日本語の文と同じ(差し込みの取りこぼしがない)', () => {
    const names = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    for (const [k, v] of Object.entries(EN)) if (k.startsWith('ja:')) expect(names(v), k).toBe(names(k.slice(3)));
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

describe('サーバーの返事は、接続した言語で返る', () => {
  it('英語なら英語、日本語なら日本語でエラーを返す', async () => {
    const { execute } = await import('./commands');
    const { Simulation } = await import('../src/shared/sim/simulation');
    const { GameMap } = await import('../src/shared/world/gameMap');
    const sim = new Simulation(new GameMap(64, 1, new Uint8Array(64 * 64).fill(20)), undefined, { multi: true });
    const bad = { t: 'nope' } as never;
    expect(execute(sim, 1, bad, 'en').msg).toBe('Invalid action.');
    expect(execute(sim, 1, bad, 'ja').msg).toBe('不正な操作です');
  });
});

describe('ドイツ語・フランス語', () => {
  const names = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
  for (const [label, cat, code] of [
    ['ドイツ語', DE, 'de'],
    ['フランス語', FR, 'fr'],
  ] as const) {
    it(`${label}: 英語を継承し、訳がない文は英語→日本語で補う。日付の書き方が違う`, () => {
      const l = LOCALES[code];
      expect(l).toBeInstanceOf(En);
      expect(l.code).toBe(code);
      expect(l.t('ui.go')).not.toBe(EN['ui.go']);
      expect(l.tr('ビジネスホテル(細長)')).toBe(EN['ja:ビジネスホテル(細長)']); // 施設のデザイン名は英語で補う
      expect(l.tr('訳のない文')).toBe('訳のない文');
      expect(l.date(2026, 4, 1, 3)).toMatch(/2026/);
      expect(l.date(2026, 4, 1, 3)).not.toBe(LOCALES.en.date(2026, 4, 1, 3));
    });
    it(`${label}: 差し込み {名前} が日本語の文と同じで、キーに typo がなく、空の訳がない`, () => {
      for (const [k, v] of Object.entries(cat)) {
        if (k.startsWith('ja:')) {
          expect(names(v), k).toBe(names(k.slice(3)));
          // 英語に同じ文のキーがあること(日本語の文を直したのに、こちらを直し忘れたときに気づく)
          expect(k in EN, `英語にないキー: ${k}`).toBe(true);
        } else expect(JA[k], `日本語にないキー: ${k}`).toBeDefined();
        if (!['ja:本', 'ja:人', 'ja:台'].includes(k)) expect(v.trim().length, k).toBeGreaterThan(0);
      }
    });
    it(`${label}: 画面(index.html)の固定の文は、すべて訳してある`, () => {
      const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
      const keys = new Set([...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1]));
      const missing = [...keys].filter((k) => !(k in cat));
      expect(missing, `訳がない(英語で出ます): ${missing.join(', ')}`).toEqual([]);
    });
    it(`${label}: 英語に訳してある文は、施設・駅のデザイン名を除いて、すべて${label}にも訳してある(新しい文を足したときの訳し忘れの検出)`, async () => {
      const { EN_NAMES } = await import('../src/shared/i18n/en/names');
      const missing = Object.keys(EN).filter((k) => !(k in cat) && !(k in EN_NAMES));
      expect(missing).toEqual([]);
    });
  }
});
