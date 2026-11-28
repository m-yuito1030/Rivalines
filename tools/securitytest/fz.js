const { sleep, register, connect } = require('./lib.js');
const fs = require('fs');
const BASE = process.env.BASE2;
const rnd = (n) => Math.floor(Math.random() * n);
(async () => {
  const types = fs.readFileSync('../../src/shared/protocol.ts', 'utf8').match(/\{ t: '[a-zA-Z]+'/g).map((s) => s.slice(6, -1));
  const keys = ['x', 'y', 'a', 'b', 'tool', 'kind', 'stops', 'routeId', 'depotId', 'modelId', 'cars', 'amount', 'id', 'op', 'm', 'facilityId', 'who', 'to', 'allow', 'opts', 'fac', 'air', 'patch', 'z', 'design', 'size', 'axis', 'text', 'name', 'discount', 'orders', 'order'];
  const junk = () => [NaN, -1, 0, 1, 2 ** 53, 'x', null, undefined, true, [], {}, [1, 2, 3], { x: 1, y: 1 }, { a: { x: 1, y: 1 }, b: { x: 5, y: 5 } }, [null], [[]]][rnd(16)];
  const hits = {};
  let c = null, n = 0;
  for (const t of types) for (let k = 0; k < 150; k++) {
    if (!c || c.closed !== null) { const r = await register(BASE, 'fz' + Math.random().toString(36).slice(2, 8)); c = await connect(BASE, r.token); await sleep(300); }
    const cmd = { t }; for (const key of keys) if (Math.random() < 0.3) cmd[key] = junk();
    const r = await c.cmd(cmd, 2000); n++;
    if (r.msg === 'サーバーエラー') { (hits[t] ??= []).length < 3 && hits[t].push(JSON.stringify(cmd).slice(0, 200)); hits[t].n = (hits[t].n || 0) + 1; }
    await sleep(105);
  }
  console.log('sent', n); for (const [t, v] of Object.entries(hits)) console.log(t, v.n, v);
  process.exit(0);
})();
