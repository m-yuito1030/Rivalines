const { WebSocket } = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (base, path, body, headers = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
async function register(base, name, password = 'secret12') {
  const r = await post(base, '/api/register', { name, password });
  return r.j && r.j.token ? { token: r.j.token, name } : { error: r };
}
/** A connected client: cmd() resolves with the response; keeps the latest state messages */
async function connect(base, token) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?token=' + token);
  const c = { ws, req: 0, waiters: new Map(), company: null, id: 0, closed: null, msgs: 0 };
  ws.on('message', (d) => {
    c.msgs++;
    let m; try { m = JSON.parse(String(d)); } catch { return; }
    if (m.type === 'res') c.waiters.get(m.req)?.(m.res);
    if (m.type === 'init') c.id = m.id;
    if (m.company) c.company = m.company;
  });
  ws.on('close', (code) => (c.closed = code));
  ws.on('error', () => {});
  await new Promise((res) => { ws.on('open', res); ws.on('error', res); ws.on('close', res); });
  c.cmd = (cmd, ms = 4000) => new Promise((res) => {
    const q = ++c.req; c.waiters.set(q, res);
    if (ws.readyState !== 1) return res({ ok: false, msg: 'closed' });
    ws.send(JSON.stringify({ type: 'cmd', req: q, cmd }));
    setTimeout(() => res({ ok: false, msg: 'timeout' }), ms);
  });
  c.send = (m) => ws.readyState === 1 && ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  return c;
}
module.exports = { sleep, post, register, connect, WebSocket };
