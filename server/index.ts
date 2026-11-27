import { TrafficMeter } from './traffic';
import { LOCALES, isLangCode, type LangCode } from '../src/shared/i18n';
import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { Simulation } from '../src/shared/sim/simulation';
import { calendarOf } from '../src/shared/sim/world/calendar';
import { makeWorldMap } from '../src/shared/world/bigTerrain';
import { applyLayers, decodeSave, encodeSave } from '../src/shared/save/serialize';
import { Accounts } from './accounts';
import { Reports } from './reports';
import { Chat } from './chat';
import { Announcements } from './announcements';
import { execute } from './commands/index';
import { Replicator, type Client } from './replicate';
import type { ClientMsg } from '../src/shared/protocol';
import { Governor, WindowLimiter, isHeavy, messageLimit } from './limits';

const PORT = Number(process.env.PORT ?? 8091);
const DATA = process.env.DATA_DIR ?? './data';
const SIZE = Number(process.env.WORLD_SIZE ?? 65535);
const SEED = Number(process.env.WORLD_SEED ?? 20260401);
/** 同時に接続できる人数(登録できる人数には上限がない)。旧名 MAX_USERS も受け付ける */
const MAX_ONLINE = Number(process.env.MAX_ONLINE ?? process.env.MAX_USERS ?? 100);
/** サーバー全体で、1時間に新規登録できる人数(ボットに大量登録されないための安全弁) */
const REGISTER_PER_HOUR = Number(process.env.REGISTER_PER_HOUR ?? 300);
const SAVE_FILE = `${DATA}/world.sav`;
/** 鍵の比較(長さが違えば不一致。内容は、時間の差で推測されないよう一定の時間で比べる) */
const sameCode = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * この世界の名前: live=本稼働 / next=次期バージョン(テスト用。データは消えてよい)。画面の選択に出る。
 * ACCOUNTS_FROM を指定すると、そのディレクトリ(本稼働側のデータ置き場)のアカウントを読み取り専用で使う。
 * 同じ名前・パスワードでどちらの世界にも入れて、世界ごとの会社のデータは別になる。
 */
const ENV_NAME = process.env.ENV_NAME ?? 'live';
const ENV_LABEL = process.env.ENV_LABEL ?? (ENV_NAME === 'live' ? '本稼働' : '次期バージョン');
const APP_VERSION = process.env.APP_VERSION ?? 'dev';
/** ゲームの版番号(package.json)。接続のたびに画面へ伝え、古い画面が開いたままのときに再読み込みを促す */
const GAME_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const ACCOUNTS_FROM = process.env.ACCOUNTS_FROM || undefined;

mkdirSync(DATA, { recursive: true });
const accounts = new Accounts(`${DATA}/accounts.json`, { followFrom: ACCOUNTS_FROM });
const reports = new Reports(`${DATA}/reports.json`);
const chat = new Chat();
/** お知らせ。次期バージョンは、本稼働のお知らせを読み取り専用で表示する */
const news = new Announcements(`${ACCOUNTS_FROM ?? DATA}/announcements.json`, !!ACCOUNTS_FROM);
/** 運営用の鍵(設定しないと、運営用の API は使えない)。公開側の nginx は /api/admin を通さない */
const ADMIN_KEY = process.env.ADMIN_KEY ?? '';

/** 世界を作る(巨大マップ)。セーブがあれば続きから */
async function loadWorld(): Promise<Simulation> {
  const map = makeWorldMap(SIZE, SEED);
  if (existsSync(SAVE_FILE)) {
    try {
      const d = await decodeSave(new Uint8Array(readFileSync(SAVE_FILE)) as Uint8Array<ArrayBuffer>);
      if (d.header.size === SIZE && d.header.seed === SEED) {
        applyLayers(map, d);
        console.log(`[world] セーブから再開 tick=${d.header.sim.tick}`);
        return new Simulation(map, d.header.sim, { multi: true });
      }
    } catch (e) {
      console.warn('[world] セーブを読めないので新規で開始:', (e as Error).message);
    }
  }
  console.log(`[world] 新規ワールド ${SIZE}² seed ${SEED}`);
  return new Simulation(map, undefined, { multi: true });
}

const sim = await loadWorld();
// 小さな世界(次期バージョンなど)は、起動のときに、すべての区画の街を作っておく(遊びながら生まれるのを待たない)
if (process.env.WORLD_PREGEN === '1') {
  const t0 = performance.now();
  sim.discoverNear(SIZE / 2, SIZE / 2, Math.ceil(SIZE / 1024));
  console.log(`[world] 全区画の街を生成 ${sim.map.towns.length}か所 ${(performance.now() - t0).toFixed(0)}ms`);
}
// ゲームの進む速さ(1 = 実時間30分でゲーム内1日)。既定は 0.5(実時間60分で1日)。環境変数 SPEED で変えられる
sim.speed = Number(process.env.SPEED ?? 0.5);

async function saveWorld(): Promise<void> {
  const bytes = await encodeSave(sim.map, sim.state());
  writeFileSync(SAVE_FILE + '.tmp', bytes);
  renameSync(SAVE_FILE + '.tmp', SAVE_FILE);
  console.log(`[world] 保存 tick=${sim.tick} ${(bytes.length / 1024).toFixed(0)}KB`);
}

// ---- 接続 ----
/** 重い操作の、サーバー全体の間隔(かかった時間の3倍は次を受け付けない) */
const governor = new Governor();
const repl = new Replicator(sim, accounts);
const clients = new Set<Client>();
/** オンライン中の会社を反映する(切断した会社は止まる) */
const syncOnline = () => sim.setOnline([...clients].map((c) => c.id));
// 会社は、アカウントが最初に接続したときに作る(登録しただけの人のぶんで、世界のデータが膨らまないように)
syncOnline();
const registrations = new WindowLimiter(REGISTER_PER_HOUR);

const json = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  // 画面と同じ場所(同一オリジン)から使うので、CORS は許可しない(他のサイトから勝手に呼べないように)
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((res, rej) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try {
        res(JSON.parse(s || '{}'));
      } catch (e) {
        rej(e);
      }
    });
  });

// 総当たり対策: 同じIPからの認証は1分に10回まで
const attempts = new Map<string, number[]>();
const AUTH_RATE = Number(process.env.AUTH_RATE ?? 10);
/** 接続元のIP。nginx(プロキシ)の後ろでは接続元が全員プロキシになるので、プロキシが付ける X-Real-IP を使う(サーバーは直接公開しない) */
const clientIp = (req: IncomingMessage): string => {
  const h = req.headers['x-real-ip'];
  const v = Array.isArray(h) ? h[0] : h;
  return v && v.length <= 64 ? v : (req.socket.remoteAddress ?? '');
};
const throttled = (ip: string) => {
  const now = Date.now();
  const l = (attempts.get(ip) ?? []).filter((t) => now - t < 60000);
  l.push(now);
  attempts.set(ip, l);
  return l.length > AUTH_RATE;
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return void res.end();
  }
  const url = req.url ?? '';
  try {
    if (req.method === 'GET' && url === '/api/announcements') return json(res, 200, { ok: true, list: news.list() });
    if (req.method === 'GET' && url === '/api/status') return json(res, 200, status());
    if (req.method === 'POST' && (url === '/api/register' || url === '/api/login')) {
      if (throttled(clientIp(req))) return json(res, 429, { ok: false, reason: '試行回数が多すぎます。少し待ってください' });
      const b = await readBody(req);
      const name = String(b.name ?? '');
      const password = String(b.password ?? '');
      if (url === '/api/register') {
        if (accounts.readOnly) return json(res, 403, { ok: false, reason: '新規登録は本稼働側で行ってください(同じ名前とパスワードで、こちらでも遊べます)' });
        if (!registrations.tryTake()) return json(res, 429, { ok: false, reason: '新規登録が混み合っています。しばらくしてからもう一度お試しください' });
        const r = await accounts.register(name, password);
        if (!r.ok) return json(res, 400, r);
        return json(res, 200, { ok: true, token: accounts.issueToken(r.account.id), name: r.account.name });
      }
      const a = await accounts.verify(name, password);
      if (!a) return json(res, 401, { ok: false, reason: '名前またはパスワードが違います' });
      if (a.banned) return json(res, 403, { ok: false, reason: `このアカウントは利用停止中です(理由: ${a.banned.reason})` });
      return json(res, 200, { ok: true, token: accounts.issueToken(a.id), name: a.name });
    }
    if (req.method === 'POST' && (url === '/api/password' || url === '/api/leave')) {
      // 本人が、現在のパスワードを示して、パスワードを変える / 退会する(退会すると、会社と記録が消える)
      if (throttled(clientIp(req))) return json(res, 429, { ok: false, reason: '試行回数が多すぎます。少し待ってください' });
      const b = await readBody(req);
      const a = await accounts.verify(String(b.name ?? ''), String(b.password ?? ''));
      if (!a) return json(res, 401, { ok: false, reason: '名前またはパスワードが違います' });
      if (url === '/api/leave') {
        removeAccount(a.id);
        return json(res, 200, { ok: true });
      }
      const why = await accounts.setPassword(a.id, String(b.newPassword ?? ''));
      if (why) return json(res, 400, { ok: false, reason: why });
      return json(res, 200, { ok: true, token: accounts.issueToken(a.id), name: a.name });
    }
    if (req.method === 'POST' && url === '/api/admin') {
      // 運営用(鍵が必要。nginx は外からこの道を通さない)
      if (!ADMIN_KEY) return json(res, 404, { ok: false });
      const b = await readBody(req);
      if (throttled(`admin:${clientIp(req)}`) || !sameCode(String(req.headers['x-admin-key'] ?? ''), ADMIN_KEY)) return json(res, 403, { ok: false, reason: '鍵が違います' });
      return json(res, 200, await admin(String(b.action ?? ''), String(b.who ?? ''), String(b.text ?? '')));
    }
    json(res, 404, { ok: false });
  } catch {
    json(res, 400, { ok: false, reason: '不正なリクエスト' });
  }
});

/** 接続中のアカウントを切る(同じ接続が残らないように、閉じる理由の番号を付ける: 4001=切断された 4005=利用停止・退会) */
function kick(id: number, code: number): boolean {
  let any = false;
  for (const c of clients) if (c.id === id) ((any = true), c.ws.close(code, code === 4005 ? 'banned' : 'kicked'));
  return any;
}
/** アカウントと、その会社(施設・路線・車両・提携など)を消す */
function removeAccount(id: number): void {
  kick(id, 4005);
  for (const c of [...clients]) if (c.id === id) clients.delete(c);
  sim.removePlayer(id);
  accounts.remove(id);
  reports.dismiss({ target: id });
  chat.forget(id);
  syncOnline();
}
/** 運営の操作。who は名前、または #ID */
async function admin(action: string, who: string, text: string): Promise<{ ok: boolean; msg: string; data?: unknown }> {
  if (action === 'reports') return { ok: true, msg: `${reports.all().length}件`, data: reports.all() };
  if (action === 'announcements') return { ok: true, msg: `${news.list().length}件`, data: news.list() };
  if (action === 'announce') {
    const r = news.add(who, text);
    return r.ok ? { ok: true, msg: `お知らせ #${r.item.id} を出しました` } : { ok: false, msg: r.reason };
  }
  if (action === 'unannounce') return news.remove(Number(who)) ? { ok: true, msg: `お知らせ #${who} を消しました` } : { ok: false, msg: 'そのお知らせはありません' };
  if (action === 'chat') return { ok: true, msg: `${chat.recentLog().length}件`, data: chat.recentLog() };
  if (action === 'dismiss') return { ok: true, msg: `${reports.dismiss({ id: Number(who) })}件を対応済みにしました` };
  if (action === 'traffic') {
    const total = trafficTotal.snapshot();
    const hour = trafficWindow.snapshot();
    return { ok: true, msg: `起動してから: ${trafficTotal.summary(total)}\n直近(1時間ごとに区切り): ${trafficWindow.summary(hour)}`, data: { total, hour } };
  }
  if (action === 'players')
    return { ok: true, msg: `登録${accounts.count}人 / オンライン${clients.size}人`, data: [...clients].map((c) => ({ id: c.id, name: accounts.byId(c.id)?.name })) };
  const a = accounts.find(who);
  if (!a) return { ok: false, msg: `アカウントが見つかりません: ${who}` };
  const label = `${a.name}(#${a.id})`;
  switch (action) {
    case 'mute': {
      const min = text ? Number(text) : 60;
      if (!Number.isFinite(min) || min < 0 || min > 60 * 24 * 30) return { ok: false, msg: '分は 0〜43200 で指定してください(0 で解除)' };
      chat.mute(a.id, min);
      return { ok: true, msg: min > 0 ? `${label} のチャットを ${min} 分止めました(再起動で解けます)` : `${label} のチャットの停止を解きました` };
    }
    case 'kick':
      return { ok: true, msg: kick(a.id, 4001) ? `${label} を切断しました` : `${label} は接続していません` };
    case 'ban':
      accounts.setBan(a.id, text || '規約違反');
      chat.forget(a.id);
      kick(a.id, 4005);
      reports.dismiss({ target: a.id });
      return { ok: true, msg: `${label} を利用停止にしました` };
    case 'unban':
      accounts.setBan(a.id, null);
      return { ok: true, msg: `${label} の利用停止を解除しました` };
    case 'clear':
      accounts.clearText(a.id);
      return { ok: true, msg: `${label} の会社名・プロフィールを消しました` };
    case 'resetpw': {
      // 一時パスワードを発行する(これまでのログインは無効になる)。本人に、別の経路で伝える
      const pw = randomBytes(9).toString('base64url');
      await accounts.setPassword(a.id, pw);
      kick(a.id, 4001);
      return { ok: true, msg: `${label} の一時パスワード: ${pw}(ログイン後に変更してもらってください)` };
    }
    case 'delete':
      removeAccount(a.id);
      return { ok: true, msg: `${label} を削除しました` };
    default:
      return { ok: false, msg: `不明な操作: ${action}` };
  }
}

// 通信量の計測(合計と種類ごとの大きさだけ。個人を特定する情報は持たない)。admin の traffic と、1時間ごとの記録で見られる
const trafficWindow = new TrafficMeter(); // 1時間ごとに区切る
const trafficTotal = new TrafficMeter(256); // 起動してからの合計
const traffic = {
  sent: (d: string | Buffer) => (trafficWindow.sent(d), trafficTotal.sent(d)),
  received: (n: number) => (trafficWindow.received(n), trafficTotal.received(n)),
  presence: (p: number, dt: number) => (trafficWindow.presence(p, dt), trafficTotal.presence(p, dt)),
};
const TRAFFIC_LOG = `${DATA}/traffic.jsonl`;
setInterval(() => traffic.presence(clients.size, 1), 1000).unref();
setInterval(
  () => {
    const s = trafficWindow.snapshot();
    if (s.playerSeconds > 0) {
      console.log(`[traffic] ${trafficWindow.summary(s)}`);
      try {
        trafficWindow.append(TRAFFIC_LOG, s);
      } catch (e) {
        console.warn('[traffic] 記録に失敗:', (e as Error).message);
      }
    }
    trafficWindow.reset();
  },
  60 * 60 * 1000,
).unref();

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const token = new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? '';
  const a = accounts.fromToken(token);
  const langParam = new URL(req.url ?? '', 'http://x').searchParams.get('lang');
  const lang: LangCode = isLangCode(langParam) ? langParam : 'ja';
  if (!a) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    // 同時接続の上限(同じアカウントの入り直しは、古い接続と入れ替わるので数えない)
    const rejoin = [...clients].some((c) => c.id === a.id);
    if (!rejoin && clients.size >= MAX_ONLINE) return void ws.close(4003, 'full');
    // 同じアカウントの二重接続は古い方を切る
    for (const c of clients) if (c.id === a.id) c.ws.close(4000, 'other login');
    // この接続から送るものを、すべて数える(送る場所が何か所もあるので、send そのものを包む)
    const rawSend = ws.send.bind(ws) as (...a: unknown[]) => void;
    ws.send = ((data: string | Buffer, ...rest: unknown[]) => {
      traffic.sent(data);
      return rawSend(data, ...rest);
    }) as typeof ws.send;
    (ws as typeof ws & { alive?: boolean }).alive = true;
    ws.on('pong', () => ((ws as typeof ws & { alive?: boolean }).alive = true));
    const c = repl.newClient(ws, a.id, a.name);
    clients.add(c);
    sim.playerCompany(a.id);
    syncOnline();
    ws.send(
      JSON.stringify({ type: 'init', you: a.name, id: a.id, world: { size: SIZE, seed: SEED }, tick: sim.tick, start: accounts.byId(a.id)?.last ?? null, version: GAME_VERSION }),
    );
    ws.send(JSON.stringify({ type: 'chatlog', list: chat.recentLog() }));
    let tokens = 30;
    const refill = setInterval(() => (tokens = Math.min(30, tokens + 10)), 1000); // 操作は毎秒10回まで(瞬間30回)
    const limit = messageLimit();
    let viewTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingView: Extract<ClientMsg, { type: 'view' }> | null = null;
    let lastViewAt = 0;
    const applyView = (m: Extract<ClientMsg, { type: 'view' }>) => {
      if (![m.x0, m.y0, m.x1, m.y1].every((n) => Number.isFinite(n))) return;
      repl.setView(c, m.x0, m.y0, m.x1, m.y1);
      accounts.setLast(c.id, Math.round((m.x0 + m.x1) / 2), Math.round((m.y0 + m.y1) / 2));
    };
    ws.on('close', () => {
      clearInterval(refill);
      if (viewTimer) clearTimeout(viewTimer);
    });
    ws.on('message', (data) => {
      traffic.received((data as Buffer).byteLength ?? 0);
      // どの種類のメッセージも、毎秒の件数に上限(超えた分は捨て、あまりに多ければ切断)
      if (!accounts.byId(c.id)) return; // 退会・削除されたアカウントの、閉じる前に届いた操作は捨てる(消した会社が作り直されないように)
      const verdict = limit();
      if (verdict === 'drop') return;
      if (verdict === 'close') return void ws.terminate(); // 洪水は、閉じる手続きを待たず、すぐ切る
      let m: ClientMsg;
      try {
        m = JSON.parse(String(data)) as ClientMsg;
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'view') {
        // 視界の更新は 0.1秒に1回まで(広い範囲を次々指定してサーバーに地図データを作らせ続ける攻撃を防ぐ)。間引いた分は最新だけ後で反映
        const wait = 100 - (Date.now() - lastViewAt);
        if (wait <= 0) {
          lastViewAt = Date.now();
          applyView(m);
        } else {
          pendingView = m;
          viewTimer ??= setTimeout(() => {
            viewTimer = null;
            if (!pendingView) return;
            lastViewAt = Date.now();
            applyView(pendingView);
            pendingView = null;
          }, wait);
        }
      } else if (m.type === 'profile') {
        if (tokens <= 0) return void ws.send(JSON.stringify({ type: 'res', req: m.req, res: { ok: false, msg: LOCALES[lang].tr('操作が多すぎます。少し待ってください') } }));
        tokens -= 5; // 保存はディスクに書くので重めに数える
        const why = accounts.setProfile(c.id, m);
        ws.send(JSON.stringify({ type: 'res', req: m.req, res: why ? { ok: false, msg: why } : { ok: true, msg: '会社の情報を保存しました' } }));
      } else if (m.type === 'chat') {
        if (tokens <= 0) return void ws.send(JSON.stringify({ type: 'res', req: m.req, res: { ok: false, msg: LOCALES[lang].tr('操作が多すぎます。少し待ってください') } }));
        tokens--;
        const acc = accounts.byId(c.id);
        const r = chat.post({ id: c.id, name: acc?.company || a.name }, m.text);
        if (r.ok) {
          const out = JSON.stringify({ type: 'chat', msg: r.msg });
          for (const o of clients) if (o.ws.readyState === 1) o.ws.send(out);
        }
        ws.send(JSON.stringify({ type: 'res', req: m.req, res: r.ok ? { ok: true } : { ok: false, msg: LOCALES[lang].tr(r.reason) } }));
      } else if (m.type === 'report') {
        if (tokens <= 0) return void ws.send(JSON.stringify({ type: 'res', req: m.req, res: { ok: false, msg: LOCALES[lang].tr('操作が多すぎます。少し待ってください') } }));
        tokens -= 5;
        const t = typeof m.target === 'number' ? accounts.byId(m.target) : undefined;
        const why = t ? reports.add({ id: c.id, name: a.name }, { id: t.id, name: t.name }, m.reason) : '相手が見つかりません';
        ws.send(JSON.stringify({ type: 'res', req: m.req, res: why ? { ok: false, msg: why } : { ok: true, msg: '通報しました。運営が確認します' } }));
      } else if (m.type === 'cmd') {
        if (tokens <= 0) return void ws.send(JSON.stringify({ type: 'res', req: m.req, res: { ok: false, msg: LOCALES[lang].tr('操作が多すぎます。少し待ってください') } }));
        tokens--;
        let res;
        try {
          // 重い操作(長距離の自動敷設など)は、サーバー全体で間隔をあける(全員の画面が固まらないように)
          const heavy = isHeavy(m.cmd);
          const busy = heavy && governor.busy();
          if (busy) res = { ok: false, msg: LOCALES[lang].tr('重い操作が混み合っています。数秒おいて、もう一度お試しください') };
          else {
            const t0 = performance.now();
            res = execute(sim, c.id, m.cmd, lang);
            if (heavy) governor.used(performance.now() - t0);
          }
        } catch (e) {
          console.warn('[cmd]', (e as Error).message);
          res = { ok: false, msg: LOCALES[lang].tr('サーバーエラー') };
        }
        ws.send(JSON.stringify({ type: 'res', req: m.req, res }));
      }
    });
    const drop = () => {
      if (clients.delete(c)) {
        syncOnline();
        accounts.flush();
        if (clients.size === 0) void saveWorld(); // 最後の人が抜けたら保存して停止
      }
    };
    ws.on('close', drop);
    ws.on('error', drop);
  });
});

function status() {
  const d = calendarOf(Math.floor((sim.tick + 18000 / 4) / 18000));
  return {
    env: { name: ENV_NAME, label: ENV_LABEL, version: APP_VERSION, accountsFollowed: accounts.readOnly },
    tick: sim.tick,
    date: `${d.year}/${d.month}/${d.day}`,
    world: { size: SIZE, seed: SEED },
    towns: sim.map.towns.length,
    pop: Math.floor(sim.map.towns.reduce((s, t) => s + t.pop, 0)),
    vehicles: sim.transit.vehicles.length,
    accounts: accounts.count,
    online: clients.size, // 人数だけ(名前は出さない)
    maxOnline: MAX_ONLINE,
    perf: { simMs: +perf.sim.toFixed(1), replMs: +perf.repl.toFixed(1), loopMs: +perf.loop.toFixed(1), throttled: sim.throttled },
  };
}

// ---- 進行 ----
let last = performance.now();
let frameN = 0;
const perf = { sim: 0, repl: 0, loop: 0 };
let loopErrors = 0;
setInterval(() => {
  try {
    tickLoop();
  } catch (e) {
    // 1回の失敗でサーバー全体を落とさない(落ちると全員が切断され、最後のオートセーブまで巻き戻る)
    if (++loopErrors <= 20 || loopErrors % 600 === 0) console.error(`[loop] エラー(${loopErrors}回目):`, (e as Error).stack ?? e);
  }
}, 100);
function tickLoop() {
  const now = performance.now();
  // 誰もログインしていない間は世界(街・AI会社を含む)を進めない
  if (clients.size === 0) {
    last = now;
    return;
  }
  const tick0 = sim.tick;
  sim.advance((now - last) / 1000, 60);
  last = now;
  // 世界が1tickも進まなかったときは、何も送らない。同じ位置の状態を送ると、画面の側が「動かなかった区間」と「ジャンプした区間」を
  // 交互に受け取って、車両がカクカク動いて見える(ゲームの速さを 0.5 にしたあと、100ms ごとのループで2回に1回は進まない)
  if (sim.tick === tick0) return;
  const t1 = performance.now();
  repl.frame(clients);
  if (++frameN % 5 === 0) repl.structure(clients);
  if (frameN % 10 === 0) repl.misc(clients);
  const t2 = performance.now();
  perf.sim = perf.sim * 0.9 + (t1 - now) * 0.1;
  perf.repl = perf.repl * 0.9 + (t2 - t1) * 0.1;
  perf.loop = perf.loop * 0.9 + (t2 - now) * 0.1;
}
setInterval(() => void saveWorld().catch((e) => console.error('[world] 保存に失敗:', (e as Error).message)), 5 * 60 * 1000);
// 想定外の例外・未処理の失敗でも落ちない(記録して続行)。終了の合図(SIGTERM)のときは保存してから終わる
process.on('uncaughtException', (e) => console.error('[fatal?] 未処理の例外:', e.stack ?? e));
process.on('unhandledRejection', (e) => console.error('[fatal?] 未処理の失敗:', e));
// 切れた接続を見つける(スマホの回線切替などで黙って切れたままの接続を片付ける)
setInterval(() => {
  for (const ws of wss.clients) {
    const w = ws as typeof ws & { alive?: boolean };
    if (w.alive === false) {
      ws.terminate();
      continue;
    }
    w.alive = false;
    ws.ping();
  }
}, 30000);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    void saveWorld()
      .catch((e) => console.error('[world] 保存に失敗:', (e as Error).message))
      .finally(() => process.exit(0));
  });

server.listen(PORT, () =>
  console.log(`[server] ${ENV_LABEL}(${ENV_NAME}) ${APP_VERSION} http/ws :${PORT} (同時接続の上限 ${MAX_ONLINE}人${accounts.readOnly ? '・アカウントは本稼働側を使用' : ''})`),
);
