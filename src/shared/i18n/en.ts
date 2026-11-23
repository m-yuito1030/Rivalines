import { type Catalog, type LangCode, Locale } from './locale';
import { Ja } from './ja';
import { EN_CLIENT } from './en/client';
import { EN_SERVER } from './en/server';
import { EN_NAMES } from './en/names';
import { EN_RULES } from './en/rules';
import { EN_UI } from './en/ui';

/** 英語。訳した文だけを持ち、足りない文は日本語(継承元)で補う */
export const EN: Catalog = { ...EN_UI, ...EN_RULES, ...EN_CLIENT, ...EN_SERVER, ...EN_NAMES };

export class En extends Ja {
  override readonly code: LangCode = 'en';
  override readonly nativeName: string = 'English';
  override readonly tag: string = 'en-US';

  protected override lookup(key: string): string | undefined {
    return EN[key] ?? super.lookup(key);
  }

  override compactMoney(n: number): string {
    return Locale.prototype.compactMoney.call(this, n);
  }

  override date(year: number, month: number, day: number, weekday: number): string {
    return `${this.t(`weekday.${weekday}`)}, ${this.t(`month.${month}`)} ${day}, ${year}`;
  }
}
