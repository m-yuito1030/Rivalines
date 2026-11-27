import type { BulldozeKinds } from '../../shared/protocol';
import { $ } from './dom';

/** Demolish tool options: checkboxes for which elements (roads, rails, signals, stations, ...) to demolish */
export class BulldozeOptions {
  private readonly el = $('bulldozeOpts');

  constructor() {
    document.querySelectorAll<HTMLButtonElement>('#bulldozeOpts [data-bkset]').forEach((b) =>
      b.addEventListener('click', () => {
        const only = b.dataset.bkset!; // all / none / an element name (just that element)
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

  /** The demolition targets currently selected */
  kinds(): BulldozeKinds {
    const k = {} as Record<string, boolean>;
    document.querySelectorAll<HTMLInputElement>('#bulldozeOpts [data-bk]').forEach((el) => (k[el.dataset.bk!] = el.checked));
    return k as unknown as BulldozeKinds;
  }
}
