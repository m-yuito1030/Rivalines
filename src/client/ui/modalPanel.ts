/**
 * 画面いっぱいに出るウィンドウ(経営・ランキング・一覧・ダイヤ・統計・分析・入札)の共通部分。
 * 開閉と、開いている間の定期的な再描画を受け持つ。中身の描画(render)は各パネルが書く。
 */
export abstract class ModalPanel {
  private timer = 0;

  /**
   * @param modal ウィンドウ全体の要素(hidden で開閉する)
   * @param intervalMs 開いている間、render を呼ぶ間隔(ミリ秒)
   */
  protected constructor(
    protected readonly modal: HTMLElement,
    private readonly intervalMs: number,
  ) {}

  get isOpen(): boolean {
    return !this.modal.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.modal.hidden = false;
    this.onOpen();
    this.timer = window.setInterval(() => this.render(), this.intervalMs);
  }

  close(): void {
    this.modal.hidden = true;
    clearInterval(this.timer);
  }

  /** 開いた直後に1回。既定は、すぐ描画する */
  protected onOpen(): void {
    this.render();
  }

  /** 中身を描く(開いている間、定期的に呼ばれる) */
  protected abstract render(): void;
}
