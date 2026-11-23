// Rivalines のポータル: ログインして、本稼働と次期バージョンのどちらで遊ぶかを選ぶ。
// ログインの情報(トークン)は、ゲーム画面と同じ localStorage の鍵に保存する(選んだあと、そのまま入れる)。
(() => {
  const SESSION = 'simulator-multi-session';
  const LAST = 'rivalines-last-env';
  const ENVS = ['live', 'next'];
  const $ = (id) => document.getElementById(id);

  const saved = () => {
    try {
      return JSON.parse(localStorage.getItem(SESSION) || 'null');
    } catch {
      return null;
    }
  };

  function show() {
    const s = saved();
    $('auth').hidden = !!s;
    $('choose').hidden = !s;
    if (s) {
      $('who').textContent = s.name;
      const last = localStorage.getItem(LAST);
      for (const e of ENVS) $('card-' + e).classList.toggle('last', e === last);
      refresh();
    }
  }

  async function status(env) {
    try {
      const r = await fetch(`/${env}/api/status`, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }

  async function refresh() {
    for (const env of ENVS) {
      const el = $('stat-' + env);
      const s = await status(env);
      el.textContent = '';
      const badge = document.createElement('span');
      if (!s) {
        badge.className = 'ng';
        badge.textContent = '● 停止中(しばらくしてからお試しください)';
        el.appendChild(badge);
        continue;
      }
      badge.className = 'ok';
      badge.textContent = '● 稼働中';
      el.appendChild(badge);
      const info = [];
      if (typeof s.online === 'number') info.push(`オンライン ${s.online}${s.maxOnline ? '/' + s.maxOnline : ''}人`);
      if (s.date) info.push(`ゲーム内 ${s.date}`);
      if (s.env && s.env.version && s.env.version !== 'dev') info.push(`版 ${s.env.version}`);
      if (info.length) el.appendChild(document.createTextNode(' ・ ' + info.join(' ・ ')));
    }
  }

  async function auth(kind) {
    $('err').textContent = '';
    for (const b of document.querySelectorAll('#authForm button')) b.disabled = true;
    try {
      const body = { name: $('uname').value, password: $('upw').value };
      if (kind === 'register') body.code = $('ucode').value;
      const r = await fetch(`/api/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ ok: false, reason: 'サーバーの応答が正しくありません' }));
      if (!j.ok) {
        $('err').textContent = j.reason || '失敗しました';
        return;
      }
      localStorage.setItem(SESSION, JSON.stringify({ token: j.token, name: j.name }));
      $('upw').value = '';
      show();
    } catch {
      $('err').textContent = 'サーバーに接続できません';
    } finally {
      for (const b of document.querySelectorAll('#authForm button')) b.disabled = false;
    }
  }

  $('authForm').addEventListener('submit', (e) => {
    e.preventDefault();
    void auth('login');
  });
  $('register').addEventListener('click', () => void auth('register'));
  $('logout').addEventListener('click', () => {
    localStorage.removeItem(SESSION);
    show();
  });
  for (const b of document.querySelectorAll('[data-env]')) {
    b.addEventListener('click', () => {
      localStorage.setItem(LAST, b.dataset.env);
      location.href = `/${b.dataset.env}/`;
    });
  }
  // 招待コードが必要なサーバーでは、入力欄を出す
  status('live').then((s) => {
    if (s && s.invite) $('codeRow').hidden = false;
  });
  setInterval(() => !$('choose').hidden && refresh(), 15000);
  show();
})();
