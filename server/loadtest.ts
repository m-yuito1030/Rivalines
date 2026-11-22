/** 負荷試験: N人のボットがログイン→建設→路線→車両購入→視界を動かす。サーバーの tick 処理時間を出す */
import { WebSocket } from 'ws';

const N = Number(process.env.BOTS ?? 100);
const BASE = process.env.BASE ?? 'http://localhost:8099';
const WS = BASE.replace('http', 'ws');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bot(i: number) {
  const name = `bot${i}_${Date.now() % 100000}`;
  const r = (await (await fetch(`${BASE}/api/register`, { method: 'POST', body: JSON.stringify({ name, password: 'botpass1' }) })).json()) as { token: string };
  const ws = new WebSocket(`${WS}/ws?token=${r.token}`);
  let req = 0;
  const waiters = new Map<number, (v: { ok: boolean; id?: number; msg?: string }) => void>();
  let start: { x: number; y: number } | null = null;
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as { type: string; req?: number; res?: { ok: boolean; id?: number }; start?: { x: number; y: number } };
    if (m.type === 'res') waiters.get(m.req!)?.(m.res!);
  });
  await new Promise((res) => ws.on('open', res));
  const cmd = (c: unknown) =>
    new Promise<{ ok: boolean; id?: number; msg?: string }>((res) => {
      const q = ++req;
      waiters.set(q, res);
      ws.send(JSON.stringify({ type: 'cmd', req: q, cmd: c }));
    });
  void start;
  // 各ボットは自分の場所(街から離れた格子)で路線を作る
  const ox = 20000 + (i % 10) * 300;
  const oy = 20000 + Math.floor(i / 10) * 300;
  ws.send(JSON.stringify({ type: 'view', x0: ox - 40, y0: oy - 40, x1: ox + 40, y1: oy + 40 }));
  await sleep(500 + Math.random() * 500);
  await cmd({ t: 'build', tool: 'road', a: { x: ox, y: oy }, b: { x: ox + 30, y: oy } });
  const a = await cmd({ t: 'ensureStop', x: ox + 2, y: oy, kind: 'road' });
  const b = await cmd({ t: 'ensureStop', x: ox + 28, y: oy, kind: 'road' });
  const rt = a.id && b.id ? await cmd({ t: 'routeCreate', stops: [a.id, b.id] }) : { ok: false };
  const dp = await cmd({ t: 'place', tool: 'depot', x: ox + 5, y: oy });
  let veh = 0;
  if (rt.ok && dp.ok) for (let k = 0; k < 3; k++) if ((await cmd({ t: 'buyVehicle', routeId: rt.id, modelId: 'bus-s', cars: 1 })).ok) veh++;
  // 視界を揺らして配信を発生させる
  const timer = setInterval(() => ws.send(JSON.stringify({ type: 'view', x0: ox - 40 + Math.random() * 20, y0: oy - 40, x1: ox + 40, y1: oy + 40 })), 500);
  return { ws, timer, veh, ok: !!rt.ok };
}

const t0 = Date.now();
const bots = [];
for (let i = 0; i < N; i++) {
  bots.push(await bot(i));
  if (i % 20 === 19) console.log(`bots ${i + 1} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log(
  'ready',
  bots.filter((b) => b.ok).length,
  '路線 /',
  bots.reduce((s, b) => s + b.veh, 0),
  '車両',
);
for (let k = 0; k < 6; k++) {
  await sleep(5000);
  const s = (await (await fetch(`${BASE}/api/status`)).json()) as { tick: number; online: number; vehicles: number };
  console.log(`tick ${s.tick} online ${s.online} vehicles ${s.vehicles} perf ${JSON.stringify((s as unknown as { perf: unknown }).perf)}`);
}
for (const b of bots) (clearInterval(b.timer), b.ws.close());
process.exit(0);
