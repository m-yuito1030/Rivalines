/**
 * 多言語対応の土台。言語ごとに Locale の子クラスを作る(Ja → En のように、足りない文は継承元で補う)。
 *
 *   Locale  ── 文の取り出しと、{名前} の差し込み、数・金額・日付の書き方
 *     └ Ja  ── 日本語(すべての文を持つ基準)
 *         └ En ── 英語(訳した文だけ持つ。足りない文は、日本語で補う)
 *
 * 文は「キー」で呼ぶ: locale.t('menu.finance') / locale.t('msg.loan', { amount: '¥1,000,000' })
 * 新しい言語を足すには、Ja か En を継承したクラスを作って、lookup と number / date の書き方を書き換える。
 */
export type LangCode = 'ja' | 'en';
export type Params = Record<string, string | number>;
/** 文の一覧(キー → 文) */
export type Catalog = Readonly<Record<string, string>>;

/** 文の中の {名前} を、値に置き換える。値がなければ、そのまま残す(抜けに気づけるように) */
export function format(raw: string, params?: Params): string {
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export abstract class Locale {
  abstract readonly code: LangCode;
  /** その言語での、言語の名前(言語の選択に出す) */
  abstract readonly nativeName: string;
  /** <html lang> や Intl に使う BCP47 の名前 */
  abstract readonly tag: string;

  /** 文を探す。見つからなければ undefined(継承元に探しにいく) */
  protected lookup(_key: string): string | undefined {
    return undefined;
  }

  /** この言語(と継承元)に、そのキーの文があるか */
  has(key: string): boolean {
    return this.lookup(key) !== undefined;
  }

  /** キーの文を取り出し、{名前} を params で置き換える。どこにもなければ、キーをそのまま返す */
  t(key: string, params?: Params): string {
    const raw = this.lookup(key);
    return raw === undefined ? key : format(raw, params);
  }

  /**
   * 日本語の文(または言葉)を、この言語に訳す。プログラムの中の文・施設や車種の名前など、数が多いものはこちらで呼ぶ。
   * 訳がなければ、日本語のまま返す。{名前} は params で置き換える。訳は、カタログのキー `ja:日本語の文` に置く。
   */
  tr(ja: string, params?: Params): string {
    return format(this.lookup(`ja:${ja}`) ?? ja, params);
  }

  /** 個数で文が変わる言葉(英語の 1 item / 2 items など)。`キー.one` と `キー.other` を使い、なければ `キー` */
  tn(key: string, n: number, params?: Params): string {
    const k = n === 1 && this.has(`${key}.one`) ? `${key}.one` : this.has(`${key}.other`) ? `${key}.other` : key;
    return this.t(k, { n, ...params });
  }

  /** 数の書き方(3桁区切り) */
  number(n: number): string {
    return new Intl.NumberFormat(this.tag).format(Math.round(n));
  }

  /** 金額の書き方 */
  money(n: number): string {
    return `¥${this.number(n)}`;
  }

  /** 短い金額の書き方(狭い画面用) */
  compactMoney(n: number): string {
    return `¥${new Intl.NumberFormat(this.tag, { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;
  }

  /** 日付と曜日(曜日は、その言語の文から) */
  date(year: number, month: number, day: number, weekday: number): string {
    return `${year}/${month}/${day} (${this.t(`weekday.${weekday}`)})`;
  }
}
