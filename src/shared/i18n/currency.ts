import data from '../data/currencies.json';

/**
 * Display currency. The game always runs in yen (every price, income and cost is a yen amount). Only the way an amount is shown changes:
 * each player picks a currency in the settings, and amounts are converted with a fixed snapshot of exchange rates
 * (src/shared/data/currencies.json, refreshed by scripts/update-rates.mjs). Nothing is exchanged in the game, so there is no rate risk.
 */
export type CurrencyCode = string;

interface CurrencyInfo {
  symbol: string;
  decimals: number;
  /** How much of this currency one yen buys */
  rate: number;
  name: { ja: string; en: string };
}
const TABLE = data.currencies as Record<string, CurrencyInfo>;

export const DEFAULT_CURRENCY = 'JPY';
export const CURRENCY_CODES: readonly string[] = Object.keys(TABLE);
export const RATES_UPDATED_AT: string = data.updatedAt;
export const RATES_SOURCE: string = data.source;
export const isCurrencyCode = (s: unknown): s is CurrencyCode => typeof s === 'string' && Object.hasOwn(TABLE, s);
export const currencyName = (code: CurrencyCode, lang: 'ja' | 'en'): string => TABLE[code]?.name[lang] ?? code;
export const currencySymbol = (code: CurrencyCode): string => TABLE[code]?.symbol ?? '¥';
/** How much of the currency one yen buys */
export const rateOf = (code: CurrencyCode): number => TABLE[code]?.rate ?? 1;

/** The currency amounts are shown in right now (set by the screen from the player's choice; the server never sets it, so it stays yen there) */
let current: CurrencyCode = DEFAULT_CURRENCY;
export const getCurrency = (): CurrencyCode => current;
export function setCurrency(code: CurrencyCode): void {
  if (isCurrencyCode(code)) current = code;
}

const group = (n: number, decimals: number): string => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** The amount in yen → shown in the currency. Whole numbers from 1,000 up (and for currencies without decimals); small amounts keep their decimals */
export function formatMoney(yenAmount: number, code: CurrencyCode = current): string {
  const c = TABLE[code] ?? TABLE[DEFAULT_CURRENCY];
  const v = yenAmount * c.rate;
  const decimals = c.decimals === 0 || Math.abs(v) >= 1000 ? 0 : c.decimals;
  const rounded = Number(Math.abs(v).toFixed(decimals));
  return `${v < 0 && rounded !== 0 ? '-' : ''}${c.symbol}${group(rounded, decimals)}`;
}

/** Short amounts for narrow screens (1.2M, 12K). Yen are handled by the language (万 in Japanese), so this is for the other currencies */
export function formatCompactMoney(yenAmount: number, code: CurrencyCode = current): string {
  const c = TABLE[code] ?? TABLE[DEFAULT_CURRENCY];
  const v = yenAmount * c.rate;
  return `${v < 0 ? '-' : ''}${c.symbol}${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(v))}`;
}

/**
 * Messages the server returns contain amounts written in yen ("¥1,234,567"; the server does not know the player's currency).
 * The screen rewrites them into the player's currency just before showing them. Text without "¥" amounts is returned as it is.
 */
export function convertMoneyText(text: string, code: CurrencyCode = current): string {
  if (code === DEFAULT_CURRENCY || !text.includes('¥')) return text;
  return text.replace(/(-?)¥(\d[\d,]*)/g, (_m, neg: string, digits: string) => formatMoney((neg ? -1 : 1) * Number(digits.replace(/,/g, '')), code));
}

/** The currency usually used where a browser language is from (region first, then the language) */
const BY_REGION: Record<string, string> = {
  JP: 'JPY',
  US: 'USD',
  GB: 'GBP',
  CN: 'CNY',
  KR: 'KRW',
  TW: 'TWD',
  HK: 'HKD',
  SG: 'SGD',
  AU: 'AUD',
  CA: 'CAD',
  NZ: 'NZD',
  CH: 'CHF',
  IN: 'INR',
  BR: 'BRL',
  MX: 'MXN',
  TH: 'THB',
  VN: 'VND',
  ID: 'IDR',
  PH: 'PHP',
  MY: 'MYR',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  TR: 'TRY',
  ZA: 'ZAR',
  AE: 'AED',
  SA: 'SAR',
  IL: 'ILS',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  LU: 'EUR',
  SK: 'EUR',
  SI: 'EUR',
  EE: 'EUR',
  LV: 'EUR',
  LT: 'EUR',
  HR: 'EUR',
  MT: 'EUR',
  CY: 'EUR',
};
const BY_LANGUAGE: Record<string, string> = {
  ja: 'JPY',
  ko: 'KRW',
  zh: 'CNY',
  th: 'THB',
  vi: 'VND',
  id: 'IDR',
  ms: 'MYR',
  hi: 'INR',
  tr: 'TRY',
  pl: 'PLN',
  cs: 'CZK',
  hu: 'HUF',
  sv: 'SEK',
  nb: 'NOK',
  no: 'NOK',
  da: 'DKK',
  de: 'EUR',
  fr: 'EUR',
  it: 'EUR',
  es: 'EUR',
  nl: 'EUR',
  pt: 'EUR',
  fi: 'EUR',
  el: 'EUR',
  he: 'ILS',
  ar: 'AED',
};
export function detectCurrency(saved: unknown, preferred: readonly string[]): CurrencyCode {
  if (isCurrencyCode(saved)) return saved;
  for (const tag of preferred) {
    const [lang, region] = String(tag).replace('_', '-').split('-');
    const r = region?.toUpperCase();
    if (r && BY_REGION[r]) return BY_REGION[r];
    if (lang && BY_LANGUAGE[lang.toLowerCase()]) return BY_LANGUAGE[lang.toLowerCase()];
  }
  return 'USD';
}
