import './register.css';
import { lang, tr } from '../i18n';
import { esc } from './dom';

/** Same rule as the server (accounts.ts validName): 2-16 letters, digits, `_` or `-` */
const NAME_OK = /^[\p{L}\p{N}_-]{2,16}$/u;

/** The result of trying to register: ok, or the reason it failed (shown inside the window) */
export interface RegisterOutcome {
  ok: boolean;
  reason?: string;
}

/**
 * The sign-up window, opened by the "Sign up" button on the login screen. Registration has its own fields, notes, and agreement
 * (separate from the login form, so the two are not mixed up). `submit` does the registration; on success the window closes.
 */
export function openRegisterModal(prefillName: string, submit: (name: string, password: string) => Promise<RegisterOutcome>): void {
  const ext = lang() === 'ja' ? '.html' : '.en.html';
  const prev = document.activeElement as HTMLElement | null;
  const wrap = document.createElement('div');
  wrap.className = 'register-modal';
  wrap.innerHTML = `<form class="box" role="dialog" aria-modal="true" aria-labelledby="regTitle" autocomplete="off">
    <h2 id="regTitle">${esc(tr('新規登録'))}</h2>
    <p>${esc(tr('名前とパスワードだけで登録できます。メールアドレスや本名は要りません。'))}</p>
    <label><span>${esc(tr('名前(2〜16文字。文字・数字・_ -)'))}</span><input id="regName" maxlength="16" autocomplete="username" value="${esc(prefillName)}"></label>
    <label><span>${esc(tr('パスワード(6文字以上)'))}</span><input id="regPw" type="password" maxlength="72" autocomplete="new-password"></label>
    <label><span>${esc(tr('パスワード(もう一度)'))}</span><input id="regPw2" type="password" maxlength="72" autocomplete="new-password"></label>
    <ul>
      <li>${esc(tr('名前は、ほかのプレイヤーにも見えます。本名は使わないでください。'))}</li>
      <li>${esc(tr('メールアドレスを登録しないので、パスワードを忘れたときは、運営に連絡して、仮のパスワードを出してもらうことになります。'))}</li>
      <li>${esc(tr('アカウントは、1人につき1つです。'))}</li>
    </ul>
    <label class="agree"><input id="regAgree" type="checkbox"><span>${esc(tr('次に同意します:'))} <a href="./terms${ext}" target="_blank" rel="noopener">${esc(tr('利用規約'))}</a> ・ <a href="./privacy${ext}" target="_blank" rel="noopener">${esc(tr('プライバシーポリシー'))}</a></span></label>
    <p id="regErr" class="err" role="alert"></p>
    <div class="row"><button type="button" id="regCancel">${esc(tr('キャンセル'))}</button><button type="submit" id="regGo" class="primary" disabled>${esc(tr('登録する'))}</button></div>
  </form>`;
  const $ = <T extends HTMLElement>(id: string) => wrap.querySelector<T>(`#${id}`)!;
  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    wrap.remove();
    prev?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  $('regCancel').addEventListener('click', close);
  $<HTMLInputElement>('regAgree').addEventListener('change', () => ($<HTMLButtonElement>('regGo').disabled = !$<HTMLInputElement>('regAgree').checked));
  wrap.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>('regName').value.trim();
    const pw = $<HTMLInputElement>('regPw').value;
    const err = $('regErr');
    err.textContent = '';
    if (!NAME_OK.test(name)) return void (err.textContent = tr('名前は2〜16文字(文字・数字・_-)です'));
    if (pw.length < 6) return void (err.textContent = tr('パスワードは6文字以上です'));
    if (pw !== $<HTMLInputElement>('regPw2').value) return void (err.textContent = tr('パスワードが一致しません'));
    const go = $<HTMLButtonElement>('regGo');
    go.disabled = true;
    void submit(name, pw)
      .then((r) => {
        if (r.ok) return close();
        err.textContent = r.reason ? tr(r.reason) : tr('失敗しました');
        go.disabled = !$<HTMLInputElement>('regAgree').checked;
      })
      .catch((e2: Error) => {
        err.textContent = e2.message;
        go.disabled = !$<HTMLInputElement>('regAgree').checked;
      });
  });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(wrap);
  (prefillName ? $<HTMLInputElement>('regPw') : $<HTMLInputElement>('regName')).focus();
}
