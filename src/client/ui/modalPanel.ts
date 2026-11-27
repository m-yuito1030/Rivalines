/**
 * The shared part of full-screen windows (management, ranking, list, timetable, statistics, analysis, auctions).
 * Handles opening and closing, and redrawing periodically while open. Each panel writes its own content drawing (render).
 */
export abstract class ModalPanel {
  private timer = 0;

  /**
   * @param modal the element of the whole window (opened and closed with hidden)
   * @param intervalMs the interval (ms) at which render is called while open
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

  /** Once right after opening. By default, draw immediately */
  protected onOpen(): void {
    this.render();
  }

  /** Draw the content (called periodically while open) */
  protected abstract render(): void;
}
