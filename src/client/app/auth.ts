import { Simulation, type SimState } from '../../shared/sim/simulation';
import { makeWorldMap } from '../../shared/world/bigTerrain';
import type { GameMap } from '../../shared/world/gameMap';
import { BASE, net } from '../connection/net';
import { Mirror } from '../connection/mirror';
import { $, sleep } from './dom';
import { tr } from '../i18n';

/** 世界に入ったあとの処理(ゲーム画面の起動)。main から渡す */
export type StartGame = (map: GameMap, sim: Simulation, mirror: Mirror, startAt: { x: number; y: number }, cam?: { x: number; y: number; zoom: number }) => Promise<void>;

/**
 * ログイン・新規登録・保存済みログインでの再開・切断時の自動再接続。
 * ログインに成功したら世界を受信して startGame を呼ぶ。
 */
export function initAuth(startGame: StartGame): void {
  const note = $('note');
  const errEl = $('err');
  /** クライアントが持つ「ミラー」用の空の状態(世界はサーバーが進める) */
  const emptyState = (): SimState => ({
    tick: 0,
    speed: 1,
    rng: 1,
    towns: [],
    transit: { nextId: 1, delivered: 0, transfers: 0, stops: [], routes: [], vehicles: [] },
    rivals: [],
  });

  /** ログイン後、世界に入る */
  async function enterWorld(token: string): Promise<void> {
    note.textContent = tr('サーバーに接続中...');
    const init = await net.connect(token);
    const map = makeWorldMap(init.world.size, init.world.seed);
    const sim = new Simulation(map, emptyState(), { multi: true });
    const mirror = new Mirror(map, sim);
    net.onMessage = (m) => mirror.apply(m);
    const start = init.start ?? { x: map.size / 2, y: map.size / 2 };
    const R = 48;
    net.sendView(start.x - R, start.y - R, start.x + R, start.y + R);
    note.textContent = tr('世界を受信中...');
    await new Promise<void>((res) => {
      mirror.onFirst = res;
      setTimeout(res, 8000);
    });
    const first = !init.start ? map.towns[0] : null;
    const cam = init.start ? undefined : undefined;
    await startGame(map, sim, mirror, first ? { x: first.x, y: first.y } : start, cam);
  }

  const authBusy = (b: boolean) => document.querySelectorAll<HTMLButtonElement>('#startForm button').forEach((x) => (x.disabled = b));
  /** 再ビルド後に古い画面が残っていて、消えた配信物を読めなかった場合は、画面を読み直す(1回だけ) */
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
      const r = await net.auth(kind, $<HTMLInputElement>('uname').value, $<HTMLInputElement>('upw').value, $<HTMLInputElement>('ucode').value.trim());
      if (!r.ok) {
        errEl.textContent = r.reason ? tr(r.reason) : tr('失敗しました');
        return authBusy(false);
      }
      await enterWorld(r.token!);
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
  $('register').addEventListener('click', () => void doAuth('register'));
  void fetch(`${BASE}api/status`)
    .then((r) => r.json())
    .then((s: { world: { size: number }; accounts: number; maxOnline: number; online: number; invite?: boolean }) => {
      note.textContent = tr('サーバー稼働中: {size}² / 登録{accounts}人 / オンライン{online}/{max}人', {
        size: s.world.size,
        accounts: s.accounts,
        online: s.online,
        max: s.maxOnline,
      });
      $('codeRow').hidden = !s.invite; // 招待コードが必要なサーバーだけ、入力欄を出す
    })
    .catch(() => (note.textContent = tr('サーバーに接続できません')));
  const serverUp = () =>
    fetch(`${BASE}api/status`)
      .then((r) => r.ok)
      .catch(() => false);
  /** 保存済みのログインで入り直す。サーバーが落ちている間は待って再試行し、トークンが無効なときだけログイン画面に戻す */
  async function resume(token: string): Promise<void> {
    for (let i = 0; i < 90; i++) {
      try {
        await enterWorld(token);
        return;
      } catch {
        if (await serverUp()) {
          net.logout(); // サーバーは生きているのに入れない = トークンが無効
          note.textContent = '';
          return;
        }
        note.textContent = tr('サーバーに再接続しています…');
        await sleep(2000);
      }
    }
    note.textContent = tr('サーバーに接続できません。しばらくしてから再読み込みしてください');
  }
  {
    const saved = net.saved();
    if (saved) void resume(saved.token);
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
      location.reload();
      return;
    }
    // 回線の切り替え・スマホのバックグラウンド・サーバーの再起動などで切れたとき: 戻るまで待って自動で入り直す(ログインは保存済みなのでそのまま再開)
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
