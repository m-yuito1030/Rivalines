import { CHOOSABLE, DESIGN_COUNT, FACILITY_SPECS, type FacilitySize, type FacilityType, facilityCost, facilityDims, planFacility } from '../../shared/world/facilities';
import type { GameMap } from '../../shared/world/gameMap';
import sheetInfo from '../../shared/data/facilitySprites.json';
import { drawFacilityPreview } from '../render/buildingSprites';
import { $ } from './dom';
import { onLangChange, tr } from '../i18n';

/** Inputs and a preview for choosing the design and size before building a facility (hotel, park, department store, mall) */
export class FacilityPicker {
  /** The design and size currently selected */
  readonly sel = { design: 0, size: 'L' as FacilitySize };
  private type: FacilityType | null = null;
  private readonly designEl = $<HTMLSelectElement>('facDesign');

  constructor() {
    // When the language changes, rebuild the list of names
    onLangChange(() => {
      const tool = this.type;
      this.type = null;
      if (tool) this.setTool(tool);
    });
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

  /** Whether it is a kind that can be built (it has designs to choose from) */
  static choosable(tool: string): tool is FacilityType {
    return (CHOOSABLE as string[]).includes(tool);
  }

  /** When the tool changes: show the inputs if it is a facility */
  setTool(tool: string): void {
    const on = FacilityPicker.choosable(tool);
    $('facilityOpts').hidden = !on;
    if (!on) {
      this.type = null;
      return;
    }
    if (this.type !== tool) {
      this.type = tool;
      $('facTitle').textContent = tr('{icon} {name}を建てる', { icon: FACILITY_SPECS[tool].icon, name: tr(FACILITY_SPECS[tool].name) });
      this.designEl.innerHTML = '';
      const names = (sheetInfo as Record<string, { names: string[] }>)[tool]?.names ?? [];
      for (let i = 0; i < (DESIGN_COUNT[tool] ?? 1); i++) {
        const op = document.createElement('option');
        op.value = String(i);
        op.textContent = `${String(i + 1).padStart(2, '0')} ${tr(names[i] ?? '')}`;
        this.designEl.appendChild(op);
      }
      this.designEl.value = '0';
    }
    this.refresh();
  }

  /** Whether it can be placed at (x,y) (for the preview). Checked with the site of the selected size */
  plan(map: GameMap, x: number, y: number, type: FacilityType, occupied: (idx: number) => boolean) {
    return planFacility(map, x, y, type, occupied, FacilityPicker.choosable(type) ? facilityDims(type, this.sel.size) : undefined);
  }

  private refresh(): void {
    const type = this.type;
    if (!type) return;
    this.sel.design = Math.min(Number(this.designEl.value) || 0, (DESIGN_COUNT[type] ?? 1) - 1);
    document.querySelectorAll<HTMLButtonElement>('#facSizes [data-fsize]').forEach((b) => b.classList.toggle('on', b.dataset.fsize === this.sel.size));
    const d = facilityDims(type, this.sel.size);
    $('facInfo').textContent = tr('{name} {w}×{h} タイル・建設費 {cost}円 ・ クリックした位置が中心', {
      name: tr(FACILITY_SPECS[type].name),
      w: d.w,
      h: d.h,
      cost: facilityCost(type, this.sel.size).toLocaleString(),
    });
    drawFacilityPreview($<HTMLCanvasElement>('facPreview'), type, this.sel.design, this.sel.size);
  }
}
