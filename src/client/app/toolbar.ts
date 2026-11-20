import type { Tool } from '../ui/tools';

/**
 * ツールバーのドロップダウン(道路・鉄道・地形・施設・メニューなど)。
 * メニューは overflow/backdrop の影響を避けるため body 直下へ移す。
 * 同じ道具(車両基地など)が複数のメニューにあるときは、選んだ側のメニューだけを強調する。
 */
export class Toolbar {
  private readonly menus: { btn: HTMLButtonElement; menu: HTMLElement }[] = [];
  private picked: HTMLElement | null = null;

  constructor() {
    document.querySelectorAll<HTMLElement>('.dd').forEach((dd) => {
      const btn = dd.querySelector<HTMLButtonElement>('.ddbtn')!;
      const menu = dd.querySelector<HTMLElement>('.ddmenu')!;
      document.body.appendChild(menu);
      this.menus.push({ btn, menu });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const was = menu.classList.contains('open');
        this.closeAll();
        if (was) return;
        const r = btn.getBoundingClientRect();
        menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 190))}px`;
        if (r.top > window.innerHeight / 2) {
          menu.style.top = 'auto';
          menu.style.bottom = `${window.innerHeight - r.top + 4}px`;
        } else {
          menu.style.bottom = 'auto';
          menu.style.top = `${r.bottom + 4}px`;
        }
        menu.classList.add('open');
      });
      menu.addEventListener('click', () => {
        this.picked = menu;
        this.closeAll();
      });
    });
    document.addEventListener('click', () => this.closeAll());
  }

  private closeAll(): void {
    this.menus.forEach((m) => m.menu.classList.remove('open'));
  }

  /** 選んでいる道具を強調する(ボタンのラベルも選んだ道具の名前にする) */
  highlight(t: Tool): void {
    const has = this.menus.filter((m) => m.menu.querySelector(`[data-tool="${t}"]`));
    const target = has.find((m) => m.menu === this.picked) ?? has[0]; // 含むメニューのうち、選んだ側(なければ最初)だけ
    for (const { btn, menu } of this.menus) {
      if (btn.dataset.fixed) continue;
      const item = menu === target?.menu ? menu.querySelector<HTMLButtonElement>(`[data-tool="${t}"]`) : null;
      btn.classList.toggle('on', !!item);
      btn.textContent = `${(item ? item.textContent!.replace(/\s*\(.\)$/, '') : btn.dataset.def) ?? ''} ▾`;
    }
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t && (!b.closest('.ddmenu') || b.closest('.ddmenu') === target?.menu)));
  }
}
