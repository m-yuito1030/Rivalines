import { $, esc } from '../app/dom';
import { tr } from '../i18n';
import { calendarOf } from '../../shared/sim/world/calendar';
import { DAY_TICKS, START_TOD } from '../../shared/sim/network/types';
import type { TownNews } from '../../shared/world/districts';

/** The sentence for one piece of town news (made here, so it follows the player's language) */
export function newsText(n: TownNews): string {
  const p = { town: n.town, name: n.name ?? '', n: (n.n ?? 0).toLocaleString() };
  switch (n.kind) {
    case 'plan':
      return n.d === 'danchi'
        ? tr('{town}に、新しい団地「{name}」の建設が決まりました', p)
        : n.d === 'office'
          ? tr('{town}で、オフィス街「{name}」の再開発が決まりました', p)
          : tr('{town}で、商店街「{name}」の整備が決まりました', p);
    case 'start':
      return tr('{town}の「{name}」で、古い建物の取り壊しと建て替えが始まりました', p);
    case 'done':
      return n.d === 'danchi'
        ? tr('{town}の団地「{name}」が完成しました。同じ形の大きなアパートが並んでいます', p)
        : n.d === 'office'
          ? tr('{town}のオフィス街「{name}」が完成しました', p)
          : tr('{town}の商店街「{name}」が完成しました', p);
    default:
      return tr('{town}の人口が{n}人を超えました', p);
  }
}

/** The menu's "Town news": what the towns are planning, rebuilding, and finishing. Newest first */
export class TownNewsPanel {
  private lastId = -1;

  constructor(private readonly items: () => TownNews[]) {
    $('townNewsTitle').textContent = tr('🏙 街のニュース');
    $('menuBtn').addEventListener('click', () => this.update());
    this.update();
  }

  update(): void {
    const list = this.items();
    const top = list.length ? list[list.length - 1].id : 0;
    if (top === this.lastId) return;
    this.lastId = top;
    $('townNewsList').innerHTML = list.length
      ? [...list]
          .reverse()
          .map((n) => {
            const d = calendarOf(Math.floor((n.tick + START_TOD) / DAY_TICKS));
            return `<div class="nitem"><small>${esc(tr('{month}/{day}', { month: d.month, day: d.day }))}</small>${esc(newsText(n))}</div>`;
          })
          .join('')
      : `<div class="empty">${esc(tr('街のニュースはまだありません'))}</div>`;
  }
}
