import type { Container } from 'pixi.js';
import type { View } from './chunkRenderer';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 2;

/** A camera that handles panning (drag / WASD / arrows) and zooming (wheel) */
export class Camera {
  /** The world coordinates at the centre of the screen */
  x = 0;
  y = 0;
  zoom = 0.5;
  /** Whether a left drag pans (false while a build tool is active. Right/middle buttons always pan) */
  leftPans = true;
  private keys = new Set<string>();
  private dragging = false;
  private last = { x: 0, y: 0 };
  /** Pointers currently down (for multi-touch) */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; cx: number; cy: number } | null = null;
  /** True from the start of a two-finger gesture until all fingers lift (used to cancel a build tool's drag) */
  multiTouch = false;
  /** Whether a one-finger swipe on a touch screen pans the map (true for tools that place one thing per tap; drag tools keep the one-finger drag for building) */
  touchPans: () => boolean = () => false;
  /** Called when a touch pan or pinch starts / ends (the screen hides the floating windows while it lasts, so the map can be seen and moved) */
  onGesture?: (active: boolean) => void;
  private gestureOn = false;
  private touchStart = new Map<number, { x: number; y: number }>();

  constructor(
    private world: Container,
    private el: HTMLElement,
    private mapSize: number,
  ) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.pointerType === 'touch') this.touchStart.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2) {
        // Two fingers: pan + pinch zoom
        this.setGesture(e.pointerType === 'touch');
        this.multiTouch = true;
        this.dragging = false;
        this.pinch = this.measure();
        return;
      }
      if (e.button === 1 || e.button === 2 || (e.button === 0 && (this.leftPans || (e.pointerType === 'touch' && this.touchPans())))) {
        this.dragging = true;
        this.last = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
      }
      if (this.pinch && this.pointers.size >= 2) {
        const now = this.measure();
        const rect = el.getBoundingClientRect();
        const before = this.screenToWorld(this.pinch.cx - rect.left, this.pinch.cy - rect.top);
        this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (this.zoom * now.dist) / Math.max(1, this.pinch.dist)));
        // So the world point under the midpoint of the fingers follows the movement of the centre
        const after = this.screenToWorld(now.cx - rect.left, now.cy - rect.top);
        this.x += before.x - after.x;
        this.y += before.y - after.y;
        this.pinch = now;
        this.clamp();
        return;
      }
      if (!this.dragging) return;
      const t0 = this.touchStart.get(e.pointerId);
      if (t0 && Math.hypot(e.clientX - t0.x, e.clientY - t0.y) > 8) this.setGesture(true);
      this.x -= (e.clientX - this.last.x) / this.zoom;
      this.y -= (e.clientY - this.last.y) / this.zoom;
      this.last = { x: e.clientX, y: e.clientY };
      this.clamp();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.touchStart.delete(e.pointerId);
      this.dragging = false;
      this.pinch = null;
      if (this.pointers.size === 0) {
        this.multiTouch = false;
        this.setGesture(false);
      } else if (this.pointers.size === 1) {
        // Two fingers -> one: let the remaining finger keep panning
        const [rest] = [...this.pointers.values()];
        if (this.leftPans || this.touchPans()) {
          this.dragging = true;
          this.last = { x: rest.x, y: rest.y };
        }
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const before = this.screenToWorld(e.clientX, e.clientY);
        this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * Math.exp(-e.deltaY * 0.0015)));
        const after = this.screenToWorld(e.clientX, e.clientY);
        this.x += before.x - after.x;
        this.y += before.y - after.y;
        this.clamp();
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private setGesture(on: boolean): void {
    if (on === this.gestureOn) return;
    this.gestureOn = on;
    this.onGesture?.(on);
  }

  private measure() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - this.el.clientWidth / 2) / this.zoom + this.x,
      y: (sy - this.el.clientHeight / 2) / this.zoom + this.y,
    };
  }

  /** Tile coordinates (plane) to world coordinates */
  static tileToWorld(tx: number, ty: number) {
    return { x: (tx - ty) * 32, y: (tx + ty) * 16 };
  }

  static worldToTile(wx: number, wy: number) {
    return { x: (wy / 16 + wx / 32) / 2, y: (wy / 16 - wx / 32) / 2 };
  }

  centerOnTile(tx: number, ty: number): void {
    const w = Camera.tileToWorld(tx, ty);
    this.x = w.x;
    this.y = w.y;
    this.clamp();
  }

  /** Limit so the view does not go too far outside the map's diamond */
  private clamp(): void {
    const t = Camera.worldToTile(this.x, this.y);
    const cx = Math.min(this.mapSize, Math.max(0, t.x));
    const cy = Math.min(this.mapSize, Math.max(0, t.y));
    if (cx !== t.x || cy !== t.y) {
      const w = Camera.tileToWorld(cx, cy);
      this.x = w.x;
      this.y = w.y;
    }
  }

  update(dt: number): View {
    const speed = (900 / this.zoom) * dt * (this.keys.has('shift') ? 3 : 1);
    if (this.keys.has('w') || this.keys.has('arrowup')) this.y -= speed;
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.y += speed;
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.x -= speed;
    if (this.keys.has('d') || this.keys.has('arrowright')) this.x += speed;
    if (this.keys.has('q')) this.zoom = Math.max(MIN_ZOOM, this.zoom * (1 - dt * 1.5));
    if (this.keys.has('e')) this.zoom = Math.min(MAX_ZOOM, this.zoom * (1 + dt * 1.5));
    this.clamp();

    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    this.world.scale.set(this.zoom);
    this.world.position.set(w / 2 - this.x * this.zoom, h / 2 - this.y * this.zoom);
    return {
      left: this.x - w / 2 / this.zoom,
      right: this.x + w / 2 / this.zoom,
      top: this.y - h / 2 / this.zoom,
      bottom: this.y + h / 2 / this.zoom,
      zoom: this.zoom,
    };
  }
}
