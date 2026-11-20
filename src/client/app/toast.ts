/** 操作結果の短い通知(橋・トンネルの可否など)。画面の上に一時的に出る */
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
