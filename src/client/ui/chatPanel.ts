import './chat.css';
import type { ChatMsg } from '../../shared/protocol';
import { net } from '../connection/net';
import { $, esc } from '../app/dom';
import { tr } from '../i18n';

const HIDDEN_KEY = 'rivalines-chat-hidden';
const KEEP = 100;
const clock = (at: number) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 全体チャット。窓は開閉でき、閉じている間に届いた発言は、メニューの印(赤い点)で知らせる */
export class ChatPanel {
  private readonly el = $('chat');
  private readonly logEl = $('chatLog');
  private readonly input = $<HTMLInputElement>('chatInput');
  private list: ChatMsg[] = [];
  private hidden = new Set<number>(this.loadHidden());
  private unread = false;

  constructor(
    private readonly notify: (msg: string) => void,
    private readonly beforeOpen: () => void,
  ) {
    $('chatBtn').textContent = tr('💬 チャット');
    $('chatTitle').textContent = tr('チャット');
    $('chatSend').textContent = tr('送信');
    this.input.placeholder = tr('発言する(100文字まで)');
    $('chatFoot').textContent = tr('非表示にした人の発言は出ません');
    $('chatBtn').addEventListener('click', () => this.toggle());
    $('chatClose').addEventListener('click', () => this.close());
    $('chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.input.value = '';
      void net.chat(text).then((r) => {
        if (!r.ok) {
          this.input.value = text; // 送れなかった文は、入力欄に戻す
          this.notify(r.msg ?? tr('失敗しました'));
        }
      });
    });
    this.logEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ca]');
      if (!b) return;
      const m = this.list.find((x) => x.id === Number(b.dataset.id));
      if (!m) return;
      if (b.dataset.ca === 'report') {
        void net.report(m.from, tr('チャット: 「{text}」', { text: m.text })).then((r) => this.notify(r.msg ?? (r.ok ? tr('通報しました') : tr('失敗しました'))));
      } else {
        this.hidden.add(m.from);
        this.saveHidden();
        this.render();
      }
    });
    // 入力中の文字(W・A・S・D・F・I など)を、ゲームのキー操作として受け取らない
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
    net.setChatHandler((m) => {
      if (m.type === 'chatlog') this.list = m.list.slice(-KEEP);
      else {
        this.list.push(m.msg);
        if (this.list.length > KEEP) this.list.shift();
        if (this.el.hidden && m.msg.from !== net.id && !this.hidden.has(m.msg.from)) this.mark(true);
      }
      this.render();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.beforeOpen();
    this.el.hidden = false;
    this.mark(false);
    this.render();
    this.input.focus();
  }

  close(): void {
    this.el.hidden = true;
  }

  private mark(on: boolean): void {
    this.unread = on;
    $('chatBtn').classList.toggle('unread', on);
    document.dispatchEvent(new CustomEvent('rivalines:unread'));
  }

  /** 新しい発言があるか(メニュー全体の印に使う) */
  get hasUnread(): boolean {
    return this.unread;
  }

  private render(): void {
    const near = this.logEl.scrollHeight - this.logEl.scrollTop - this.logEl.clientHeight < 40;
    const rows = this.list.filter((m) => !this.hidden.has(m.from));
    this.logEl.innerHTML = rows.length
      ? rows
          .map((m) => {
            const mine = m.from === net.id;
            const acts = mine
              ? ''
              : `<span class="ca"><button type="button" data-ca="report" data-id="${m.id}">${esc(tr('通報'))}</button><button type="button" data-ca="hide" data-id="${m.id}">${esc(tr('非表示'))}</button></span>`;
            return `<div class="cm${mine ? ' me' : ''}"><b>${esc(m.name)}</b><small>${clock(m.at)}</small> ${esc(m.text)}${acts}</div>`;
          })
          .join('')
      : `<div class="empty">${esc(tr('まだ発言はありません'))}</div>`;
    if (near || this.isOpen) this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private loadHidden(): number[] {
    try {
      const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as unknown;
      return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
    } catch {
      return [];
    }
  }

  private saveHidden(): void {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...this.hidden].slice(-200)));
  }
}
