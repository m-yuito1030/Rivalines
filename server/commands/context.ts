import type { Simulation } from '../../src/shared/sim/simulation';
import type { Route } from '../../src/shared/sim/network/transit';
import type { CmdResult } from '../../src/shared/protocol';
import { yen } from '../economyApi';
import { LOCALES, type LangCode, type Params } from '../../src/shared/i18n';
import { fail } from './util';

/**
 * コマンド1回の実行文脈: 誰の操作か(who)と、世界・会社への近道。
 * 各ハンドラはこれだけを受け取る(グローバルや書き換え用の変数に頼らない)。
 */
export class CommandContext {
  readonly map;
  readonly t;
  readonly co;

  constructor(
    readonly sim: Simulation,
    readonly who: number,
    /** この操作をしたプレイヤーの言語(メッセージをこの言語で返す) */
    readonly lang: LangCode = 'ja',
  ) {
    this.map = sim.map;
    this.t = sim.transit;
    this.co = sim.playerCompany(who);
  }

  /** 日本語の文を、このプレイヤーの言語に訳す({名前} は params で差し込む) */
  tr = (ja: string, params?: Params): string => LOCALES[this.lang].tr(ja, params);

  /** 停留所・車両基地のあるタイルか(施設を置けない) */
  facOcc = (i: number): boolean => !!this.t.stopAtTile(i % this.map.size, Math.floor(i / this.map.size)) || !!this.t.depotAtTile(i % this.map.size, Math.floor(i / this.map.size));

  /** 建設費などを払う。払えなければ失敗の結果を返す */
  charge = (cost: number, cat: string, what: string): CmdResult | null =>
    this.co.spend(cat, cost)
      ? null
      : fail(this.tr('資金が足りません({what} {cost} / 現金 {cash})。経営画面(F)で融資を受けられます', { what: this.tr(what), cost: yen(cost), cash: yen(this.co.cash) }));

  /** 自社の路線か */
  mine = (r: Route | undefined): r is Route => !!r && r.owner === this.who;
}
