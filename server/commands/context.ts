import type { Simulation } from '../../src/shared/sim/simulation';
import type { Route } from '../../src/shared/sim/network/transit';
import type { CmdResult } from '../../src/shared/protocol';
import { yen } from '../economyApi';
import { LOCALES, type LangCode, type Params } from '../../src/shared/i18n';
import { fail } from './util';

/**
 * Context for one command execution: who acted (`who`) plus shortcuts to the world and the company.
 * Each handler receives only this (it does not rely on globals or mutable shared variables).
 */
export class CommandContext {
  readonly map;
  readonly t;
  readonly co;

  constructor(
    readonly sim: Simulation,
    readonly who: number,
    /** Language of the acting player (messages are returned in it) */
    readonly lang: LangCode = 'ja',
  ) {
    this.map = sim.map;
    this.t = sim.transit;
    this.co = sim.playerCompany(who);
  }

  /** Translate a Japanese sentence into this player's language ({name} placeholders are filled from params) */
  tr = (ja: string, params?: Params): string => LOCALES[this.lang].tr(ja, params);

  /** Whether the tile holds a stop or depot (facilities cannot be placed there) */
  facOcc = (i: number): boolean => !!this.t.stopAtTile(i % this.map.size, Math.floor(i / this.map.size)) || !!this.t.depotAtTile(i % this.map.size, Math.floor(i / this.map.size));

  /** Pay construction costs and the like. If the player cannot pay, returns a failure result */
  charge = (cost: number, cat: string, what: string): CmdResult | null =>
    this.co.spend(cat, cost)
      ? null
      : fail(this.tr('資金が足りません({what} {cost} / 現金 {cash})。経営画面(F)で融資を受けられます', { what: this.tr(what), cost: yen(cost), cash: yen(this.co.cash) }));

  /** Whether the route is the player's own */
  mine = (r: Route | undefined): r is Route => !!r && r.owner === this.who;
}
