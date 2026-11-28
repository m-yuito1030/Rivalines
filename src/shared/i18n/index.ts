import { type LangCode, Locale } from './locale';
import { Ja } from './ja';
import { En } from './en';
import { De } from './de';
import { Fr } from './fr';

export { type LangCode, Locale, type Params, format } from './locale';
export { Ja } from './ja';
export { En } from './en';
export { De } from './de';
export { Fr } from './fr';

/** 使える言語(言語の選択の並び順) */
export const LOCALES: Readonly<Record<LangCode, Locale>> = { ja: new Ja(), en: new En(), de: new De(), fr: new Fr() };
export const LANG_CODES = Object.keys(LOCALES) as LangCode[];
/** どれにも当てはまらないときの言語(世界向けなので英語) */
export const DEFAULT_LANG: LangCode = 'en';

export const isLangCode = (s: unknown): s is LangCode => typeof s === 'string' && s in LOCALES;

/**
 * 使う言語を決める。優先順位: 本人が選んだ言語 → ブラウザの言語設定(上から順に、対応している最初のもの) → 英語
 * @param saved 本人が選んで保存してある言語
 * @param preferred ブラウザの言語の一覧(navigator.languages など。'ja-JP' のような地域つきでもよい)
 */
export function detectLang(saved: string | null | undefined, preferred: readonly string[] = []): LangCode {
  if (isLangCode(saved)) return saved;
  for (const p of preferred) {
    const base = p.toLowerCase().split(/[-_]/)[0];
    if (isLangCode(base)) return base;
  }
  return DEFAULT_LANG;
}
