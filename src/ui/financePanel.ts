import { CAT_LABEL, COST_CATS, type Company, LOAN_STEP, PAYOUT_OPTIONS, REVENUE_CATS, SHARES, TAX_RATE, assetValue, facilityValue, gradeOf, yen } from '../sim/economy';
import { type Rival, acquirePrice, divestPrice } from '../sim/rivals';
import { net } from '../multi/net';
import { FACILITY_SPECS } from '../world/facilities';
import type { GameMap } from '../world/gameMap';
import { type RatingState, ratingName } from '../sim/rating';
import type { Transit } from '../sim/transit';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 経営画面: 資金・売上と費用・融資・自社施設と他社施設(買収) */
export class FinancePanel {
  private timer = 0;
  /** ボタンを押している間は再描画しない(クリック直前に要素が入れ替わるのを防ぐ) */
  private pressed = false;
  constructor(
    private modal: HTMLElement,
    private body: HTMLElement,
    private company: () => Company,
    private map: GameMap,
    private transit: Transit,
    private rating: () => RatingState,
    private onMessage: (msg: string) => void,
    private rivals: () => Rival[] = () => [],
    private getDate: () => { year: number; month: number; day: number; period: number; quarter: number } = () => ({ year: 2026, month: 4, day: 1, period: 1, quarter: 1 }),
  ) {
    modal.querySelector('#finClose')?.addEventListener('click', () => this.close());
    modal.addEventListener('pointerdown', () => (this.pressed = true));
    window.addEventListener('pointerup', () => setTimeout(() => (this.pressed = false), 0));
    window.addEventListener('pointercancel', () => (this.pressed = false));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) return this.close();
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fa]');
      if (b) this.act(b);
    });
  }

  get isOpen(): boolean {
    return !this.modal.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.modal.hidden = false;
    this.render();
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  close(): void {
    this.modal.hidden = true;
    clearInterval(this.timer);
  }

  private act(b: HTMLElement): void {
    const a = b.dataset.fa as 'payout' | 'borrow' | 'repay' | 'rival-buy' | 'rival-sell' | 'acquire' | 'sell';
    void net.cmd({ t: 'fin', op: a, amount: Number(b.dataset.amount), id: Number(b.dataset.id) }).then((r) => this.onMessage(r.msg ?? (r.ok ? '完了しました' : '失敗しました')));
  }

  private render(): void {
    if (this.pressed) return;
    const c = this.company();
    const rivals = this.rivals();
    const assets = assetValue(this.map, this.transit, rivals, net.id);
    const limit = c.maxLoan(c.credit, assets);
    const rate = c.interestRate(c.credit);
    const sum = (l: Record<string, number>, cats: readonly string[]) => cats.reduce((a, k) => a + (l[k] ?? 0), 0);
    const histRev = c.history.reduce((a, d) => a + d.revenue, 0);
    const histCost = c.history.reduce((a, d) => a + d.cost, 0);
    const maxBar = Math.max(1, ...c.history.map((d) => Math.max(d.revenue, d.cost)));
    const bars = c.history
      .map((d) => `<div class="fbar" title="${d.day + 1}日目 売上${yen(d.revenue)} 費用${yen(d.cost)}"><i class="r" style="height:${Math.round((d.revenue / maxBar) * 100)}%"></i><i class="c" style="height:${Math.round((d.cost / maxBar) * 100)}%"></i></div>`)
      .join('');
    let h = `<div class="fgrid">
      <div>現金</div><div class="n ${c.cash < 0 ? 'neg' : ''}">${yen(c.cash)}</div>
      <div>借入金</div><div class="n">${yen(c.loan)}</div>
      <div>資産評価(施設・車両・基地)</div><div class="n">${yen(assets)}</div>
      <div><b>純資産</b></div><div class="n"><b>${yen(c.netWorth(assets))}</b></div>
      <div>会社の評価(運行の質)</div><div class="n">${ratingName(this.rating().score)}(${Math.round(this.rating().score)}点)</div>
      <div>格付け(信用)</div><div class="n"><b>${gradeOf(c.credit)}</b>(${Math.round(c.credit)}点)</div>
      <div>融資の上限 / 年利</div><div class="n">${yen(limit)} / ${(rate * 100).toFixed(1)}%</div>
      <div>株価 / 時価総額(発行${SHARES.toLocaleString()}株)</div><div class="n"><b>${yen(c.stock)}</b> / ${yen(c.marketCap)}</div>
    </div>
    <h3 style="display:none"></h3>
    <div class="frow">借入: ${[1, 5, 20].map((m) => `<button data-fa="borrow" data-amount="${m * LOAN_STEP}">${m}00万円</button>`).join('')}
      返済: ${[1, 5].map((m) => `<button data-fa="repay" data-amount="${m * LOAN_STEP}">${m}00万円</button>`).join('')}<button data-fa="repay" data-amount="0">全額</button></div>
    <h3>株価の推移(直近${c.stockHistory.length}日)</h3>
    ${this.stockChart(c.stockHistory)}
    <h3>収支(直近${c.history.length}日 / 今日)</h3>
    <div class="fbars">${bars || '<span class="muted">1日が終わると表示されます</span>'}</div>
    <div class="muted">緑=売上 赤=費用。直近${c.history.length}日: 売上 ${yen(histRev)} / 費用 ${yen(histCost)} / 損益 <b class="${histRev - histCost < 0 ? 'neg' : ''}">${yen(histRev - histCost)}</b></div>
    <table><tr><th>分類</th><th>今日</th><th>累計</th></tr>
      <tr><th colspan="3">売上</th></tr>
      ${REVENUE_CATS.map((k) => `<tr><td>${CAT_LABEL[k]}</td><td>${yen(c.today[k] ?? 0)}</td><td>${yen(c.total[k] ?? 0)}</td></tr>`).join('')}
      <tr><td><b>売上合計</b></td><td><b>${yen(sum(c.today, REVENUE_CATS))}</b></td><td><b>${yen(sum(c.total, REVENUE_CATS))}</b></td></tr>
      <tr><th colspan="3">費用</th></tr>
      ${COST_CATS.map((k) => `<tr><td>${CAT_LABEL[k]}</td><td>${yen(c.today[k] ?? 0)}</td><td>${yen(c.total[k] ?? 0)}</td></tr>`).join('')}
      <tr><td><b>費用合計</b></td><td><b>${yen(sum(c.today, COST_CATS))}</b></td><td><b>${yen(sum(c.total, COST_CATS))}</b></td></tr>
    </table>`;
    const own = this.map.facilities.filter((f) => (f.owner ?? 'player') === 'player' && f.playerId === net.id);
    const other = this.map.facilities.filter((f) => f.owner === 'city' || ((f.owner ?? 'player') === 'player' && f.playerId !== net.id && f.playerId !== undefined && false));
    // 決算(事業年度): 期首来の損益と、過去の決算書
    const dt = this.getDate();
    const f = c.fy;
    const fsum = (cats: readonly string[]) => cats.reduce((a, k) => a + (f[k] ?? 0), 0);
    const fRev = fsum(['fare-road', 'fare-rail', 'fare-air', 'facility', 'subsidiary']);
    const fOp = fRev - (f.running ?? 0) - (f.upkeep ?? 0); // 減価償却は期末に確定する
    h += `<h3>決算(第${dt.period}期 ${dt.year}年${dt.month}月${dt.day}日 / Q${dt.quarter} ・ 3月末決算)</h3>`;
    h += `<div class="fgrid"><div>期首来の売上</div><div class="n">${yen(fRev)}</div><div>期首来の営業利益(減価償却前)</div><div class="n ${fOp < 0 ? 'neg' : ''}">${yen(fOp)}</div><div>インフラの簿価(毎期10%償却) / 繰越欠損金</div><div class="n">${yen(c.infra)} / ${yen(c.loss)}</div><div>法人税率</div><div class="n">${Math.round(TAX_RATE * 100)}%(繰越欠損金で相殺)</div></div>`;
    h += `<div class="frow">配当性向: ${PAYOUT_OPTIONS.map((p) => `<button data-fa="payout" data-amount="${p}" class="${c.payout === p ? 'on' : ''}">${Math.round(p * 100)}%</button>`).join('')}<span class="muted"> 決算で当期純利益の何割を配当に回すか(株価にやや好影響)</span></div>`;
    h += c.reports.length
      ? `<table><tr><th>期</th><th>売上高</th><th>営業利益</th><th>税引前</th><th>法人税</th><th>当期純利益</th><th>配当</th><th>純資産</th><th>株価</th></tr>${[...c.reports]
          .reverse()
          .map((r) => `<tr title="${r.from}〜${r.to} / 運行費${yen(r.running)} 維持費${yen(r.upkeep)} 償却${yen(r.depreciation)} 利息${yen(r.interest)}"><td>第${r.period}期</td><td>${yen(r.revenue)}</td><td class="${r.opProfit < 0 ? 'neg' : ''}">${yen(r.opProfit)}</td><td>${yen(r.preTax)}</td><td>${yen(r.tax)}</td><td class="${r.netIncome < 0 ? 'neg' : ''}"><b>${yen(r.netIncome)}</b></td><td>${yen(r.dividend)}</td><td>${yen(r.netWorth)}</td><td>${yen(r.stock)}</td></tr>`)
          .join('')}</table><div class="muted">行にカーソルを置くと内訳(運行費・維持費・償却・利息)が出ます。営業利益 = 売上高 − 運行費 − 維持費 − 減価償却費。</div>`
      : '<div class="muted">最初の決算は 2027年3月31日です。</div>';
    h += '<h3>競合会社(買収できます)</h3>';
    h += `<table><tr><th>会社</th><th>企業価値</th><th>利益/日</th><th>株価</th><th>買収額</th><th></th></tr>${rivals
      .map(
        (r) =>
          `<tr><td>${esc(r.name)}${r.acquired ? (r.acquiredBy === net.id ? ' <b>(傘下)</b>' : ' (他のプレイヤーの傘下)') : ''}</td><td>${yen(r.value)}</td><td>${yen(r.profit)}</td><td>${yen(r.value / 100000)}</td><td>${r.acquired ? '-' : yen(acquirePrice(r))}</td><td>${
            r.acquired && r.acquiredBy !== net.id ? '' : r.acquired ? `<button data-fa="rival-sell" data-id="${r.id}" title="企業価値の80%で手放す">手放す(${yen(divestPrice(r))})</button>` : `<button data-fa="rival-buy" data-id="${r.id}" ${c.cash < acquirePrice(r) ? 'disabled' : ''}>買収</button>`
          }</td></tr>`,
      )
      .join('')}</table><div class="muted">買収すると、その会社が持つ民間施設が自社のものになり、利益が毎日「子会社の利益」として入ります。企業価値は日々変動します。</div>`;
    h += '<h3>自社の施設(経営資源)</h3>';
    h += own.length
      ? `<table><tr><th>施設</th><th>売上/日</th><th>維持費/日</th><th>来場者</th><th>評価額</th><th></th></tr>${own
          .map((f) => `<tr><td>${FACILITY_SPECS[f.type].icon} ${esc(f.name)}</td><td>${yen(f.income ?? 0)}</td><td>${yen(FACILITY_SPECS[f.type].upkeep)}</td><td>${Math.floor(f.visits ?? 0)}</td><td>${yen(facilityValue(f))}</td><td><button data-fa="sell" data-id="${f.id}" title="評価額の60%で売却(他社のものになる)">売却</button></td></tr>`)
          .join('')}</table>`
      : '<div class="muted">施設(百貨店・モール・スタジアムなど)を建てると、近くの駅・バス停に来た人が売上になります。</div>';
    h += '<h3>他社の施設(買収できます)</h3>';
    h += other.length
      ? `<table><tr><th>施設</th><th>来場者</th><th>評価額(買収額)</th><th></th></tr>${other
          .map((f) => `<tr><td>${FACILITY_SPECS[f.type].icon} ${esc(f.name)}</td><td>${Math.floor(f.visits ?? 0)}</td><td>${yen(facilityValue(f))}</td><td><button data-fa="acquire" data-id="${f.id}" ${c.cash < facilityValue(f) ? 'disabled' : ''}>買収</button></td></tr>`)
          .join('')}</table>`
      : '<div class="muted">街が大きくなると、民間の百貨店・ホテル・モールが建ちます。買収すると自社の売上になります。</div>';
    // 部分ごとに、変わったときだけ書き換える(ボタンの要素が毎秒入れ替わらないように)
    this.setParts(h);
  }

  /** 株価の折れ線(SVG) */
  private stockChart(hist: number[]): string {
    if (hist.length < 2) return '<div class="muted">1日が終わると表示されます</div>';
    const w = 700;
    const h = 60;
    const lo = Math.min(...hist);
    const hi = Math.max(...hist);
    const pts = hist.map((v, i) => `${((i / (hist.length - 1)) * w).toFixed(1)},${(h - 4 - ((v - lo) / Math.max(1, hi - lo)) * (h - 8)).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="background:#0b1420;border-radius:6px"><polyline fill="none" stroke="#4bb0ff" stroke-width="2" points="${pts}"/></svg><div class="muted">高値 ${yen(hi)} / 安値 ${yen(lo)}</div>`;
  }

  private parts: string[] = [];

  /** h3 見出しで区切った部分ごとに差分更新する */
  private setParts(h: string): void {
    const chunks = h.split(/(?=<h3)/);
    const kids = [...this.body.children] as HTMLElement[];
    if (kids.length !== chunks.length) {
      this.body.innerHTML = chunks.map(() => '<div></div>').join('');
      this.parts = [];
    }
    const els = [...this.body.children] as HTMLElement[];
    chunks.forEach((c, i) => {
      if (this.parts[i] !== c) {
        els[i].innerHTML = c;
        this.parts[i] = c;
      }
    });
  }
}
