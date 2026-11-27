// Rivalines portal: log in, then choose whether to play production or the next version.
// The login information (token) is saved under the same localStorage key as the game screen (so after choosing, you can enter as is).
// The language follows the same rule as the game: the saved choice (localStorage `rivalines-lang` or ?lang=) → the browser's languages → English.
(() => {
  const SESSION = 'simulator-multi-session';
  const LAST = 'rivalines-last-env';
  const LANG_KEY = 'rivalines-lang';
  const ENVS = ['live', 'next'];
  const $ = (id) => document.getElementById(id);

  const TEXT = {
    en: {
      tag: 'Build transit. Grow cities. Outplay your rivals.',
      lang: 'Language',
      name: 'Name',
      password: 'Password',
      login: 'Log in',
      register: 'Sign up',
      agree1: 'By signing up, you agree to the ',
      terms: 'Terms of Service',
      agree2: '. ',
      privacy: 'Privacy Policy',
      agree3: ' (no email address or real name is needed).',
      hello: ', which world do you want to play?',
      liveTitle: 'Live',
      liveDesc: 'The world everyone plays in. Your company and records are kept.',
      liveGo: 'Play live',
      nextTitle: 'Next version',
      beta: 'Test',
      nextDesc1: 'A world to try new features early. ',
      nextDesc2: 'Data may be erased without notice',
      nextDesc3: ' (the live world is not affected).',
      nextGo: 'Try the next version',
      shared: 'Your account is shared, and your company data is separate for each world. You can choose again anytime from "Choose world" in the game.',
      logout: 'Log out',
      licenses: 'Licenses',
      aboutTitle: 'What is Rivalines?',
      aboutP1:
        'Rivalines is a free multiplayer transit and city-building game that runs in your browser. Lay roads and railways, open bus, train and air routes, and watch towns grow around your stations — while other players do the same in the same world.',
      feat1: '<b>Build a network:</b> roads, tracks, signals, stations, depots and airports, with timetables and routes you design.',
      feat2: '<b>Grow towns:</b> good service brings passengers, new buildings and bigger cities.',
      feat3: '<b>Run a company:</b> earn fares, build hotels, malls and stadiums, take loans, buy rivals and watch your share price.',
      feat4: '<b>Compete live:</b> one shared world with rankings, auctions, partnerships and chat.',
      feat5: '<b>No install, no email:</b> play on a PC or phone — sign up with just a name and password.',
      aboutP2: 'Available in English and Japanese. All names in the game are fictional.',
      checking: 'Checking…',
      down: '● Down (please try again in a little while)',
      up: '● Running',
      online: (n, max) => `Online ${n}${max ? '/' + max : ''}`,
      gameDate: (d) => `In-game ${d}`,
      version: (v) => `Version ${v}`,
      badResponse: 'The server response was not valid',
      failed: 'Failed.',
      noConnect: 'Cannot connect to the server.',
    },
    ja: {
      tag: '路線を引いて街を育て、ライバル会社と競う',
      lang: '言語',
      name: '名前',
      password: 'パスワード',
      login: 'ログイン',
      register: '新規登録',
      agree1: '新規登録すると、',
      terms: '利用規約',
      agree2: 'に同意したものとみなします。',
      privacy: 'プライバシーポリシー',
      agree3: '(メールアドレスや本名は不要です)。',
      hello: ' さん、どちらの世界で遊びますか?',
      liveTitle: '本稼働',
      liveDesc: 'みんなが遊んでいる世界です。あなたの会社と記録は保存され続けます。',
      liveGo: '本稼働で遊ぶ',
      nextTitle: '次期バージョン',
      beta: 'テスト',
      nextDesc1: '新しい機能を先に試せる世界です。',
      nextDesc2: 'データは予告なく消えます',
      nextDesc3: '(消えても本稼働には影響しません)。',
      nextGo: '次期バージョンを試す',
      shared: 'アカウントは共通で、会社のデータは世界ごとに別です。ゲームの中の「🌐 世界を選ぶ」から、いつでも選び直せます。',
      logout: 'ログアウト',
      licenses: 'ライセンス',
      aboutTitle: 'Rivalines とは',
      aboutP1:
        'Rivalines は、ブラウザで遊べる、無料のマルチプレイの交通・街づくりゲームです。道路と線路を敷き、バス・電車・飛行機の路線を開いて、駅のまわりに街が育つのを見守ります。同じ世界で、ほかのプレイヤーも同じことをしています。',
      feat1: '<b>交通網をつくる:</b> 道路・線路・信号・駅・車両基地・空港。時刻表と路線は自分で設計します。',
      feat2: '<b>街を育てる:</b> よい運行は乗客を呼び、新しい建物とより大きな街を生みます。',
      feat3: '<b>会社を経営する:</b> 運賃を稼ぎ、ホテル・モール・スタジアムを建て、融資を受け、競合会社を買収し、株価を見守ります。',
      feat4: '<b>リアルタイムで競う:</b> ランキング・競り・提携・チャットのある、ひとつの共有の世界。',
      feat5: '<b>インストール不要・メール不要:</b> パソコンでもスマホでも。名前とパスワードだけで登録できます。',
      aboutP2: '英語と日本語で遊べます。ゲーム内の名称は、すべて架空のものです。',
      checking: '確認中…',
      down: '● 停止中(しばらくしてからお試しください)',
      up: '● 稼働中',
      online: (n, max) => `オンライン ${n}${max ? '/' + max : ''}人`,
      gameDate: (d) => `ゲーム内 ${d}`,
      version: (v) => `版 ${v}`,
      badResponse: 'サーバーの応答が正しくありません',
      failed: '失敗しました',
      noConnect: 'サーバーに接続できません',
    },
  };
  const NAMES = { en: 'English', ja: '日本語' };

  const pick = () => {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && TEXT[q]) return q;
    let saved = null;
    try {
      saved = localStorage.getItem(LANG_KEY);
    } catch {
      /* the choice just cannot be saved */
    }
    if (saved && TEXT[saved]) return saved;
    for (const l of navigator.languages || [navigator.language || '']) {
      const base = String(l).toLowerCase().split('-')[0];
      if (TEXT[base]) return base;
    }
    return 'en';
  };
  let lang = pick();
  const t = (k, ...a) => {
    const v = TEXT[lang][k] ?? TEXT.en[k];
    return typeof v === 'function' ? v(...a) : v;
  };

  function applyDom() {
    document.documentElement.lang = lang;
    // The texts are fixed strings written in this file (not user input), so they can contain simple tags such as <b>
    for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
    for (const a of document.querySelectorAll('a[data-legal]')) a.href = lang === 'ja' ? `./${a.dataset.legal}.html` : `./${a.dataset.legal}.en.html`;
    $('lang').value = lang;
  }
  for (const c of Object.keys(TEXT)) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = NAMES[c];
    $('lang').appendChild(o);
  }
  $('lang').addEventListener('change', () => {
    lang = $('lang').value;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* the choice just cannot be saved */
    }
    applyDom();
    if (!$('choose').hidden) void refresh();
  });

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
      if (!el.textContent) el.textContent = t('checking');
      const s = await status(env);
      el.textContent = '';
      const badge = document.createElement('span');
      if (!s) {
        badge.className = 'ng';
        badge.textContent = t('down');
        el.appendChild(badge);
        continue;
      }
      badge.className = 'ok';
      badge.textContent = t('up');
      el.appendChild(badge);
      const info = [];
      if (typeof s.online === 'number') info.push(t('online', s.online, s.maxOnline));
      if (s.date) info.push(t('gameDate', s.date));
      if (s.env && s.env.version && s.env.version !== 'dev') info.push(t('version', s.env.version));
      if (info.length) el.appendChild(document.createTextNode(' ・ ' + info.join(' ・ ')));
    }
  }

  async function auth(kind) {
    $('err').textContent = '';
    for (const b of document.querySelectorAll('#authForm button')) b.disabled = true;
    try {
      // lang: the server returns the reason for a failure in this language
      const body = { name: $('uname').value, password: $('upw').value, lang };
      const r = await fetch(`/api/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ ok: false, reason: t('badResponse') }));
      if (!j.ok) {
        $('err').textContent = j.reason || t('failed');
        return;
      }
      localStorage.setItem(SESSION, JSON.stringify({ token: j.token, name: j.name }));
      $('upw').value = '';
      show();
    } catch {
      $('err').textContent = t('noConnect');
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
  setInterval(() => !$('choose').hidden && refresh(), 15000);
  applyDom();
  show();
})();
