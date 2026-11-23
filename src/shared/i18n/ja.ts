import { type Catalog, type LangCode, Locale } from './locale';
import { JA_RULES } from './ja/rules';
import { JA_UI } from './ja/ui';

/** 日本語。すべての文を持つ基準の言語(ほかの言語は、足りない文を日本語で補う) */
export const JA: Catalog = { ...JA_UI, ...JA_RULES };

export class Ja extends Locale {
  readonly code: LangCode = 'ja';
  readonly nativeName: string = '日本語';
  readonly tag: string = 'ja-JP';

  protected override lookup(key: string): string | undefined {
    return JA[key] ?? super.lookup(key);
  }

  override compactMoney(n: number): string {
    return `${Math.round(n / 10000).toLocaleString('ja-JP')}万`;
  }

  override date(year: number, month: number, day: number, weekday: number): string {
    return `${year}年${month}月${day}日(${this.t(`weekday.${weekday}`)})`;
  }
}
