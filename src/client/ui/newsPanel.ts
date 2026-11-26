import { BASE } from '../connection/net';
import { $, esc } from '../app/dom';
import { tr } from '../i18n';

const SEEN_KEY = 'rivalines-news-seen';
const REFRESH_MS = 10 * 60 * 1000;

interface Item {
  id: number;
  at: number;
  title: string;
  body: string;
}

/** メニューの「お知らせ」。運営が出したものを一覧で見られる。まだ見ていないものがあれば、メニューに赤い点を出す */
export class NewsPanel {
  private items: Item[] = [];

  constructor() {
    $('newsTitle').textContent = tr('📢 お知らせ');
    $('menuBtn').addEventListener('click', () => {
      this.render();
      this.markSeen();
      void this.refresh();
    });
    void this.refresh();
    window.setInterval(() => void this.refresh(), REFRESH_MS);
  }

  get hasUnread(): boolean {
    const seen = Number(localStorage.getItem(SEEN_KEY) ?? 0);
    return this.items.some((i) => i.id > seen);
  }

  async refresh(): Promise<void> {
    try {
      const r = await fetch(`${BASE}api/announcements`, { cache: 'no-store' });
      const j = (await r.json()) as { ok?: boolean; list?: Item[] };
      if (!j.list) return;
      this.items = j.list;
      this.render();
      if (!$('menu').hidden) this.markSeen();
      document.dispatchEvent(new CustomEvent('rivalines:unread'));
    } catch {
      /* 取れなくても、ゲームには影響しない */
    }
  }

  private markSeen(): void {
    const top = Math.max(0, ...this.items.map((i) => i.id));
    localStorage.setItem(SEEN_KEY, String(top));
    document.dispatchEvent(new CustomEvent('rivalines:unread'));
  }

  private render(): void {
    $('newsList').innerHTML = this.items.length
      ? this.items.map((i) => `<div class="nitem"><b>${esc(i.title)}</b><small>${new Date(i.at).toLocaleDateString()}</small><div>${esc(i.body)}</div></div>`).join('')
      : `<div class="empty">${esc(tr('お知らせはありません'))}</div>`;
  }
}
