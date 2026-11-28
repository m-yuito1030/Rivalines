import { AIR } from '../../shared/world/airportLayout';

/** Colours of the airport tiles by tile code (the layout preview in the panel and the ghost on the map share them) */
export const AIR_COLORS: Record<number, string> = {
  [AIR.RUNWAY]: '#33363c',
  [AIR.TAXIWAY]: '#8a8e95',
  [AIR.APRON]: '#b4b8bf',
  [AIR.STAND]: '#b4b8bf',
  [AIR.TERMINAL]: '#2f7dd1',
  [AIR.BUILDING]: '#e2e6ee',
  [AIR.HANGAR]: '#d9823c',
};

/** Same colours as numbers (for Pixi) */
export const AIR_COLORS_HEX: Record<number, number> = Object.fromEntries(Object.entries(AIR_COLORS).map(([k, v]) => [Number(k), parseInt(v.slice(1), 16)]));

/** Draw a top-down plan of an airport layout on a canvas, with the markings that make it readable (runway centre line, stand circles, terminal) */
export function drawAirPlan(ctx: CanvasRenderingContext2D, codes: Uint8Array, w: number, h: number, cell: number): void {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : codes[y * w + x]);
  ctx.fillStyle = '#5b7a4a';
  ctx.fillRect(0, 0, w * cell, h * cell);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = at(x, y);
      ctx.fillStyle = AIR_COLORS[c] ?? '#000';
      ctx.fillRect(x * cell, y * cell, cell, cell);
      const px = x * cell;
      const py = y * cell;
      if (c === AIR.RUNWAY) {
        // A dashed white centre line along the runway (runs along whichever direction has runway neighbours)
        const along = at(x - 1, y) === AIR.RUNWAY || at(x + 1, y) === AIR.RUNWAY;
        ctx.fillStyle = '#f2f2f2';
        const t = Math.max(1, Math.round(cell / 8));
        if (along) ctx.fillRect(px + cell * 0.2, py + cell / 2 - t / 2, cell * 0.6, t);
        else ctx.fillRect(px + cell / 2 - t / 2, py + cell * 0.2, t, cell * 0.6);
      } else if (c === AIR.STAND) {
        ctx.strokeStyle = '#f0d24a';
        ctx.lineWidth = Math.max(1, cell / 8);
        ctx.beginPath();
        ctx.arc(px + cell / 2, py + cell / 2, cell * 0.3, 0, Math.PI * 2);
        ctx.stroke();
      } else if (c === AIR.TAXIWAY) {
        ctx.fillStyle = '#e8cf4a';
        const t = Math.max(1, Math.round(cell / 10));
        const alongX = at(x - 1, y) === AIR.TAXIWAY || at(x + 1, y) === AIR.TAXIWAY;
        if (alongX) ctx.fillRect(px, py + cell / 2 - t / 2, cell, t);
        else ctx.fillRect(px + cell / 2 - t / 2, py, t, cell);
      } else if (c === AIR.HANGAR) {
        ctx.fillStyle = '#a85d22';
        ctx.fillRect(px + cell * 0.15, py + cell * 0.15, cell * 0.7, cell * 0.2);
      } else if (c === AIR.TERMINAL) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(px + cell * 0.3, py + cell * 0.3, cell * 0.4, cell * 0.4);
      }
    }
  }
}
