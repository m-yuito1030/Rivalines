import { CHOOSABLE, DESIGN_COUNT, FACILITY_SPECS, type FacilitySize, type FacilityType, facilityCost, facilityDims, planFacility } from '../../shared/world/facilities';
import type { GameMap } from '../../shared/world/gameMap';
import sheetInfo from '../../shared/data/facilitySprites.json';
import { drawFacilityPreview } from '../render/buildingSprites';
import { $ } from './dom';

/** 施設(ホテル・公園・百貨店・モール)を建てる前に、デザインと大きさを選ぶ入力欄と見本 */
export class FacilityPicker {
  /** いま選んでいるデザインと大きさ */
  readonly sel = { design: 0, size: 'L' as FacilitySize };
  private type: FacilityType | null = null;
  private readonly designEl = $<HTMLSelectElement>('facDesign');

  constructor() {
    this.designEl.addEventListener('input', () => this.refresh());
    $('facRand').addEventListener('click', () => {
      this.designEl.value = String(Math.floor(Math.random() * (DESIGN_COUNT[this.type ?? 'hotel'] ?? 1)));
      this.refresh();
    });
    document.querySelectorAll<HTMLButtonElement>('#facSizes [data-fsize]').forEach((b) =>
      b.addEventListener('click', () => {
        this.sel.size = b.dataset.fsize as FacilitySize;
        this.refresh();
      }),
    );
  }

  /** 建てられる種類か(選べるデザインがある) */
  static choosable(tool: string): tool is FacilityType {
    return (CHOOSABLE as string[]).includes(tool);
  }

  /** ツールが変わったとき: 対象の施設なら入力欄を出す */
  setTool(tool: string): void {
    const on = FacilityPicker.choosable(tool);
    $('facilityOpts').hidden = !on;
    if (!on) {
      this.type = null;
      return;
    }
    if (this.type !== tool) {
      this.type = tool;
      $('facTitle').textContent = `${FACILITY_SPECS[tool].icon} ${FACILITY_SPECS[tool].name}を建てる`;
      this.designEl.innerHTML = '';
      const names = (sheetInfo as Record<string, { names: string[] }>)[tool]?.names ?? [];
      for (let i = 0; i < (DESIGN_COUNT[tool] ?? 1); i++) {
        const op = document.createElement('option');
        op.value = String(i);
        op.textContent = `${String(i + 1).padStart(2, '0')} ${names[i] ?? ''}`;
        this.designEl.appendChild(op);
      }
      this.designEl.value = '0';
    }
    this.refresh();
  }

  /** (x,y) に置けるか(プレビュー用)。選んだ大きさの敷地で調べる */
  plan(map: GameMap, x: number, y: number, type: FacilityType, occupied: (idx: number) => boolean) {
    return planFacility(map, x, y, type, occupied, FacilityPicker.choosable(type) ? facilityDims(type, this.sel.size) : undefined);
  }

  private refresh(): void {
    const type = this.type;
    if (!type) return;
    this.sel.design = Math.min(Number(this.designEl.value) || 0, (DESIGN_COUNT[type] ?? 1) - 1);
    document.querySelectorAll<HTMLButtonElement>('#facSizes [data-fsize]').forEach((b) => b.classList.toggle('on', b.dataset.fsize === this.sel.size));
    const d = facilityDims(type, this.sel.size);
    $('facInfo').textContent = `${FACILITY_SPECS[type].name} ${d.w}×${d.h} タイル・建設費 ${facilityCost(type, this.sel.size).toLocaleString()}円 ・ クリックした位置が中心`;
    drawFacilityPreview($<HTMLCanvasElement>('facPreview'), type, this.sel.design, this.sel.size);
  }
}
