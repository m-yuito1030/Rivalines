import { lang, tr } from '../i18n';
import type { ClientMsg, Cmd, CmdResult, ServerMsg } from '../../shared/protocol';

const SESSION = 'simulator-multi-session';

/**
 * このページの置き場所(例: / や /next/)。API と WebSocket は、ここからの相対にする。
 * 本稼働(/live/)と次期バージョン(/next/)は、同じサーバー名の別のパスで配信され、それぞれ別の世界につながる。
 */
export const BASE = location.pathname.replace(/[^/]*$/, '');

/** サーバーとの接続(ログイン・コマンド送信・受信メッセージの配信) */
export class Net {
  private ws: WebSocket | null = null;
  private req = 0;
  private pending = new Map<number, (r: CmdResult) => void>();
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: (code: number) => void = () => {};
  you = '';
  id = 0;

  /** 保存済みのセッション(ログインの省略) */
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

  async auth(kind: 'login' | 'register', name: string, password: string, code = ''): Promise<{ ok: boolean; reason?: string; token?: string }> {
    const r = await fetch(`${BASE}api/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(kind === 'register' ? { name, password, code } : { name, password }),
    });
    const j = (await r.json()) as { ok: boolean; reason?: string; token?: string; name?: string };
    if (j.ok) localStorage.setItem(SESSION, JSON.stringify({ token: j.token, name: j.name }));
    return j;
  }

  /** 接続して、サーバーの最初のメッセージ(init)を待つ */
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
          // セッションは消さない(サーバーが一時的に落ちているだけかもしれない)。無効かどうかは呼び出し側が判断する
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

  /** 操作をサーバーへ送り、結果を待つ */
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

  /** 会社名・プロフィール・色を保存する */
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

  /** 他のプレイヤーを運営に通報する */
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

  /** パスワードの変更 / 退会(どちらも、現在のパスワードで確認する) */
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
