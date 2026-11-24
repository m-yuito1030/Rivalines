import { CAT_LABEL, REVENUE_CATS } from '../../shared/sim/economy/economy';
import { tr } from '../i18n';

type Ledger = Record<string, number>;

/** 自分で操作したときに出る費用(建設費・車両購入・広告・買収・研修)。毎日かかる運行費や維持費は、頻繁すぎるので出さない */
const SPEND_CATS = ['build', 'vehicle', 'ad', 'acquire', 'training'];

/**
 * お金の増減を、画面上に一瞬だけ表示する。
 * 施設や駅を建てたなどの費用は赤のマイナス、路線の運賃や施設の売上などの収入は緑のプラスで、現金の表示の下に浮かんで消える。
 * 開始からの累計(total)の増え方を見て出すので、日付が変わって「今日」の集計が戻っても、誤って出ない。
 */
export class MoneyFloat {
  private prev: Ledger | null = null;
  private live = 0;

  constructor(
    private anchor: HTMLElement,
    private format: (n: number) => string,
  ) {}

  /** 累計の記録(total)を渡す。前回からの増減を、分類ごとに表示する */
  update(total: Ledger): void {
    const prev = this.prev;
    this.prev = { ...total };
    if (!prev) return; // 最初の1回は基準にするだけ(ログイン直後に、これまでの累計が一度に出ないように)
    const items: { cat: string; amount: number; plus: boolean }[] = [];
    for (const cat of REVENUE_CATS) {
      const d = (total[cat] ?? 0) - (prev[cat] ?? 0);
      if (d > 0) items.push({ cat, amount: d, plus: true });
    }
    for (const cat of SPEND_CATS) {
      const d = (total[cat] ?? 0) - (prev[cat] ?? 0);
      if (d > 0) items.push({ cat, amount: d, plus: false });
    }
    // 一度に出すのは大きい順に3つまで(画面を埋めない)
    items.sort((a, b) => b.amount - a.amount);
    items.slice(0, 3).forEach((it, i) => this.spawn(it.plus, it.amount, tr(CAT_LABEL[it.cat] ?? it.cat), i));
  }

  private spawn(plus: boolean, amount: number, label: string, slot: number): void {
    if (this.live >= 8) return;
    const el = document.createElement('div');
    el.className = `money-float ${plus ? 'up' : 'down'}`;
    el.textContent = `${plus ? '+' : '−'}${this.format(amount)}  ${label}`;
    const r = this.anchor.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(window.innerWidth - 220, r.left))}px`;
    el.style.top = `${r.bottom + 6 + slot * 20}px`;
    this.live++;
    el.addEventListener('animationend', () => {
      el.remove();
      this.live--;
    });
    document.body.append(el);
  }
}
