const { sleep, register, connect } = require('./lib.js');
const BASE = process.env.BASE2; const N = Number(process.env.N || 60);
const rnd = (n) => Math.floor(Math.random() * n);
const stats = { sample: [], fails: {} };
const fail = (k, m) => { stats.fails[k] = (stats.fails[k] || 0) + 1; if (!stats.fails[k + '_ex']) stats.fails[k + '_ex'] = m; };
async function bot(i, shared) {
  const r = await register(BASE, 'mu' + i + '_' + Math.random().toString(36).slice(2, 6));
  if (!r.token) return { i, err: 'register ' + JSON.stringify(r.error) };
  const c = await connect(BASE, r.token); await sleep(500 + rnd(500));
  const ox = 1500 + (i % 10) * 160, oy = 1500 + Math.floor(i / 10) * 160;
  c.send({ type: 'view', x0: ox - 40, y0: oy - 40, x1: ox + 60, y1: oy + 40 });
  const log = { i, name: r.name, ok: 0, bad: 0 };
  const step = async (k, cmd) => { const x = await c.cmd(cmd, 6000); if (x.ok) log.ok++; else { log.bad++; fail(k, x.msg); } return x; };
  await step('road', { t: 'build', tool: 'road', a: { x: ox, y: oy }, b: { x: ox + 40, y: oy } });
  const a = await step('stopA', { t: 'ensureStop', x: ox + 2, y: oy, kind: 'road' });
  const b = await step('stopB', { t: 'ensureStop', x: ox + 38, y: oy, kind: 'road' });
  const rt = a.ok && b.ok ? await step('route', { t: 'routeCreate', stops: [a.id, b.id] }) : { ok: false };
  // everyone races for the SAME tile with a depot
  if (i === 0) { await c.cmd({ t: 'build', tool: 'road', a: { x: 1400, y: 1400 }, b: { x: 1420, y: 1400 } }); shared.raceReady = true; }
  while (!shared.raceReady) await sleep(20);
  await sleep(300);
  const race = await c.cmd({ t: 'place', tool: 'depot', x: 1405, y: 1400 }, 6000);
  shared.race.push([race.ok, race.msg]);
  const dp = await step('depot', { t: 'place', tool: 'depot', x: ox + 5, y: oy });
  log.veh = 0;
  if (rt.ok && dp.ok) for (let k = 0; k < 3; k++) { const v = await step('vehicle', { t: 'buyVehicle', depotId: dp.id, routeId: rt.id, modelId: 'bus-s', cars: 1 }); if (v.ok) log.veh++; }
  await step('budget', { t: 'fin', op: 'budget-hire', amount: 200000 });
  await step('budget2', { t: 'fin', op: 'budget-ad', amount: 100000 });
  await step('budget3', { t: 'fin', op: 'budget-edu', amount: 50000 });
  if (i % 3 === 0) await step('consult', { t: 'fin', op: 'consult-on' });
  // try to touch a neighbour's route
  if (shared.routes.length) { const other = shared.routes[rnd(shared.routes.length)]; const x = await c.cmd({ t: 'tx', m: 'removeRoute', a: [other.id] }, 4000); if (x.ok && other.owner !== i) { shared.breach.push(i + ' removed ' + other.owner + "'s route"); } }
  if (rt.ok) shared.routes.push({ id: rt.id, owner: i });
  c.send({ type: 'chat', req: 9999, text: 'hello from ' + i });
  log.c = c; return log;
}
(async () => {
  const shared = { race: [], routes: [], breach: [] };
  const mon = setInterval(async () => { try { const s = await (await fetch(BASE + '/api/status')).json(); stats.sample.push([s.online, s.perf.simMs, s.perf.replMs, s.perf.loopMs, s.perf.throttled]); } catch { stats.sample.push('down'); } }, 2000);
  const t0 = Date.now();
  const logs = await Promise.all(Array.from({ length: N }, (_, i) => bot(i, shared)));
  console.log('all bots finished in', Date.now() - t0, 'ms');
  // keep them connected for a while to watch the load
  await sleep(40000);
  clearInterval(mon);
  const errs = logs.filter((l) => l.err);
  const good = logs.filter((l) => !l.err);
  console.log('registered+connected', good.length, '/', N, errs.slice(0, 3));
  console.log('depot race on the same tile: winners =', shared.race.filter((r) => r[0]).length, 'of', shared.race.length, 'sample msgs', JSON.stringify([...new Set(shared.race.map((r) => r[1]))].slice(0, 4)));
  console.log('replMs timeline', JSON.stringify(stats.sample.map((s) => (s === 'down' ? -1 : Math.round(s[2])))));
  console.log('cross-company breaches:', shared.breach.length, shared.breach.slice(0, 3));
  console.log('vehicles bought per bot (min/avg):', Math.min(...good.map((l) => l.veh)), (good.reduce((a, l) => a + l.veh, 0) / good.length).toFixed(2));
  console.log('failures by step:', JSON.stringify(Object.fromEntries(Object.entries(stats.fails).filter(([k]) => !k.endsWith('_ex')))));
  console.log('first failure messages:', JSON.stringify(Object.fromEntries(Object.entries(stats.fails).filter(([k]) => k.endsWith('_ex')))).slice(0, 600));
  // isolation: each bot's company message must hold its own, plausible numbers
  let weird = 0; const cashes = [];
  for (const l of good) { const co = l.c.company; if (!co) { weird++; continue; } cashes.push(co.cash); if (!Number.isFinite(co.cash)) weird++; if (l.c.closed !== null) weird++; }
  console.log('companies seen:', cashes.length, 'cash min/max', Math.min(...cashes), Math.max(...cashes), 'weird', weird);
  const num = stats.sample.filter((s) => s !== 'down');
  const mx = (k) => Math.max(...num.map((s) => s[k]));
  console.log('server samples', num.length, 'down', stats.sample.length - num.length, 'max online', mx(0), 'max simMs', mx(1).toFixed(1), 'max replMs', mx(2).toFixed(1), 'max loopMs', mx(3).toFixed(1), 'throttled', num.some((s) => s[4]));
  process.exit(0);
})();
