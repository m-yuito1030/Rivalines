/**
 * The display language. Decided automatically from the browser's language settings, with the player's own choice taking priority (the choice is saved).
 * Fixed sentences on the screen are swapped per language via data-i18n / data-i18n-title / data-i18n-placeholder in index.html,
 * and sentences produced by the program via t('key').
 */
import { LANG_CODES, LOCALES, type LangCode, type Locale, type Params, detectLang, isLangCode } from '../shared/i18n';

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

/** Call once at startup */
export function initI18n(): void {
  applyDom();
  syncLangSelects();
}
