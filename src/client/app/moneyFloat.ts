import { CAT_LABEL, REVENUE_CATS } from '../../shared/sim/economy/economy';
import { tr } from '../i18n';

type Ledger = Record<string, number>;
/** Tile coordinates (fractional) -> screen coordinates. null if off screen or not visible */
export type ToScreen = (tx: number, ty: number) => { x: number; y: number } | null;
/** The place (tile coordinates) the floating number points to. Called every frame to follow a moving vehicle that earned */
type Anchor = () => { x: number; y: number } | null;

/** Costs that appear when you act yourself (construction, buying vehicles, advertising, acquisitions, training). Daily running costs and upkeep are not shown, since they are too frequent */
const SPEND_CATS = ['build', 'vehicle', 'ad', 'acquire', 'training'];
/** Shown above whatever earned them, so income not derived from the cumulative increase (fares and facility sales) */
const TARGETED = new Set(['fare-road', 'fare-rail', 'fare-air', 'facility']);
const LIFE_MS = 1800;

interface Float {
  el: HTMLElement;
  born: number;
  plus: boolean;
  amount: number;
  label: string;
  key: string;
  anchor: Anchor | null;
  /** The position on screen when the place is unknown (below the cash display) */
  fixed: { x: number; y: number };
  last: { x: number; y: number } | null;
}

/**
 * Briefly show changes in money on screen.
 * - When a vehicle earns a fare, a green plus above that vehicle. When a facility earns its daily sales, a green plus above that facility.
 * - Construction costs show as a red minus above where you built (below the cash display if the place is unknown).
 * It is based on how the cumulative total grows, so when the date changes and "today"'s totals reset, nothing is shown by mistake.
 */
export class MoneyFloat {
  private prev: Ledger | null = null;
  private floats: Float[] = [];
  private spendAt: { x: number; y: number; at: number } | null = null;

  constructor(
    private anchorEl: HTMLElement,
    private format: (n: number) => string,
    private toScreen: ToScreen,
  ) {}

  /** Remember where something was built (costs that arrive afterwards are shown above this place) */
  setSpendAt(x: number, y: number): void {
    this.spendAt = { x, y, at: performance.now() };
  }

  /** Show a green plus above whatever earned (if the same thing earns again soon, add to the number) */
  earn(key: string, amount: number, label: string, anchor: Anchor): void {
    this.add(true, amount, label, key, anchor);
  }

  /** Pass the cumulative record (total). Of the increases and decreases since last time, show those whose place is not decided */
  update(total: Ledger): void {
    const prev = this.prev;
    this.prev = { ...total };
    if (!prev) return; // the first time is just the baseline (so the cumulative total up to now does not appear at once right after login)
    const now = performance.now();
    const items: { cat: string; amount: number; plus: boolean }[] = [];
    for (const cat of REVENUE_CATS) {
      if (TARGETED.has(cat)) continue;
      const d = (total[cat] ?? 0) - (prev[cat] ?? 0);
      if (d > 0) items.push({ cat, amount: d, plus: true });
    }
    for (const cat of SPEND_CATS) {
      const d = (total[cat] ?? 0) - (prev[cat] ?? 0);
      if (d > 0) items.push({ cat, amount: d, plus: false });
    }
    // Show at most three at once, largest first (so the screen does not fill up)
    items.sort((a, b) => b.amount - a.amount);
    const at = this.spendAt && now - this.spendAt.at < 5000 ? this.spendAt : null;
    for (const it of items.slice(0, 3)) {
      const label = tr(CAT_LABEL[it.cat] ?? it.cat);
      if (!it.plus && at) this.add(false, it.amount, label, `s:${it.cat}`, () => ({ x: at.x, y: at.y }));
      else this.add(it.plus, it.amount, label, `c:${it.cat}`, null);
    }
  }

  /** Every frame: move the floating numbers to follow the place that earned, and remove them when their time is up */
  tick(now: number = performance.now()): void {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      const age = now - f.born;
      if (age >= LIFE_MS) {
        f.el.remove();
        this.floats.splice(i, 1);
        continue;
      }
      let p: { x: number; y: number } | null = null;
      if (f.anchor) {
        const t = f.anchor() ?? f.last;
        if (t) {
          f.last = t;
          p = this.toScreen(t.x, t.y);
        }
      } else p = f.fixed;
      if (!p) {
        f.el.style.display = 'none'; // off screen
        continue;
      }
      const k = age / LIFE_MS;
      const rise = 6 - k * 28;
      const opacity = k < 0.1 ? k / 0.1 : k > 0.7 ? Math.max(0, (1 - k) / 0.3) : 1;
      f.el.style.display = '';
      f.el.style.opacity = String(opacity);
      f.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y + rise)}px) translate(-50%, -100%)`;
    }
  }

  private add(plus: boolean, amount: number, label: string, key: string, anchor: Anchor | null): void {
    const now = performance.now();
    const same = this.floats.find((f) => f.key === key && now - f.born < 700);
    if (same) {
      same.amount += amount;
      this.render(same);
      return;
    }
    if (this.floats.length >= 14) return;
    const r = this.anchorEl.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = `money-float ${plus ? 'up' : 'down'}`;
    const f: Float = {
      el,
      born: now,
      plus,
      amount,
      label,
      key,
      anchor,
      fixed: { x: Math.max(60, Math.min(window.innerWidth - 100, r.left + r.width / 2)), y: r.bottom + 28 + (this.floats.length % 3) * 20 },
      last: null,
    };
    this.render(f);
    document.body.append(el);
    this.floats.push(f);
  }

  private render(f: Float): void {
    f.el.textContent = `${f.plus ? '+' : '−'}${this.format(f.amount)}  ${f.label}`;
  }
}
