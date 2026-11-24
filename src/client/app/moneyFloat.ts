import { CAT_LABEL, REVENUE_CATS } from '../../shared/sim/economy/economy';
import { tr } from '../i18n';

type Ledger = Record<string, number>;
/** タイル座標(小数)→ 画面の座標。画面の外・見えないときは null */
export type ToScreen = (tx: number, ty: number) => { x: number; y: number } | null;
/** 浮かぶ数字が指す場所(タイル座標)。稼いだ車両の動きに合わせて毎フレーム呼ばれる */
type Anchor = () => { x: number; y: number } | null;

/** 自分で操作したときに出る費用(建設費・車両購入・広告・買収・研修)。毎日かかる運行費や維持費は、頻繁すぎるので出さない */
const SPEND_CATS = ['build', 'vehicle', 'ad', 'acquire', 'training'];
/** 稼いだものの上に出すので、累計の増え方からは出さない収入(運賃と施設の売上) */
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
  /** 場所が分からないときの、画面上の位置(現金の表示の下) */
  fixed: { x: number; y: number };
  last: { x: number; y: number } | null;
}

/**
 * お金の増減を、画面上に一瞬だけ表示する。
 * - 車両が運賃を稼いだら、その車両の上に緑のプラス。施設が1日の売上を稼いだら、その施設の上に緑のプラス。
 * - 建てたときの費用は、建てた場所の上に赤のマイナス(場所が分からないときは現金の表示の下)。
 * 累計(total)の増え方を見て出すので、日付が変わって「今日」の集計が戻っても、誤って出ない。
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

  /** 建てた場所を覚えておく(そのあと届く費用を、この場所の上に出す) */
  setSpendAt(x: number, y: number): void {
    this.spendAt = { x, y, at: performance.now() };
  }

  /** 稼いだものの上に、緑のプラスを出す(同じものが短い間にまた稼いだら、数字を足す) */
  earn(key: string, amount: number, label: string, anchor: Anchor): void {
    this.add(true, amount, label, key, anchor);
  }

  /** 累計の記録(total)を渡す。前回からの増減のうち、場所が決まっていないものを表示する */
  update(total: Ledger): void {
    const prev = this.prev;
    this.prev = { ...total };
    if (!prev) return; // 最初の1回は基準にするだけ(ログイン直後に、これまでの累計が一度に出ないように)
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
    // 一度に出すのは大きい順に3つまで(画面を埋めない)
    items.sort((a, b) => b.amount - a.amount);
    const at = this.spendAt && now - this.spendAt.at < 5000 ? this.spendAt : null;
    for (const it of items.slice(0, 3)) {
      const label = tr(CAT_LABEL[it.cat] ?? it.cat);
      if (!it.plus && at) this.add(false, it.amount, label, `s:${it.cat}`, () => ({ x: at.x, y: at.y }));
      else this.add(it.plus, it.amount, label, `c:${it.cat}`, null);
    }
  }

  /** 毎フレーム: 浮かぶ数字を、稼いだものの位置に合わせて動かし、時間が来たら消す */
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
        f.el.style.display = 'none'; // 画面の外
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
