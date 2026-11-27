/**
 * A small window to confirm "really do it?" (the browser's built-in confirm is not used because it may not appear on phones and its look does not fit).
 * Returns true for OK, false for Cancel, Esc, or a tap outside. To prevent misclicks, Cancel is initially selected.
 */
import { tr } from '../i18n';

export function confirmDialog(message: string, okLabel: string = tr('撤去する')): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const wrap = document.createElement('div');
    wrap.className = 'confirm-modal';
    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const p = document.createElement('p');
    p.textContent = message;
    const row = document.createElement('div');
    row.className = 'row';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = tr('キャンセル');
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'danger';
    ok.textContent = okLabel;
    row.append(cancel, ok);
    box.append(p, row);
    wrap.append(box);
    const done = (v: boolean) => {
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      prev?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    wrap.addEventListener('pointerdown', (e) => e.target === wrap && done(false));
    document.body.append(wrap);
    cancel.focus();
  });
}
