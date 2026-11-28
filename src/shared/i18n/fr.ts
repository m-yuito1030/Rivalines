import { type Catalog, type LangCode, Locale } from './locale';
import { En } from './en';
import { FR_CLIENT } from './fr/client';
import { FR_SERVER } from './fr/server';
import { FR_PANELS } from './fr/panels';
import { FR_RULES } from './fr/rules';
import { FR_UI } from './fr/ui';
import { FR_SOCIAL } from './fr/social';
import { FR_GOVERNMENT } from './fr/government';

/** Français. Les textes manquants (p. ex. les noms des designs d'installations) sont complétés par l'anglais, puis par le japonais */
export const FR: Catalog = { ...FR_UI, ...FR_RULES, ...FR_CLIENT, ...FR_SERVER, ...FR_PANELS, ...FR_SOCIAL, ...FR_GOVERNMENT };

export class Fr extends En {
  override readonly code: LangCode = 'fr';
  override readonly nativeName: string = 'Français';
  override readonly tag: string = 'fr-FR';

  protected override lookup(key: string): string | undefined {
    return FR[key] ?? super.lookup(key);
  }

  override compactMoney(n: number): string {
    return Locale.prototype.compactMoney.call(this, n);
  }

  override date(year: number, month: number, day: number, weekday: number): string {
    return `${this.t(`weekday.${weekday}`)} ${day} ${this.t(`month.${month}`)} ${year}`;
  }
}
