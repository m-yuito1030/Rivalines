import { STATION_KIT_BASE, STATION_KIT_COUNT, designName, planStation, type StationOptions, type StationPlan } from '../../shared/world/stations';
import type { GameMap } from '../../shared/world/gameMap';
import { $ } from './dom';
import { onLangChange, tr } from '../i18n';
import { drawStationPreview, loadStationSprites } from '../render/stationSprites';

/** 駅の設置オプション(番線数・ホーム長・デザイン・向き)の入力欄 */
export class StationPicker {
  readonly opts: StationOptions = { axis: 1, len: 4, tracks: 1, design: STATION_KIT_BASE + 12 };
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
    // デザイン 80 種(様式20 × 変種4)を様式ごとのグループで選べるようにする。選んだものの見本を出す
    const designSel = $<HTMLSelectElement>('optDesign');
    const fillDesigns = () => {
      designSel.innerHTML = '';
      for (let b = 0; b < STATION_KIT_COUNT / 4; b++) {
        const og = document.createElement('optgroup');
        og.label = tr(designName(STATION_KIT_BASE + b * 4)).replace(/\s*\(.*\)$/, '');
        for (let v = 0; v < 4; v++) {
          const d = STATION_KIT_BASE + b * 4 + v;
          const op = document.createElement('option');
          op.value = String(d);
          op.textContent = tr(designName(d));
          og.appendChild(op);
        }
        designSel.appendChild(og);
      }
      designSel.value = String(opts.design);
    };
    fillDesigns();
    $('optRand').addEventListener('click', () => {
      designSel.value = String(STATION_KIT_BASE + Math.floor(Math.random() * STATION_KIT_COUNT));
      designSel.dispatchEvent(new Event('input'));
    });
    const preview = () => drawStationPreview($<HTMLCanvasElement>('stPreview'), { ...opts, x0: 0, y0: 0 });
    bindOpt('optTracks', (v) => ((opts.tracks = v), preview()));
    bindOpt('optLen', (v) => ((opts.len = v), preview()));
    bindOpt('optDesign', (v) => {
      opts.design = v;
      $('optDesignInfo').textContent = tr('デザイン {n} / {total}: {name}', { n: v - STATION_KIT_BASE + 1, total: STATION_KIT_COUNT, name: tr(designName(v)) });
      preview();
    });
    bindOpt('optAxis', (v) => ((opts.axis = v as 0 | 1), preview()));
    // 言語が変わったら、デザインの名前の一覧と説明を作り直す
    onLangChange(() => {
      fillDesigns();
      designSel.dispatchEvent(new Event('input'));
    });
    // 画像の読み込みが終わってから、もう一度見本を描く
    void loadStationSprites().then(preview);
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on;
  }

  /** (x,y) に置けるか(プレビュー用) */
  plan(map: GameMap, x: number, y: number, occupied: (idx: number) => boolean): StationPlan {
    return planStation(map, x, y, this.opts, occupied);
  }
}
