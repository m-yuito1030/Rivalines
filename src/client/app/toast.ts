/** A short notice of an action's result (whether a bridge or tunnel is possible, etc.). Shown briefly at the top of the screen */
export class Toast {
  private el = document.createElement('div');
  private timer = 0;

  constructor() {
    this.el.id = 'toast';
    document.body.appendChild(this.el);
  }

  show(msg: string): void {
    this.el.textContent = msg;
    this.el.classList.add('show');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('show'), 2500);
  }
}
