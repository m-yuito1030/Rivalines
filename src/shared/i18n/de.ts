import { type Catalog, type LangCode, Locale } from './locale';
import { En } from './en';
import { DE_CLIENT } from './de/client';
import { DE_SERVER } from './de/server';
import { DE_PANELS } from './de/panels';
import { DE_RULES } from './de/rules';
import { DE_UI } from './de/ui';
import { DE_SOCIAL } from './de/social';
import { DE_GOVERNMENT } from './de/government';

/** Deutsch. Fehlende Texte (z. B. die Namen der Anlagen-Designs) werden aus dem Englischen ergänzt, danach aus dem Japanischen */
export const DE: Catalog = { ...DE_UI, ...DE_RULES, ...DE_CLIENT, ...DE_SERVER, ...DE_PANELS, ...DE_SOCIAL, ...DE_GOVERNMENT };

export class De extends En {
  override readonly code: LangCode = 'de';
  override readonly nativeName: string = 'Deutsch';
  override readonly tag: string = 'de-DE';

  protected override lookup(key: string): string | undefined {
    return DE[key] ?? super.lookup(key);
  }

  override compactMoney(n: number): string {
    return Locale.prototype.compactMoney.call(this, n);
  }

  override date(year: number, month: number, day: number, weekday: number): string {
    return `${this.t(`weekday.${weekday}`)}, ${day}. ${this.t(`month.${month}`)} ${year}`;
  }
}
