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
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
      manual: 'Manual',
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
      regTitle: 'Sign up',
      regLead: 'You only need a name and a password. No email address or real name is needed.',
      regName: 'Name (2-16 characters: letters, digits, _ or -)',
      regPw: 'Password (at least 6 characters)',
      regPw2: 'Password (again)',
      regNote1: 'Your name is visible to other players. Please do not use your real name.',
      regNote2: 'Since you do not register an email address, if you forget your password you will have to contact the operators to get a temporary one.',
      regNote3: 'One account per person.',
      regAgree: 'I agree to the',
      cancel: 'Cancel',
      regGo: 'Create account',
      badName: 'The name must be 2-16 characters (letters, digits, _ or -).',
      shortPw: 'The password must be at least 6 characters.',
      pwMismatch: 'The passwords do not match.',
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
      aboutP2: 'Available in English, Japanese, German and French. All names in the game are fictional.',
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
    de: {
      tag: 'Verkehrsnetze bauen. Städte wachsen lassen. Die Rivalen ausstechen.',
      lang: 'Sprache',
      name: 'Name',
      password: 'Passwort',
      login: 'Anmelden',
      register: 'Registrieren',
      terms: 'Nutzungsbedingungen',
      privacy: 'Datenschutzerklärung',
      manual: 'Handbuch',
      hello: ', welche Welt möchtest du spielen?',
      liveTitle: 'Live',
      liveDesc: 'Die Welt, in der alle spielen. Deine Firma und deine Rekorde bleiben erhalten.',
      liveGo: 'Live spielen',
      nextTitle: 'Nächste Version',
      beta: 'Test',
      nextDesc1: 'Eine Welt, um neue Funktionen früh auszuprobieren. ',
      nextDesc2: 'Daten können ohne Vorankündigung gelöscht werden',
      nextDesc3: ' (die Live-Welt ist davon nicht betroffen).',
      nextGo: 'Nächste Version ausprobieren',
      shared: 'Dein Konto gilt für beide Welten, die Firmendaten sind je Welt getrennt. Im Spiel kannst du jederzeit über „Welt wechseln“ neu wählen.',
      regTitle: 'Registrieren',
      regLead: 'Du brauchst nur einen Namen und ein Passwort. E-Mail-Adresse und echter Name sind nicht nötig.',
      regName: 'Name (2–16 Zeichen: Buchstaben, Ziffern, _ oder -)',
      regPw: 'Passwort (mindestens 6 Zeichen)',
      regPw2: 'Passwort (wiederholen)',
      regNote1: 'Dein Name ist für andere Spieler sichtbar. Bitte verwende nicht deinen echten Namen.',
      regNote2: 'Da du keine E-Mail-Adresse angibst, musst du dich bei einem vergessenen Passwort an den Betreiber wenden, um ein vorläufiges Passwort zu erhalten.',
      regNote3: 'Ein Konto pro Person.',
      regAgree: 'Ich stimme zu:',
      cancel: 'Abbrechen',
      regGo: 'Konto erstellen',
      badName: 'Der Name muss 2–16 Zeichen lang sein (Buchstaben, Ziffern, _ oder -).',
      shortPw: 'Das Passwort muss mindestens 6 Zeichen lang sein.',
      pwMismatch: 'Die Passwörter stimmen nicht überein.',
      logout: 'Abmelden',
      licenses: 'Lizenzen',
      aboutTitle: 'Was ist Rivalines?',
      aboutP1:
        'Rivalines ist ein kostenloses Multiplayer-Spiel im Browser rund um Verkehr und Stadtbau. Verlege Straßen und Schienen, eröffne Bus-, Bahn- und Fluglinien und sieh zu, wie Städte um deine Bahnhöfe wachsen – während andere Spieler in derselben Welt dasselbe tun.',
      feat1: '<b>Netz bauen:</b> Straßen, Gleise, Signale, Bahnhöfe, Depots und Flughäfen, mit Fahrplänen und Linien nach deinem Entwurf.',
      feat2: '<b>Städte wachsen lassen:</b> Gute Verbindungen bringen Fahrgäste, neue Gebäude und größere Städte.',
      feat3: '<b>Eine Firma führen:</b> Fahrgeld verdienen, Hotels, Einkaufszentren und Stadien bauen, Kredite aufnehmen, Rivalen kaufen und den Aktienkurs im Blick behalten.',
      feat4: '<b>Live konkurrieren:</b> eine gemeinsame Welt mit Ranglisten, Auktionen, Partnerschaften und Chat.',
      feat5: '<b>Keine Installation, keine E-Mail:</b> auf PC oder Handy spielen – Registrierung nur mit Name und Passwort.',
      aboutP2: 'Verfügbar auf Englisch, Japanisch, Deutsch und Französisch. Alle Namen im Spiel sind frei erfunden.',
      checking: 'Wird geprüft …',
      down: '● Nicht erreichbar (bitte in Kürze erneut versuchen)',
      up: '● Läuft',
      online: (n, max) => `Online ${n}${max ? '/' + max : ''}`,
      gameDate: (d) => `Im Spiel ${d}`,
      version: (v) => `Version ${v}`,
      badResponse: 'Die Antwort des Servers war ungültig',
      failed: 'Fehlgeschlagen.',
      noConnect: 'Verbindung zum Server nicht möglich.',
    },
    fr: {
      tag: 'Construisez des réseaux. Faites grandir les villes. Battez vos rivaux.',
      lang: 'Langue',
      name: 'Nom',
      password: 'Mot de passe',
      login: 'Se connecter',
      register: "S'inscrire",
      terms: "Conditions d'utilisation",
      privacy: 'Politique de confidentialité',
      manual: 'Manuel',
      hello: ', à quel monde voulez-vous jouer ?',
      liveTitle: 'En ligne',
      liveDesc: 'Le monde où tout le monde joue. Votre entreprise et vos records sont conservés.',
      liveGo: 'Jouer en ligne',
      nextTitle: 'Prochaine version',
      beta: 'Test',
      nextDesc1: 'Un monde pour essayer les nouveautés en avance. ',
      nextDesc2: 'Les données peuvent être effacées sans préavis',
      nextDesc3: " (le monde en ligne n'est pas touché).",
      nextGo: 'Essayer la prochaine version',
      shared: 'Votre compte est commun, et les données de votre entreprise sont séparées pour chaque monde. Vous pouvez rechoisir à tout moment avec « Changer de monde » dans le jeu.',
      regTitle: "S'inscrire",
      regLead: "Un nom et un mot de passe suffisent. Aucune adresse e-mail ni vrai nom n'est nécessaire.",
      regName: 'Nom (2 à 16 caractères : lettres, chiffres, _ ou -)',
      regPw: 'Mot de passe (6 caractères minimum)',
      regPw2: 'Mot de passe (confirmation)',
      regNote1: "Votre nom est visible des autres joueurs. N'utilisez pas votre vrai nom.",
      regNote2: "Comme vous n'enregistrez pas d'adresse e-mail, si vous oubliez votre mot de passe, vous devrez contacter les opérateurs pour en obtenir un provisoire.",
      regNote3: 'Un compte par personne.',
      regAgree: "J'accepte les",
      cancel: 'Annuler',
      regGo: 'Créer le compte',
      badName: 'Le nom doit comporter 2 à 16 caractères (lettres, chiffres, _ ou -).',
      shortPw: 'Le mot de passe doit comporter au moins 6 caractères.',
      pwMismatch: 'Les mots de passe ne correspondent pas.',
      logout: 'Se déconnecter',
      licenses: 'Licences',
      aboutTitle: "Qu'est-ce que Rivalines ?",
      aboutP1:
        "Rivalines est un jeu multijoueur gratuit de transports et de construction de villes, qui se joue dans le navigateur. Posez routes et voies ferrées, ouvrez des lignes de bus, de train et d'avion, et regardez les villes grandir autour de vos gares — pendant que d'autres joueurs font de même dans le même monde.",
      feat1: '<b>Bâtir un réseau :</b> routes, voies, signaux, gares, dépôts et aéroports, avec les horaires et les lignes que vous concevez.',
      feat2: '<b>Faire grandir les villes :</b> un bon service amène des voyageurs, de nouveaux bâtiments et de plus grandes villes.',
      feat3: "<b>Diriger une entreprise :</b> encaissez les recettes, construisez hôtels, centres commerciaux et stades, empruntez, rachetez vos rivaux et surveillez votre cours.",
      feat4: '<b>Se mesurer en direct :</b> un monde partagé avec classements, enchères, partenariats et chat.',
      feat5: "<b>Sans installation, sans e-mail :</b> jouez sur PC ou mobile — inscription avec un simple nom et un mot de passe.",
      aboutP2: "Disponible en anglais, japonais, allemand et français. Tous les noms du jeu sont fictifs.",
      checking: 'Vérification…',
      down: '● Hors service (réessayez dans un moment)',
      up: '● En service',
      online: (n, max) => `En ligne ${n}${max ? '/' + max : ''}`,
      gameDate: (d) => `Dans le jeu ${d}`,
      version: (v) => `Version ${v}`,
      badResponse: "La réponse du serveur n'est pas valide",
      failed: 'Échec.',
      noConnect: 'Impossible de se connecter au serveur.',
    },
    ja: {
      tag: '路線を引いて街を育て、ライバル会社と競う',
      lang: '言語',
      name: '名前',
      password: 'パスワード',
      login: 'ログイン',
      register: '新規登録',
      terms: '利用規約',
      privacy: 'プライバシーポリシー',
      manual: 'マニュアル',
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
      regTitle: '新規登録',
      regLead: '名前とパスワードだけで登録できます。メールアドレスや本名は要りません。',
      regName: '名前(2〜16文字。文字・数字・_ -)',
      regPw: 'パスワード(6文字以上)',
      regPw2: 'パスワード(もう一度)',
      regNote1: '名前は、ほかのプレイヤーにも見えます。本名は使わないでください。',
      regNote2: 'メールアドレスを登録しないので、パスワードを忘れたときは、運営に連絡して、仮のパスワードを出してもらうことになります。',
      regNote3: 'アカウントは、1人につき1つです。',
      regAgree: '次に同意します:',
      cancel: 'キャンセル',
      regGo: '登録する',
      badName: '名前は2〜16文字(文字・数字・_-)です',
      shortPw: 'パスワードは6文字以上です',
      pwMismatch: 'パスワードが一致しません',
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
  const NAMES = { en: 'English', ja: '日本語', de: 'Deutsch', fr: 'Français' };

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

  /** Log in or register. Returns true on success. `errEl` is where a failure is shown (the login form, or the sign-up window) */
  async function auth(kind, name, password, errEl) {
    errEl.textContent = '';
    for (const b of document.querySelectorAll('#authForm button, #regForm button')) b.disabled = true;
    try {
      // lang: the server returns the reason for a failure in this language
      const body = { name, password, lang };
      const r = await fetch(`/api/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ ok: false, reason: t('badResponse') }));
      if (!j.ok) {
        errEl.textContent = j.reason || t('failed');
        return false;
      }
      localStorage.setItem(SESSION, JSON.stringify({ token: j.token, name: j.name }));
      $('upw').value = '';
      show();
      return true;
    } catch {
      errEl.textContent = t('noConnect');
      return false;
    } finally {
      for (const b of document.querySelectorAll('#authForm button, #regForm button')) b.disabled = false;
      $('regGo').disabled = !$('regAgree').checked;
    }
  }

  // The sign-up window: its own fields, notes, and agreement (separate from the login form)
  const NAME_OK = /^[\p{L}\p{N}_-]{2,16}$/u;
  const closeReg = () => {
    $('regModal').hidden = true;
    for (const id of ['regPwIn', 'regPw2In']) $(id).value = '';
    $('regErr').textContent = '';
  };
  $('register').addEventListener('click', () => {
    $('err').textContent = '';
    $('regNameIn').value = $('uname').value;
    $('regAgree').checked = false;
    $('regGo').disabled = true;
    $('regModal').hidden = false;
    ($('regNameIn').value ? $('regPwIn') : $('regNameIn')).focus();
  });
  $('regCancel').addEventListener('click', closeReg);
  $('regAgree').addEventListener('change', () => ($('regGo').disabled = !$('regAgree').checked));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('regModal').hidden) closeReg();
  });
  $('regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('regNameIn').value.trim();
    const pw = $('regPwIn').value;
    const err = $('regErr');
    if (!NAME_OK.test(name)) return void (err.textContent = t('badName'));
    if (pw.length < 6) return void (err.textContent = t('shortPw'));
    if (pw !== $('regPw2In').value) return void (err.textContent = t('pwMismatch'));
    if (await auth('register', name, pw, err)) closeReg();
  });

  $('authForm').addEventListener('submit', (e) => {
    e.preventDefault();
    void auth('login', $('uname').value, $('upw').value, $('err'));
  });
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
