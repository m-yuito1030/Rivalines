/**
 * The display language. Decided automatically from the browser's language settings, with the player's own choice taking priority (the choice is saved).
 * Fixed sentences on the screen are swapped per language via data-i18n / data-i18n-title / data-i18n-placeholder in index.html,
 * and sentences produced by the program via t('key').
 */
import { LANG_CODES, LOCALES, type LangCode, type Locale, type Params, detectLang, isLangCode } from '../shared/i18n';
import {
  CURRENCY_CODES,
  type CurrencyCode,
  RATES_SOURCE,
  RATES_UPDATED_AT,
  convertMoneyText,
  currencyName,
  detectCurrency,
  getCurrency,
  isCurrencyCode,
  setCurrency,
} from '../shared/i18n/currency';

const SAVED = 'rivalines-lang';

const read = (): string | null => {
  try {
    return new URLSearchParams(location.search).get('lang') ?? localStorage.getItem(SAVED);
  } catch {
    return null;
  }
};

let current: Locale = LOCALES[detectLang(read(), navigator.languages ?? [navigator.language])];
const listeners = new Set<(l: Locale) => void>();

export const locale = (): Locale => current;
export const lang = (): LangCode => current.code;

/** Get the sentence for a key in the current language */
export const t = (key: string, params?: Params): string => current.t(key, params);
/** Translate a Japanese sentence into the current language (stays Japanese if there is no translation) */
export const tr = (ja: string, params?: Params): string => current.tr(ja, params);
export const tn = (key: string, n: number, params?: Params): string => current.tn(key, n, params);
export const money = (n: number): string => current.money(n);
export const num = (n: number): string => current.number(n);

/** Register a function to call when the language changes (to rebuild dynamically created sentences) */
export function onLangChange(fn: (l: Locale) => void): void {
  listeners.add(fn);
}

/** Swap the fixed sentences in index.html for the current language */
export function applyDom(root: ParentNode = document): void {
  document.documentElement.lang = current.tag;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const text = current.t(el.dataset.i18n!);
    el.textContent = text;
    // If no tool is selected, a dropdown button goes back to showing this sentence (without the down arrow)
    if (el.dataset.def !== undefined) el.dataset.def = text.replace(/\s*▾$/, '');
  });
  // For languages other than Japanese, the terms and privacy policy open the English pages (add here when a language with a translation is added)
  root.querySelectorAll<HTMLAnchorElement>('a[data-legal]').forEach((a) => {
    const page = a.dataset.legal!;
    a.href = current.code === 'ja' ? `./${page}.html` : `./${page}.en.html`;
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = current.t(el.dataset.i18nTitle!)));
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => (el.placeholder = current.t(el.dataset.i18nPlaceholder!)));
}

/** Switch the language (save it, swap the screen, and notify the registered functions) */
export function setLang(code: string): void {
  if (!isLangCode(code) || code === current.code) return;
  current = LOCALES[code];
  try {
    localStorage.setItem(SAVED, code);
  } catch {
    /* Even if saving fails, it switches on this page */
  }
  applyDom();
  syncLangSelects();
  listeners.forEach((fn) => fn(current));
}

/** Fill the language selector (.lang-select) with the list of languages and wire it up to switching */
function syncLangSelects(): void {
  document.querySelectorAll<HTMLSelectElement>('select.lang-select').forEach((sel) => {
    if (!sel.options.length) {
      for (const c of LANG_CODES) {
        const op = document.createElement('option');
        op.value = c;
        op.textContent = LOCALES[c].nativeName;
        sel.appendChild(op);
      }
      sel.addEventListener('change', () => setLang(sel.value));
    }
    sel.value = current.code;
  });
}

// ---- Display currency (per player, per browser: the choice is saved like the language) ----
const CURRENCY_SAVED = 'rivalines-currency';
const currencyListeners = new Set<(code: CurrencyCode) => void>();

/** The currency amounts are shown in */
export const currency = (): CurrencyCode => getCurrency();
/** Rewrite the yen amounts in a message from the server ("¥1,234") into the chosen currency */
export const localizeMoney = (text: string): string => convertMoneyText(text);
/** Register a function to call when the currency changes (to redraw amounts that were built once) */
export function onCurrencyChange(fn: (code: CurrencyCode) => void): void {
  currencyListeners.add(fn);
}

/** Choose the display currency (saved, and every currency selector follows) */
export function setCurrencyChoice(code: string): void {
  if (!isCurrencyCode(code) || code === getCurrency()) return;
  setCurrency(code);
  try {
    localStorage.setItem(CURRENCY_SAVED, code);
  } catch {
    /* Even if saving fails, it switches on this page */
  }
  syncCurrencySelects();
  currencyListeners.forEach((fn) => fn(code));
}

/** Fill the currency selector (.currency-select) and its rate note, and wire it up to switching */
function syncCurrencySelects(): void {
  const names = (c: string) => `${c} — ${currencyName(c, current.code === 'ja' ? 'ja' : 'en')}`;
  document.querySelectorAll<HTMLSelectElement>('select.currency-select').forEach((sel) => {
    if (!sel.options.length) {
      for (const c of CURRENCY_CODES) {
        const op = document.createElement('option');
        op.value = c;
        sel.appendChild(op);
      }
      sel.addEventListener('change', () => setCurrencyChoice(sel.value));
    }
    for (const op of sel.options) op.textContent = names(op.value);
    sel.value = getCurrency();
  });
  document.querySelectorAll<HTMLElement>('.currency-note').forEach((el) => {
    el.textContent = current.tr('表示だけを換算します(ゲームの中は円で、為替の変動はありません)。レート: {date} 時点 / {source}', { date: RATES_UPDATED_AT, source: RATES_SOURCE });
  });
}

/** Call once at startup */
export function initI18n(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(CURRENCY_SAVED);
  } catch {
    /* No saved choice */
  }
  setCurrency(detectCurrency(saved, navigator.languages ?? [navigator.language]));
  applyDom();
  syncLangSelects();
  syncCurrencySelects();
  // The names (and the note) are in the current language, so redo them when the language changes
  listeners.add(() => syncCurrencySelects());
}
