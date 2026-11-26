/**
 * 画面の言語。ブラウザの言語設定から自動で決め、本人が選んだ言語を優先する(選んだ言語は保存される)。
 * 画面の固定の文は index.html の data-i18n / data-i18n-title / data-i18n-placeholder で、
 * プログラムで出す文は t('キー') で、言語ごとの文に差し替える。
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

/** 現在の言語で、キーの文を取り出す */
export const t = (key: string, params?: Params): string => current.t(key, params);
/** 日本語の文を、現在の言語に訳す(訳がなければ日本語のまま) */
export const tr = (ja: string, params?: Params): string => current.tr(ja, params);
export const tn = (key: string, n: number, params?: Params): string => current.tn(key, n, params);
export const money = (n: number): string => current.money(n);
export const num = (n: number): string => current.number(n);

/** 言語が変わったときに呼ばれる関数を登録する(動的に作った文を、作り直すため) */
export function onLangChange(fn: (l: Locale) => void): void {
  listeners.add(fn);
}

/** index.html の固定の文を、現在の言語に差し替える */
export function applyDom(root: ParentNode = document): void {
  document.documentElement.lang = current.tag;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const text = current.t(el.dataset.i18n!);
    el.textContent = text;
    // ドロップダウンのボタンは、選んだ道具がなければ、この文(▾を除く)を表示に戻す
    if (el.dataset.def !== undefined) el.dataset.def = text.replace(/\s*▾$/, '');
  });
  // 利用規約・プライバシーポリシーは、日本語以外では英語のページを開く(訳がある言語を足したら、ここを増やす)
  root.querySelectorAll<HTMLAnchorElement>('a[data-legal]').forEach((a) => {
    const page = a.dataset.legal!;
    a.href = current.code === 'ja' ? `./${page}.html` : `./${page}.en.html`;
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = current.t(el.dataset.i18nTitle!)));
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => (el.placeholder = current.t(el.dataset.i18nPlaceholder!)));
}

/** 言語を切り替える(保存し、画面を差し替え、登録された関数に知らせる) */
export function setLang(code: string): void {
  if (!isLangCode(code) || code === current.code) return;
  current = LOCALES[code];
  try {
    localStorage.setItem(SAVED, code);
  } catch {
    /* 保存できなくても、このページでは切り替わる */
  }
  applyDom();
  syncLangSelects();
  listeners.forEach((fn) => fn(current));
}

/** 言語の選択欄(.lang-select)に、言語の一覧を入れて、切り替えに結びつける */
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

/** 起動時に1回呼ぶ */
export function initI18n(): void {
  applyDom();
  syncLangSelects();
}
