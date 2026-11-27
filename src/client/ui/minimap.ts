import { Camera } from '../render/camera';
import { flatColor } from '../render/palette';
import type { View } from '../render/chunkRenderer';
import type { GameMap } from '../../shared/world/gameMap';

const SIZE = 200;
/** The area (tiles) the minimap of a huge map shows. When the camera nears the edge, the centre is re-taken */
const BIG_SPAN = 4096;

/** A flat minimap. Click to move the camera */
export class Minimap {
  private base: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ox = 0;
  private oy = 0;
  private readonly span: number;

  constructor(
    canvas: HTMLCanvasElement,
    private map: GameMap,
    onJump: (tx: number, ty: number) => void,
  ) {
    this.span = map.chunked ? BIG_SPAN : map.size;
    canvas.width = SIZE;
    canvas.height = SIZE;
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = SIZE;
    this.base.height = SIZE;
    this.rebuild();
    const jump = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      onJump(this.ox + ((e.clientX - r.left) / r.width) * this.span, this.oy + ((e.clientY - r.top) / r.height) * this.span);
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      jump(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) jump(e);
    });
  }

  private sample(x: number, y: number): number {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.size || y >= m.size) return 0;
    return m.heightPoint ? m.heightPoint(x, y) : m.heightAt(x, y);
  }

  /** Huge map: when the camera nears the edge of the window, re-take the window */
  private follow(view: View): void {
    if (!this.map.chunked) return;
    const c = Camera.worldToTile((view.left + view.right) / 2, (view.top + view.bottom) / 2);
    const q = this.span / 4;
    if (c.x > this.ox + q && c.x < this.ox + 3 * q && c.y > this.oy + q && c.y < this.oy + 3 * q) return;
    const max = this.map.size - this.span;
    this.ox = Math.max(0, Math.min(max, Math.floor(c.x - this.span / 2)));
    this.oy = Math.max(0, Math.min(max, Math.floor(c.y - this.span / 2)));
    this.rebuild();
  }

  /** When the terrain changes (terraforming), rebuild the base image */
  rebuild(): void {
    const bctx = this.base.getContext('2d')!;
    const img = bctx.createImageData(SIZE, SIZE);
    const k = this.span / SIZE;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const c = flatColor(this.sample(this.ox + Math.floor((x + 0.5) * k), this.oy + Math.floor((y + 0.5) * k)));
        const o = (y * SIZE + x) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
  }

  draw(view: View): void {
    this.follow(view);
    const { ctx } = this;
    ctx.drawImage(this.base, 0, 0);
    const k = SIZE / this.span;
    const pts = [
      [view.left, view.top],
      [view.right, view.top],
      [view.right, view.bottom],
      [view.left, view.bottom],
    ].map(([x, y]) => {
      const t = Camera.worldToTile(x, y);
      return [(t.x - this.ox) * k, (t.y - this.oy) * k];
    });
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
  }
}
