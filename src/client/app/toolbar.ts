import type { Tool } from '../ui/tools';

/**
 * The toolbar dropdowns (road, rail, terrain, facilities, menu, and so on).
 * Menus are moved directly under body to avoid the effects of overflow/backdrop.
 * When the same tool (e.g. a depot) is in several menus, only the menu on the side the player picked is highlighted.
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

  /** Highlight the selected tool (the button label also becomes the selected tool's name) */
  highlight(t: Tool): void {
    const has = this.menus.filter((m) => m.menu.querySelector(`[data-tool="${t}"]`));
    const target = has.find((m) => m.menu === this.picked) ?? has[0]; // of the menus that contain it, only the picked one (the first if none)
    for (const { btn, menu } of this.menus) {
      if (btn.dataset.fixed) continue;
      const item = menu === target?.menu ? menu.querySelector<HTMLButtonElement>(`[data-tool="${t}"]`) : null;
      btn.classList.toggle('on', !!item);
      btn.textContent = `${(item ? item.textContent!.replace(/\s*\(.\)$/, '') : btn.dataset.def) ?? ''} ▾`;
    }
    document
      .querySelectorAll<HTMLButtonElement>('[data-tool]')
      .forEach((b) => b.classList.toggle('on', b.dataset.tool === t && (!b.closest('.ddmenu') || b.closest('.ddmenu') === target?.menu)));
  }
}
