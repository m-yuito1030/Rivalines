import { BUILDING_STYLES, STATION_DESIGN_COUNT, designName, planStation, type StationOptions, type StationPlan } from '../../shared/world/stations';
import type { GameMap } from '../../shared/world/gameMap';
import { $ } from './dom';

/** 駅の設置オプション(番線数・ホーム長・デザイン・向き)の入力欄 */
export class StationPicker {
  readonly opts: StationOptions = { axis: 1, len: 4, tracks: 1, design: 51 };
  private readonly el = $('stationOpts');

  constructor() {
    const opts = this.opts;
    const bindOpt = (id: string, apply: (v: number) => void) => {
      const el = $<HTMLSelectElement | HTMLInputElement>(id);
      const sync = () => {
        apply(Number(el.value));
        const lab = document.getElementById(id + 'Val');
        if (lab) lab.textContent = el.value;
      };
      el.addEventListener('input', sync);
      sync();
    };
    // デザイン 100 種(屋根 × 配色 × 駅舎)を駅舎ごとのグループで選べるようにする
    const designSel = $<HTMLSelectElement>('optDesign');
    for (let g = 0; g < 4; g++) {
      const og = document.createElement('optgroup');
      og.label = BUILDING_STYLES[g];
      for (let k = 0; k < 25; k++) {
        const d = g * 25 + k;
        const op = document.createElement('option');
        op.value = String(d);
        op.textContent = `${String(d + 1).padStart(3, '0')} ${designName(d)}`;
        og.appendChild(op);
      }
      designSel.appendChild(og);
    }
    designSel.value = String(opts.design);
    $('optRand').addEventListener('click', () => {
      designSel.value = String(Math.floor(Math.random() * STATION_DESIGN_COUNT));
      designSel.dispatchEvent(new Event('input'));
    });
    bindOpt('optTracks', (v) => (opts.tracks = v));
    bindOpt('optLen', (v) => (opts.len = v));
    bindOpt('optDesign', (v) => {
      opts.design = v;
      $('optDesignInfo').textContent = `デザイン ${v + 1} / ${STATION_DESIGN_COUNT}: ${designName(v)}`;
    });
    bindOpt('optAxis', (v) => (opts.axis = v as 0 | 1));
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on;
  }

  /** (x,y) に置けるか(プレビュー用) */
  plan(map: GameMap, x: number, y: number, occupied: (idx: number) => boolean): StationPlan {
    return planStation(map, x, y, this.opts, occupied);
  }
}
