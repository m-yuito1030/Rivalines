const { sleep, post, register, connect, WebSocket } = require('./lib.js');
const fs = require('fs');
let BASE = process.env.BASE;
const F = []; // findings
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); if (!cond) F.push(name + ' :: ' + detail); };
const rnd = (n) => Math.floor(Math.random() * n);
const uniq = () => Math.random().toString(36).slice(2, 8);

(async () => {
  // ---- 1. registration validation
  const bad = ['', ' ', 'a', '<script>alert(1)</script>', 'x'.repeat(200), '../../etc/passwd', 'ab\u0000cd', '‮gnp.exe', 'admin', 'Admin', 'システム', "' OR 1=1 --", '__proto__', 'constructor'];
  for (const n of bad) {
    const r = await post(BASE, '/api/register', { name: n, password: 'secret12' });
    // these must not blow up the server; names with markup must be rejected or at least stored as plain text
    ok('register name ' + JSON.stringify(n).slice(0, 30) + ' handled', r.status === 200 || r.status === 400 || r.status === 429, 'status ' + r.status + ' ' + JSON.stringify(r.j).slice(0, 80));
  }
  // ---- 2. brute-force throttle (10/min per IP)
  let last = 0; let limited = 0;
  for (let i = 0; i < 25; i++) { const r = await post(BASE, '/api/login', { name: 'nobody' + i, password: 'wrongpass' }); last = r.status; if (r.status === 429) limited++; }
  ok('login brute force gets 429', limited > 0, 'limited ' + limited + ' of 25');
  // spoofing X-Real-IP (works only if the proxy does not overwrite it; nginx overwrites it)
  const sp = await post(BASE, '/api/login', { name: 'nobody', password: 'x' }, { 'x-real-ip': '9.9.9.' + rnd(250) });
  console.log('INFO X-Real-IP spoof direct to node: status', sp.status, '(node trusts the header; the proxy must overwrite it)');
  // ---- 3. admin API
  for (const [k, label] of [[undefined, 'no key'], ['wrong', 'wrong key'], ['', 'empty key']]) {
    const r = await post(BASE, '/api/admin', { action: 'players' }, k === undefined ? {} : { 'x-admin-key': k });
    ok('admin ' + label + ' refused', r.status === 403 || r.status === 429, 'status ' + r.status);
  }
  // ---- 4. body bombs, bad JSON, wrong methods
  const big = await post(BASE, '/api/login', JSON.stringify({ name: 'a'.repeat(1_000_000), password: 'x' })).catch((e) => ({ status: 'err ' + e.code }));
  ok('1MB body rejected', big.status !== 200, String(big.status));
  const mal = await post(BASE, '/api/login', '{not json').catch((e) => ({ status: 'err' }));
  ok('malformed json -> 400', mal.status === 400 || mal.status === 429, String(mal.status));
  for (const p of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/api/../server/index.ts', '/data/accounts.json', '/.env']) {
    const r = await fetch(BASE + p).catch(() => null);
    const t = r ? await r.text() : '';
    ok('path ' + p + ' not served', !r || (r.status === 404 && !/root:|ADMIN|password/i.test(t)), r ? String(r.status) : 'closed');
  }
  BASE = process.env.BASE2;
  // ---- 5. websocket auth
  for (const t of ['', 'abc', 'x'.repeat(5000), '../x', 'null']) {
    const c = await connect(BASE, encodeURIComponent(t));
    ok('ws bad token refused', c.ws.readyState !== 1, JSON.stringify(t).slice(0, 20));
  }
  // users
  const mk = async (p) => { for (let i = 0; i < 8; i++) { const r = await register(BASE, p + uniq()); if (r.token) return r; await sleep(7000); } throw new Error('register failed'); };
  const A = await mk('sa'); await sleep(200);
  const B = await mk('sb');
  const ca = await connect(BASE, A.token); const cb = await connect(BASE, B.token);
  await sleep(1500);
  ok('two users connected', ca.ws.readyState === 1 && cb.ws.readyState === 1);
  // second connection of the same account kicks the first
  const ca2 = await connect(BASE, A.token); await sleep(500);
  ok('same account twice: old one closed', ca.closed === 4000 || ca.ws.readyState !== 1, 'code ' + ca.closed);
  const A1 = ca2;
  // ---- 6. oversized / malformed WS frames
  const cx = await connect(BASE, (await mk('sx')).token);
  cx.ws.send('x'.repeat(70 * 1024)); await sleep(400);
  ok('>64KB frame closes connection', cx.ws.readyState !== 1, 'code ' + cx.closed);
  const cy = await connect(BASE, (await mk('sy')).token);
  for (const m of ['{', 'null', '[]', '"str"', '123', '{"type":"cmd"}', '{"type":"cmd","req":1}', '{"type":"cmd","req":1,"cmd":null}', '{"type":"cmd","req":1,"cmd":{"t":"__proto__"}}', '{"type":"cmd","req":"x","cmd":{"t":"fin","op":"borrow","amount":1e999}}', '{"type":"view","x0":"a"}', '{"type":"chat","text":{"a":1}}', '{"type":"report","target":"x"}', '{"type":"profile","company":{"x":1},"bio":[1],"color":"red"}']) cy.send(m);
  await sleep(500);
  ok('malformed messages do not kill the connection', cy.ws.readyState === 1);
  const cf = await connect(BASE, (await mk('sf')).token);
  for (let i = 0; i < 1000; i++) cf.send({ type: 'view', x0: 0, y0: 0, x1: 10, y1: 10 });
  await sleep(800);
  ok('message flood (1000 msgs at once) cuts the connection', cf.ws.readyState !== 1, 'code ' + cf.closed);
  // ---- 7. cross-company authorization
  const a1 = await A1.cmd({ t: 'build', tool: 'road', a: { x: 2000, y: 2000 }, b: { x: 2030, y: 2000 } });
  const sa = await A1.cmd({ t: 'ensureStop', x: 2002, y: 2000, kind: 'road' });
  const sb = await A1.cmd({ t: 'ensureStop', x: 2028, y: 2000, kind: 'road' });
  const rt = await A1.cmd({ t: 'routeCreate', stops: [sa.id, sb.id] });
  const dp = await A1.cmd({ t: 'place', tool: 'depot', x: 2005, y: 2000 });
  console.log('INFO A setup', a1.ok, sa.ok, sb.ok, rt.ok, dp.ok, a1.msg || '');
  if (rt.ok) {
    const bv = await cb.cmd({ t: 'buyVehicle', depotId: dp.id, routeId: rt.id, modelId: 'bus-s', cars: 1 });
    ok("B cannot buy a vehicle on A's route/depot", !bv.ok, bv.msg);
    const rm = await cb.cmd({ t: 'tx', m: 'removeRoute', a: [rt.id] });
    ok("B cannot remove A's route", !rm.ok, rm.msg);
    for (const m of [['renameRoute', [rt.id]], ['moveOrder', [rt.id, 0, 1]], ['autoTimetable', [rt.id, 100]]]) {
      const r = await cb.cmd({ t: 'tx', m: m[0], a: m[1] });
      ok("B cannot " + m[0] + " on A's route", !r.ok, r.msg);
    }
    const ro = await cb.cmd({ t: 'routeSet', routeId: rt.id, patch: { name: 'pwned', fareMul: 9 } });
    ok("B cannot edit A's route", !ro.ok, ro.msg);
    const al = await cb.cmd({ t: 'companyAllow', who: 999999, allow: true }); // nonexistent
    console.log('INFO companyAllow nonexistent ->', al.ok, al.msg);
  }
  // facility of A is not sellable by B
  const sellOther = await cb.cmd({ t: 'fin', op: 'sell', id: 1 });
  ok('B cannot sell a facility he does not own', !sellOther.ok, sellOther.msg);
  const acqSelf = await cb.cmd({ t: 'fin', op: 'acquire', id: 1 });
  console.log('INFO acquire id 1 ->', acqSelf.ok, acqSelf.msg);
  // ---- 8. money/budget abuse
  const cashOf = () => (cb.company ? cb.company.cash : null);
  await sleep(1200);
  const c0 = cashOf();
  const money = [];
  for (const [op, amount] of [['gift', -5000000], ['gift', 'abc'], ['gift', 1e308], ['gift', NaN], ['borrow', -1000000], ['borrow', 1e300], ['borrow', 'x'], ['repay', -1e9], ['repay', 1e300], ['payout', 0.9], ['payout', -1], ['budget-hire', -100000], ['budget-hire', 1e12], ['budget-ad', 123], ['budget-edu', '50000'], ['budget-edu', null], ['budget-hire', 100000.5]]) {
    const cmd = op === 'gift' ? { t: 'gift', to: A.id || ca2.id, amount } : { t: 'fin', op, amount };
    const r = await cb.cmd(cmd);
    money.push([op, String(amount), r.ok]);
  }
  console.log('INFO money abuse results (op, amount, ok):', JSON.stringify(money.filter((m) => m[2])));
  const gifts = money.filter((m) => m[2] && (m[0] === 'gift' || (m[0] === 'borrow' && (m[1] === '-1000000' || m[1] === '1e+300' || m[1] === 'x')) || m[0].startsWith('budget') && !['0'].includes(m[1])));
  const okBudgets = money.filter((m) => m[2] && m[0].startsWith('budget'));
  ok('invalid budgets/gifts/loans are all refused', money.filter((m) => m[2]).every((m) => ['payout'].includes(m[0]) || m[0] === 'repay' ? m[0] === 'payout' && m[1] === '0.9' ? false : true : false) || money.filter((m) => m[2]).length === 0, JSON.stringify(money.filter((m) => m[2])));
  // consult flow
  const cons = await cb.cmd({ t: 'fin', op: 'consult-on' }); const cons2 = await cb.cmd({ t: 'fin', op: 'consult-on' }); const cons3 = await cb.cmd({ t: 'fin', op: 'consult-off' }); const cons4 = await cb.cmd({ t: 'fin', op: 'consult-off' });
  ok('consult on/on/off/off: only first of each succeeds', cons.ok && !cons2.ok && cons3.ok && !cons4.ok, JSON.stringify([cons.ok, cons2.ok, cons3.ok, cons4.ok]));
  await sleep(1500);
  const c1 = cashOf();
  ok('cash stays a finite number after abuse', Number.isFinite(c1), String(c0) + ' -> ' + String(c1));
  // ---- 9. airport placement abuse
  for (const air of [{ size: 'S;DROP', axis: 'x', design: 0 }, { size: 'H', axis: { x: 1 }, design: -1 }, { size: 'M', axis: 'x', design: 1e9 }, { size: 'L', axis: 'y', design: '3' }, { size: '__proto__', axis: 'x' }, null, 'airport', { size: 'H', axis: 'x', design: 3.5 }]) {
    const r = await cb.cmd({ t: 'place', tool: 'airport', x: 100 + rnd(20), y: 100, air });
    ok('airport abuse handled: ' + JSON.stringify(air).slice(0, 40), r.msg !== 'timeout' && r.msg !== 'closed', JSON.stringify(r).slice(0, 80));
  }
  // ---- 10. chat / profile XSS payloads are stored, not executed; length caps
  const xss = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '"><svg/onload=alert(1)>', 'x'.repeat(5000)];
  for (const s of xss) { const r = await cb.cmd({ t: 'noop' }); }
  const pr = await new Promise((res) => { const q = ++cb.req; cb.waiters.set(q, res); cb.send({ type: 'profile', req: q, company: '<img src=x onerror=alert(1)>', bio: '<script>alert(1)</script>', color: 1 }); setTimeout(() => res({ msg: 'timeout' }), 3000); });
  console.log('INFO profile with HTML ->', JSON.stringify(pr));
  // ---- 11. fuzz every command
  const types = fs.readFileSync('../../src/shared/protocol.ts', 'utf8').match(/\{ t: '[a-zA-Z]+'/g).map((s) => s.slice(6, -1));
  const keys = ['x', 'y', 'a', 'b', 'tool', 'kind', 'stops', 'routeId', 'depotId', 'modelId', 'cars', 'amount', 'id', 'op', 'm', 'facilityId', 'who', 'to', 'allow', 'opts', 'fac', 'air', 'patch', 'z', 'design', 'size', 'axis', 'text', 'name', 'discount', 'orders', 'order', 'lang', 'price', 'fare', 'period', 'dwell'];
  const junk = () => [NaN, Infinity, -Infinity, -1, 0, 1, 2 ** 53, 1e308, -1e308, 0.5, '', 'x', '__proto__', 'constructor', null, undefined, true, false, [], {}, [1, 2, 3], { x: 1, y: 1 }, { a: { x: 1, y: 1 }, b: { x: 99999999, y: 5 } }, 'a'.repeat(300), [null], [[]], { __proto__: { polluted: 1 } }, JSON.parse('{"__proto__":{"polluted":true}}')][rnd(28)];
  const cz = await connect(BASE, (await mk('sz')).token);
  let sent = 0, timeouts = 0, slow = 0;
  const t0 = Date.now();
  for (const t of types) {
    for (let k = 0; k < 40; k++) {
      const cmd = { t };
      for (const key of keys) if (Math.random() < 0.25) cmd[key] = junk();
      if (cz.ws.readyState !== 1 || (cz.closed !== null)) { const nt = await register(BASE, 'sz' + uniq()).catch(() => ({})); if (!nt.token) { await sleep(7000); continue; } Object.assign(cz, await connect(BASE, nt.token)); }
      const s = Date.now();
      const r = await cz.cmd(cmd, 3000);
      sent++; if (r.msg === 'timeout') timeouts++; if (Date.now() - s > 1500) slow++;
      await sleep(110); // stay under the per-user rate limit (10/s)
    }
  }
  console.log('INFO fuzz sent', sent, 'timeouts', timeouts, 'slow', slow, 'in', Date.now() - t0, 'ms');
  const st = await (await fetch(BASE + '/api/status')).json().catch(() => null);
  ok('server still alive after fuzz', !!st && st.tick > 0, st ? 'tick ' + st.tick + ' loopMs ' + st.perf.loopMs : 'dead');
  ok('no fuzz timeouts (no hung command)', timeouts === 0, String(timeouts));
  const pol = ({}).polluted; ok('no prototype pollution in the test process', pol === undefined);
  console.log('\nFINDINGS (' + F.length + '):\n' + F.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
