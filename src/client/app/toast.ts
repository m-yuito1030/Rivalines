/** A short notice of an action's result (whether a bridge or tunnel is possible, etc.). Shown briefly at the top of the screen */
export class Toast {
  private el = document.createElement('div');
  private timer = 0;

  constructor() {
    this.el.id = 'toast';
    document.body.appendChild(this.el);
  }

  /** error: a failed action. It stays a little longer and is red, so it is not mistaken for a success */
  show(msg: string, error = false): void {
    this.el.textContent = msg;
    this.el.classList.add('show');
    this.el.classList.toggle('error', error);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('show'), error ? 5000 : 2800);
  }
}
