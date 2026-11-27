import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CURRENCY_CODES,
  RATES_UPDATED_AT,
  convertMoneyText,
  currencyName,
  detectCurrency,
  formatCompactMoney,
  formatMoney,
  getCurrency,
  isCurrencyCode,
  rateOf,
  setCurrency,
} from '../src/shared/i18n/currency';
import { yen } from '../src/shared/sim/economy/economy';
import { LOCALES } from '../src/shared/i18n';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

beforeEach(() => setCurrency('JPY'));

describe('表示の通貨', () => {
  it('既定は円。いままでの書き方(¥1,234 / -¥500)のまま。サーバー側は、ずっと円', () => {
    expect(getCurrency()).toBe('JPY');
    expect(yen(1234567)).toBe('¥1,234,567');
    expect(yen(-500)).toBe('-¥500');
    expect(yen(0)).toBe('¥0');
    expect(yen(1234.6)).toBe('¥1,235');
  });

  it('通貨を変えると、yen() も Locale.money() も、その通貨で表示する(ゲームの中の値は円のまま)', () => {
    setCurrency('USD');
    const usd = 10_000_000 * rateOf('USD');
    expect(yen(10_000_000)).toBe('$' + Math.round(usd).toLocaleString('en-US'));
    expect(LOCALES.en.money(10_000_000)).toBe(yen(10_000_000));
    expect(LOCALES.ja.money(10_000_000)).toBe(yen(10_000_000));
    setCurrency('EUR');
    expect(yen(10_000_000).startsWith('€')).toBe(true);
    setCurrency('JPY');
    expect(yen(10_000_000)).toBe('¥10,000,000');
  });

  it('小さい金額は小数を残し(¥50 → $0.31)、1,000 以上は整数。小数のない通貨(円・ウォン・ドン)は常に整数。負の数は先頭に - を付ける', () => {
    expect(formatMoney(50, 'USD')).toMatch(/^\$0\.\d{2}$/);
    expect(formatMoney(300, 'USD')).toMatch(/^\$\d\.\d{2}$/);
    expect(formatMoney(1_000_000, 'USD')).toMatch(/^\$[\d,]+$/);
    expect(formatMoney(1_000_000, 'KRW')).toMatch(/^₩[\d,]+$/);
    expect(formatMoney(1_000_000, 'VND')).toMatch(/^₫[\d,]+$/);
    expect(formatMoney(-1_000_000, 'USD').startsWith('-$')).toBe(true);
    expect(formatMoney(0, 'USD')).toBe('$0.00');
    expect(formatMoney(0.0001, 'USD').startsWith('-')).toBe(false);
    expect(formatMoney(-0.0001, 'USD')).toBe('$0.00'); // rounding to zero never shows "-$0.00"
  });

  it('レートの表(通貨ごとの、1 円で買える量)は、すべて正の数で、円は 1。日付がある。名前は日本語と英語', () => {
    expect(CURRENCY_CODES.length).toBeGreaterThanOrEqual(20);
    expect(CURRENCY_CODES).toContain('JPY');
    expect(CURRENCY_CODES).toContain('USD');
    expect(rateOf('JPY')).toBe(1);
    for (const c of CURRENCY_CODES) {
      expect(rateOf(c), c).toBeGreaterThan(0);
      expect(currencyName(c, 'ja').length, c).toBeGreaterThan(0);
      expect(currencyName(c, 'en').length, c).toBeGreaterThan(0);
    }
    expect(RATES_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The dollar is worth more than a yen, and the won / dong less (a sanity check against a swapped table)
    expect(rateOf('USD')).toBeLessThan(0.05);
    expect(rateOf('KRW')).toBeGreaterThan(1);
    expect(rateOf('VND')).toBeGreaterThan(rateOf('KRW'));
  });

  it('サーバーが円で書いた金額を、選んだ通貨に書き換える(円のときと、¥ のない文は、そのまま)', () => {
    const msg = '建設しました(¥1,500,000)。残り -¥300 と ¥50 です';
    expect(convertMoneyText(msg, 'JPY')).toBe(msg);
    expect(convertMoneyText('金額はありません', 'USD')).toBe('金額はありません');
    const out = convertMoneyText(msg, 'USD');
    expect(out).not.toContain('¥');
    expect(out).toContain(formatMoney(1_500_000, 'USD'));
    expect(out).toContain(formatMoney(-300, 'USD'));
    expect(out).toContain(formatMoney(50, 'USD'));
    expect(convertMoneyText('Not enough funds (cash ¥2,000,000).', 'EUR')).toBe('Not enough funds (cash ' + formatMoney(2_000_000, 'EUR') + ').');
  });

  it('ブラウザの言語から、既定の通貨を決める(保存した選択が先)', () => {
    expect(detectCurrency('EUR', ['ja-JP'])).toBe('EUR');
    expect(detectCurrency(null, ['ja-JP', 'en-US'])).toBe('JPY');
    expect(detectCurrency(null, ['en-US'])).toBe('USD');
    expect(detectCurrency(null, ['en-GB'])).toBe('GBP');
    expect(detectCurrency(null, ['de-DE'])).toBe('EUR');
    expect(detectCurrency(null, ['de'])).toBe('EUR');
    expect(detectCurrency(null, ['ko-KR'])).toBe('KRW');
    expect(detectCurrency(null, ['zh-TW'])).toBe('TWD');
    expect(detectCurrency(null, ['pt-BR'])).toBe('BRL');
    expect(detectCurrency(null, ['xx-YY'])).toBe('USD'); // unknown → dollars
    expect(detectCurrency('NOPE', [])).toBe('USD');
    expect(isCurrencyCode('JPY')).toBe(true);
    expect(isCurrencyCode('jpy')).toBe(false);
    expect(isCurrencyCode('__proto__')).toBe(false);
  });

  it('短い書き方: 円は日本語で万、そのほかの通貨は K / M', () => {
    expect(LOCALES.ja.compactMoney(20_000_000)).toBe('2,000万');
    setCurrency('USD');
    expect(LOCALES.ja.compactMoney(20_000_000)).toBe(formatCompactMoney(20_000_000, 'USD'));
    expect(LOCALES.en.compactMoney(20_000_000)).toMatch(/^\$[\d.]+[KM]$/);
  });

  it('画面に、通貨の選択欄・為替の出典の欄があり、設定の文が英訳されている', () => {
    const html = read('index.html');
    expect(html).toContain('class="currency-select"');
    expect(html).toContain('currency-note');
    expect(read('src/shared/i18n/en/ui.ts')).toContain("'ui.currency'");
    expect(read('src/shared/i18n/ja/ui.ts')).toContain("'ui.currency'");
    // The script that refreshes the rates exists, and the rate table says where it came from
    expect(read('scripts/update-rates.mjs')).toContain('open.er-api.com');
    expect(read('src/shared/data/currencies.json')).toContain('exchangerate-api.com');
  });
});
