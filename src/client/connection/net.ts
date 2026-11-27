import { lang, tr } from '../i18n';
import type { ClientMsg, Cmd, CmdResult, ServerMsg } from '../../shared/protocol';

const SESSION = 'simulator-multi-session';

/**
 * Where this page is served from (e.g. / or /next/). The API and WebSocket are relative to it.
 * Production (/live/) and the next version (/next/) are served under different paths of the same server name, and each connects to its own world.
 */
export const BASE = location.pathname.replace(/[^/]*$/, '');

/**
 * Go back to the login screen. When this page is one world of the entrance (/live/ or /next/), that is the portal one level up (where you log in and choose a world);
 * otherwise (a single-world setup, or the dev server) the page's own login form, by reloading.
 */
export function toLoginScreen(): void {
  if (BASE !== '/') location.href = new URL('../', location.href).href;
  else location.reload();
}

/** The connection to the server (login, sending commands, and delivering received messages) */
export class Net {
  private ws: WebSocket | null = null;
  private req = 0;
  private pending = new Map<number, (r: CmdResult) => void>();
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: (code: number) => void = () => {};
  /** Receiving chat. Messages that arrive before the screen is ready are held and handed over when the handler is set */
  private chatHandler: ((m: Extract<ServerMsg, { type: 'chat' | 'chatlog' }>) => void) | null = null;
  private chatBuf: Extract<ServerMsg, { type: 'chat' | 'chatlog' }>[] = [];
  setChatHandler(fn: (m: Extract<ServerMsg, { type: 'chat' | 'chatlog' }>) => void): void {
    this.chatHandler = fn;
    for (const m of this.chatBuf.splice(0)) fn(m);
  }
  you = '';
  id = 0;

  /** The saved session (to skip the login) */
  saved(): { token: string; name: string } | null {
    try {
      return JSON.parse(localStorage.getItem(SESSION) ?? 'null');
    } catch {
      return null;
    }
  }

  logout(): void {
    localStorage.removeItem(SESSION);
    this.ws?.close(1000);
  }

  async auth(kind: 'login' | 'register', name: string, password: string): Promise<{ ok: boolean; reason?: string; token?: string }> {
    const r = await fetch(`${BASE}api/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, password, lang: lang() }),
    });
    const j = (await r.json()) as { ok: boolean; reason?: string; token?: string; name?: string };
    if (j.ok) localStorage.setItem(SESSION, JSON.stringify({ token: j.token, name: j.name }));
    return j;
  }

  /** Connect and wait for the server's first message (init) */
  connect(token: string): Promise<Extract<ServerMsg, { type: 'init' }>> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}${BASE}ws?token=${token}&lang=${lang()}`);
      this.ws = ws;
      let inited = false;
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data as string) as ServerMsg;
        if (m.type === 'res') {
          this.pending.get(m.req)?.(m.res);
          this.pending.delete(m.req);
          return;
        }
        if (m.type === 'chat' || m.type === 'chatlog') {
          if (this.chatHandler) this.chatHandler(m);
          else this.chatBuf.push(m);
          return;
        }
        if (m.type === 'init') {
          inited = true;
          this.you = m.you;
          this.id = m.id;
          resolve(m);
        }
        this.onMessage(m);
      };
      ws.onerror = () => {
        if (!inited) reject(new Error(tr('サーバーに接続できません')));
      };
      ws.onclose = (e) => {
        for (const f of this.pending.values()) f({ ok: false, msg: tr('接続が切れました') });
        this.pending.clear();
        if (!inited) {
          // Do not delete the session (the server may just be down for a moment). The caller decides whether it is invalid
          reject(
            new Error(
              e.code === 4003
                ? tr('満員です(同時に遊べる人数の上限に達しています)。しばらくしてからもう一度お試しください')
                : e.code === 1006
                  ? tr('ログインの有効期限が切れたか、サーバーに接続できません')
                  : tr('接続が切れました'),
            ),
          );
        } else this.onClose(e.code);
      };
    });
  }

  private send(m: ClientMsg): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  /** Send an action to the server and wait for the result */
  cmd(cmd: Cmd): Promise<CmdResult> {
    return new Promise((resolve) => {
      if (this.ws?.readyState !== 1) return resolve({ ok: false, msg: tr('接続が切れています') });
      const req = ++this.req;
      this.pending.set(req, resolve);
      this.send({ type: 'cmd', req, cmd });
      setTimeout(() => {
        if (this.pending.delete(req)) resolve({ ok: false, msg: tr('サーバーの応答がありません') });
      }, 15000);
    });
  }

  /** Save the company name, profile, and color */
  profile(company: string, bio: string, color: number): Promise<CmdResult> {
    return new Promise((resolve) => {
      if (this.ws?.readyState !== 1) return resolve({ ok: false, msg: tr('接続が切れています') });
      const req = ++this.req;
      this.pending.set(req, resolve);
      this.send({ type: 'profile', req, company, bio, color });
      setTimeout(() => {
        if (this.pending.delete(req)) resolve({ ok: false, msg: tr('サーバーの応答がありません') });
      }, 15000);
    });
  }

  /** Post to the public chat */
  chat(text: string): Promise<CmdResult> {
    return new Promise((resolve) => {
      if (this.ws?.readyState !== 1) return resolve({ ok: false, msg: tr('接続が切れています') });
      const req = ++this.req;
      this.pending.set(req, resolve);
      this.send({ type: 'chat', req, text });
      setTimeout(() => {
        if (this.pending.delete(req)) resolve({ ok: false, msg: tr('サーバーの応答がありません') });
      }, 15000);
    });
  }

  /** Report another player to the operators */
  report(target: number, reason: string): Promise<CmdResult> {
    return new Promise((resolve) => {
      if (this.ws?.readyState !== 1) return resolve({ ok: false, msg: tr('接続が切れています') });
      const req = ++this.req;
      this.pending.set(req, resolve);
      this.send({ type: 'report', req, target, reason });
      setTimeout(() => {
        if (this.pending.delete(req)) resolve({ ok: false, msg: tr('サーバーの応答がありません') });
      }, 15000);
    });
  }

  /** Change the password / leave (both are confirmed with the current password) */
  async account(kind: 'password' | 'leave', name: string, password: string, newPassword = ''): Promise<{ ok: boolean; reason?: string }> {
    const r = await fetch(`${BASE}api/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password, newPassword }) });
    const j = (await r.json()) as { ok: boolean; reason?: string; token?: string; name?: string };
    if (j.ok && kind === 'password') localStorage.setItem(SESSION, JSON.stringify({ token: j.token, name: j.name }));
    if (j.ok && kind === 'leave') localStorage.removeItem(SESSION);
    return j;
  }

  sendView(x0: number, y0: number, x1: number, y1: number): void {
    this.send({ type: 'view', x0, y0, x1, y1 });
  }
}

export const net = new Net();
