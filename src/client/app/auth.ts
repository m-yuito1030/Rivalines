import { Simulation, type SimState } from '../../shared/sim/simulation';
import { makeWorldMap } from '../../shared/world/bigTerrain';
import type { GameMap } from '../../shared/world/gameMap';
import { BASE, net, toLoginScreen } from '../connection/net';
import { Mirror } from '../connection/mirror';
import { $, sleep } from './dom';
import { tr } from '../i18n';
import { openRegisterModal } from './registerModal';
import './resuming.css';

/** What to do after entering a world (starting the game screen). Passed in from main */
export type StartGame = (map: GameMap, sim: Simulation, mirror: Mirror, startAt: { x: number; y: number }, cam?: { x: number; y: number; zoom: number }) => Promise<void>;

/**
 * Login, registration, resuming with a saved login, and automatic reconnection when disconnected.
 * On a successful login, receive the world and call startGame.
 */
/** Translate a reason sent by the server. A suspension reason carries the operator's text, so translate only the fixed part around it */
const BAN_PREFIX = 'このアカウントは利用停止中です(理由: ';
const trReason = (reason: string): string =>
  reason.startsWith(BAN_PREFIX) && reason.endsWith(')') ? tr('このアカウントは利用停止中です(理由: {reason})', { reason: reason.slice(BAN_PREFIX.length, -1) }) : tr(reason);

export function initAuth(startGame: StartGame): void {
  const formNote = $('note');
  const errEl = $('err');
  const resumingEl = $('resuming');
  const resumeNote = $('resumeNote');
  const resumeOther = $<HTMLButtonElement>('resumeOther');
  /** Status text: shown under the login form, and on the "restoring your login" screen if that is what is showing */
  const note = {
    set textContent(v: string) {
      formNote.textContent = v;
      resumeNote.textContent = v;
    },
  };
  /** Show the login form (and hide the restoring screen) */
  const showForm = () => {
    resumingEl.hidden = true;
    $('startForm').hidden = false;
  };
  /** Show the restoring screen instead of the form, so a player with a saved login does not start typing */
  const showResuming = () => {
    $('startForm').hidden = true;
    resumingEl.hidden = false;
    resumeNote.textContent = tr('ログインを復元しています…');
    resumeOther.textContent = tr('別のアカウントでログインする');
  };
  /** An empty state for the client's "mirror" (the server advances the world) */
  const emptyState = (): SimState => ({
    tick: 0,
    speed: 1,
    rng: 1,
    towns: [],
    transit: { nextId: 1, delivered: 0, transfers: 0, stops: [], routes: [], vehicles: [] },
    rivals: [],
  });

  /** After login, enter the world */
  async function enterWorld(token: string, fresh = false): Promise<void> {
    // Someone who has just registered sees their own wording, not the same text as everyone who logs in
    note.textContent = fresh ? tr('アカウントを作成しました。世界に入っています…') : tr('サーバーに接続中...');
    const init = await net.connect(token);
    // When the server's version differs from the version of the page now open (a stale page left open after an update), prompt a reload
    if (init.version && init.version !== __APP_VERSION__) {
      $('updateText').textContent = tr('新しい版({version})が出ました。画面を再読み込みしてください。', { version: init.version });
      const btn = $<HTMLButtonElement>('updateReload');
      btn.textContent = tr('再読み込み');
      btn.onclick = () => location.reload();
      $('updateBar').hidden = false;
    }
    const map = makeWorldMap(init.world.size, init.world.seed);
    const sim = new Simulation(map, emptyState(), { multi: true });
    const mirror = new Mirror(map, sim);
    net.onMessage = (m) => mirror.apply(m);
    const start = init.start ?? { x: map.size / 2, y: map.size / 2 };
    const R = 48;
    net.sendView(start.x - R, start.y - R, start.x + R, start.y + R);
    note.textContent = fresh ? tr('あなたの会社を準備しています…') : tr('世界を受信中...');
    await new Promise<void>((res) => {
      mirror.onFirst = res;
      setTimeout(res, 8000);
    });
    const first = !init.start ? map.towns[0] : null;
    const cam = init.start ? undefined : undefined;
    await startGame(map, sim, mirror, first ? { x: first.x, y: first.y } : start, cam);
  }

  const authBusy = (b: boolean) => document.querySelectorAll<HTMLButtonElement>('#startForm button').forEach((x) => (x.disabled = b));
  /** If a stale page is left after a rebuild and cannot read a distributed file that is gone, reload the page (only once) */
  const reloadOnStale = () => {
    if (sessionStorage.getItem('stale-reload')) return;
    sessionStorage.setItem('stale-reload', '1');
    location.reload();
  };
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    reloadOnStale();
  });
  window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('stale-reload'), 5000));

  async function doAuth(kind: 'login' | 'register'): Promise<void> {
    errEl.textContent = '';
    authBusy(true);
    try {
      const r = await net.auth(kind, $<HTMLInputElement>('uname').value, $<HTMLInputElement>('upw').value);
      if (!r.ok) {
        errEl.textContent = r.reason ? trReason(r.reason) : tr('失敗しました');
        return authBusy(false);
      }
      await enterWorld(r.token!, kind === 'register');
    } catch (e) {
      const msg = (e as Error).message;
      if (/module script|dynamically imported module|Failed to fetch dynamically/i.test(msg)) return reloadOnStale();
      errEl.textContent = msg;
      authBusy(false);
    }
  }
  $('startForm').addEventListener('submit', (e) => {
    e.preventDefault();
    void doAuth('login');
  });
  // Sign-up has its own window (its own fields, notes, and agreement), separate from the login form
  $('register').addEventListener('click', () => {
    errEl.textContent = '';
    openRegisterModal($<HTMLInputElement>('uname').value, async (name, password) => {
      const r = await net.auth('register', name, password);
      if (!r.ok) return { ok: false, reason: r.reason };
      authBusy(true);
      void enterWorld(r.token!, true).catch((e: Error) => {
        errEl.textContent = e.message;
        authBusy(false);
      });
      return { ok: true };
    });
  });
  void fetch(`${BASE}api/status`)
    .then((r) => r.json())
    .then((s: { world: { size: number }; accounts: number; maxOnline: number; online: number }) => {
      formNote.textContent = tr('サーバー稼働中: {size}² / 登録{accounts}人 / オンライン{online}/{max}人', {
        size: s.world.size,
        accounts: s.accounts,
        online: s.online,
        max: s.maxOnline,
      });
    })
    .catch(() => (formNote.textContent = tr('サーバーに接続できません')));
  const serverUp = () =>
    fetch(`${BASE}api/status`)
      .then((r) => r.ok)
      .catch(() => false);
  /** Re-enter with the saved login. While the server is down, wait and retry; go back to the login screen only when the token is invalid */
  async function resume(token: string): Promise<void> {
    for (let i = 0; i < 90; i++) {
      try {
        await enterWorld(token);
        return;
      } catch {
        if (await serverUp()) {
          net.logout(); // the server is up but we cannot get in = the token is invalid
          note.textContent = '';
          showForm();
          return;
        }
        resumeOther.hidden = false; // while waiting for the server, the player can still choose to log in again
        note.textContent = tr('サーバーに再接続しています…');
        await sleep(2000);
      }
    }
    resumeOther.hidden = false;
    note.textContent = tr('サーバーに接続できません。しばらくしてから再読み込みしてください');
  }
  resumeOther.addEventListener('click', () => {
    net.logout();
    toLoginScreen();
  });
  {
    const saved = net.saved();
    if (saved) {
      showResuming();
      void resume(saved.token);
    } else showForm();
  }
  net.onClose = (code) => {
    if (code === 4000) {
      alert(tr('別の場所でログインされたため切断されました'));
      location.reload();
      return;
    }
    if (code === 4001 || code === 4005) {
      alert(tr(code === 4005 ? '利用停止または退会により、切断されました' : '運営により切断されました(パスワードの変更を含む)。もう一度ログインしてください'));
      net.logout();
      toLoginScreen();
      return;
    }
    // On a network switch, a phone going to the background, a server restart, and so on: wait until it is back and rejoin automatically (the login is saved, so it just resumes)
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:100;background:#b3261e;color:#fff;padding:10px;text-align:center;font-size:14px';
    bar.textContent = tr('接続が切れました。再接続しています…');
    document.body.appendChild(bar);
    void (async () => {
      while (!(await serverUp())) await sleep(2000);
      location.reload();
    })();
  };
}
