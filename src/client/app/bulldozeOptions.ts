import type { BulldozeKinds } from '../../shared/protocol';
import { $ } from './dom';

/** 撤去ツールのオプション: どの要素(道路・線路・信号・駅…)を撤去するかのチェックボックス */
export class BulldozeOptions {
  private readonly el = $('bulldozeOpts');

  constructor() {
    document.querySelectorAll<HTMLButtonElement>('#bulldozeOpts [data-bkset]').forEach((b) =>
      b.addEventListener('click', () => {
        const only = b.dataset.bkset!; // all / none / 要素名(その要素だけ)
        document
          .querySelectorAll<HTMLInputElement>('#bulldozeOpts [data-bk]')
          .forEach(
            (el) =>
              (el.checked =
                only === 'all' ? ['road', 'rail', 'signal', 'stop', 'depot', 'waypoint', 'span'].includes(el.dataset.bk!) : only === 'none' ? false : el.dataset.bk === only),
          );
      }),
    );
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on;
  }

  /** いま選ばれている撤去の対象 */
  kinds(): BulldozeKinds {
    const k = {} as Record<string, boolean>;
    document.querySelectorAll<HTMLInputElement>('#bulldozeOpts [data-bk]').forEach((el) => (k[el.dataset.bk!] = el.checked));
    return k as unknown as BulldozeKinds;
  }
}
