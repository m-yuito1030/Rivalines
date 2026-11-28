import {
  AIRPORT_DESIGNS,
  AIRPORT_MAX_CLASS,
  AIRPORT_NAMES,
  AIRPORT_SIZES,
  type AirportAxis,
  type AirportSize,
  airportFootprint,
  buildLayout,
} from '../../shared/world/airportLayout';
import { AIRPORT_PRICES, yen } from '../../shared/sim/economy/economy';
import { $ } from './dom';
import { drawAirPlan } from '../render/airColors';
import { onCurrencyChange, onLangChange, tr } from '../i18n';

/** Inputs for placing an airport: the size (small / medium / large / hub) and which way the runway runs. Shows the layout and the price */
export class AirportPicker {
  readonly sel: { size: AirportSize; axis: AirportAxis; design: number } = { size: 'S', axis: 'x', design: 0 };
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
    const sel = $<HTMLSelectElement>('airportDesign');
    for (let i = 0; i < AIRPORT_DESIGNS; i++) sel.append(new Option(String(i + 1), String(i)));
    sel.addEventListener('input', () => {
      this.sel.design = Number(sel.value) || 0;
      this.refresh();
    });
    $('airportRand').addEventListener('click', () => {
      this.sel.design = Math.floor(Math.random() * AIRPORT_DESIGNS);
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
    const { w, h } = airportFootprint(this.sel.size, this.sel.axis, this.sel.design);
    return { x: x - Math.floor(w / 2), y: y - Math.floor(h / 2) };
  }

  private refresh(): void {
    const { size, axis, design } = this.sel;
    document.querySelectorAll<HTMLButtonElement>('#airportSizes [data-asize]').forEach((b) => b.classList.toggle('on', b.dataset.asize === size));
    $<HTMLSelectElement>('airportDesign').value = String(design);
    const L = buildLayout(size, axis, design);
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
    // As large as the panel allows (the longest side up to 250 px wide / 72 px tall), so that stands and taxiways can be told apart
    const cell = Math.max(4, Math.min(22, Math.floor(250 / L.w), Math.floor(72 / L.h)));
    cv.width = L.w * cell;
    cv.height = L.h * cell;
    drawAirPlan(cv.getContext('2d')!, L.codes, L.w, L.h, cell);
    $('airportName').textContent = tr('🛫 空港({size})を建てる', { size: tr(AIRPORT_NAMES[size].ja) });
  }
}

/** Sizes in the order of the buttons */
export const AIRPORT_BUTTON_ORDER = AIRPORT_SIZES;
