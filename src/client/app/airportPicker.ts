import { AIR, AIRPORT_MAX_CLASS, AIRPORT_NAMES, AIRPORT_SIZES, type AirportAxis, type AirportSize, airportFootprint, buildLayout } from '../../shared/world/airportLayout';
import { AIRPORT_PRICES, yen } from '../../shared/sim/economy/economy';
import { $ } from './dom';
import { onCurrencyChange, onLangChange, tr } from '../i18n';

/** Colours of the layout preview, by tile code */
const COLORS: Record<number, string> = {
  [AIR.RUNWAY]: '#2c2e33',
  [AIR.TAXIWAY]: '#7d8187',
  [AIR.APRON]: '#a3a7ae',
  [AIR.STAND]: '#e3c84a',
  [AIR.TERMINAL]: '#2f7dd1',
  [AIR.BUILDING]: '#cfd5df',
  [AIR.HANGAR]: '#d07a3a',
};

/** Inputs for placing an airport: the size (small / medium / large / hub) and which way the runway runs. Shows the layout and the price */
export class AirportPicker {
  readonly sel: { size: AirportSize; axis: AirportAxis } = { size: 'S', axis: 'x' };
  private readonly el = $('airportOpts');

  constructor() {
    document.querySelectorAll<HTMLButtonElement>('#airportSizes [data-asize]').forEach((b) =>
      b.addEventListener('click', () => {
        this.sel.size = b.dataset.asize as AirportSize;
        this.refresh();
      }),
    );
    $<HTMLSelectElement>('airportAxis').addEventListener('input', (e) => {
      this.sel.axis = (e.target as HTMLSelectElement).value === 'y' ? 'y' : 'x';
      this.refresh();
    });
    onLangChange(() => this.refresh());
    onCurrencyChange(() => this.refresh());
    this.refresh();
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on;
    if (on) this.refresh();
  }

  /** Top-left tile of an airport whose middle is placed at the clicked tile */
  origin(x: number, y: number): { x: number; y: number } {
    const { w, h } = airportFootprint(this.sel.size, this.sel.axis);
    return { x: x - Math.floor(w / 2), y: y - Math.floor(h / 2) };
  }

  private refresh(): void {
    const { size, axis } = this.sel;
    document.querySelectorAll<HTMLButtonElement>('#airportSizes [data-asize]').forEach((b) => b.classList.toggle('on', b.dataset.asize === size));
    const L = buildLayout(size, axis);
    $('airportInfo').textContent = tr('{w}×{h} タイル ・ 建設費 {cost} ・ 滑走路 {runways}本 ・ 駐機場 {stands}か所 ・ 小型機{small}/中型機{medium}/大型機{large}', {
      w: L.w,
      h: L.h,
      cost: yen(AIRPORT_PRICES[size]),
      runways: L.runways,
      stands: L.stands,
      small: '○',
      medium: AIRPORT_MAX_CLASS[size] === 'S' ? '×' : '○',
      large: AIRPORT_MAX_CLASS[size] === 'L' ? '○' : '×',
    });
    const cv = $<HTMLCanvasElement>('airportPreview');
    const cell = Math.max(3, Math.min(8, Math.floor(210 / Math.max(L.w, L.h))));
    cv.width = L.w * cell;
    cv.height = L.h * cell;
    const ctx = cv.getContext('2d')!;
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        ctx.fillStyle = COLORS[L.codes[y * L.w + x]] ?? '#000';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    $('airportName').textContent = tr('🛫 空港({size})を建てる', { size: tr(AIRPORT_NAMES[size].ja) });
  }
}

/** Sizes in the order of the buttons */
export const AIRPORT_BUTTON_ORDER = AIRPORT_SIZES;
