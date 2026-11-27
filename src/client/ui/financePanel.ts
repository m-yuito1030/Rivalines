import { tr } from '../i18n';
import { ModalPanel } from './modalPanel';
import {
  TRAINING,
  trainingCost,
  CAT_LABEL,
  COST_CATS,
  type Company,
  LOAN_STEP,
  PAYOUT_OPTIONS,
  REVENUE_CATS,
  SHARES,
  TAX_RATE,
  assetValue,
  facilityValue,
  gradeOf,
  yen,
} from '../../shared/sim/economy/economy';
import { type Rival, acquirePrice, divestPrice } from '../../shared/sim/economy/rivals';
import { net } from '../connection/net';
import { PACT_DISCOUNTS, type PactState } from '../../shared/sim/economy/pacts';
import type { PlayerInfo } from '../../shared/protocol';
import { FACILITY_SPECS, facilityUpkeep } from '../../shared/world/facilities';
import type { GameMap } from '../../shared/world/gameMap';
import { type RatingState, ratingName } from '../../shared/sim/economy/rating';
import type { Transit } from '../../shared/sim/network/transit';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Management screen: funds, sales and costs, loans, own facilities and other companies' facilities (acquisitions) */
export class FinancePanel extends ModalPanel {
  /** Do not redraw while a button is held down (so elements are not swapped out just before a click) */
  private pressed = false;
  /** The selection in the pact proposal form (kept across redraws) */
  private pactTo = 0;
  private pactDisc = 0.5;
  constructor(
    modal: HTMLElement,
    private body: HTMLElement,
    private company: () => Company,
    private map: GameMap,
    private transit: Transit,
    private rating: () => RatingState,
    private onMessage: (msg: string) => void,
    private rivals: () => Rival[] = () => [],
    private getDate: () => { year: number; month: number; day: number; period: number; quarter: number } = () => ({ year: 2026, month: 4, day: 1, period: 1, quarter: 1 }),
    private pacts: () => PactState = () => ({ pacts: [], proposals: [], nextId: 1 }),
    private players: () => PlayerInfo[] = () => [],
  ) {
    super(modal, 1000);
    modal.addEventListener('change', (e) => {
      const el = e.target as HTMLSelectElement;
      if (el.dataset.pf === 'to') this.pactTo = Number(el.value);
      if (el.dataset.pf === 'disc') this.pactDisc = Number(el.value);
    });
    modal.querySelector('#finClose')?.addEventListener('click', () => this.close());
    modal.addEventListener('pointerdown', () => (this.pressed = true));
    window.addEventListener('pointerup', () => setTimeout(() => (this.pressed = false), 0));
    window.addEventListener('pointercancel', () => (this.pressed = false));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) return this.close();
      const pb = (e.target as HTMLElement).closest<HTMLElement>('[data-pact]');
      if (pb) return this.pact(pb);
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fa]');
      if (b) this.act(b);
    });
  }

  private pact(b: HTMLElement): void {
    const op = b.dataset.pact as 'propose' | 'accept' | 'reject' | 'cancel';
    const cmd = op === 'propose' ? { t: 'pact' as const, op, to: this.pactTo, discount: this.pactDisc } : { t: 'pact' as const, op, id: Number(b.dataset.id) };
    void net.cmd(cmd).then((r) => this.onMessage(r.msg ?? (r.ok ? tr('完了しました') : tr('失敗しました'))));
  }

  private act(b: HTMLElement): void {
    const a = b.dataset.fa as 'payout' | 'borrow' | 'repay' | 'rival-buy' | 'rival-sell' | 'acquire' | 'sell' | 'train';
    void net
      .cmd({ t: 'fin', op: a, amount: Number(b.dataset.amount), id: Number(b.dataset.id) })
      .then((r) => this.onMessage(r.msg ?? (r.ok ? tr('完了しました') : tr('失敗しました'))));
  }

  protected render(): void {
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
      .map(
        (d) =>
          `<div class="fbar" title="${tr('{day}日目 売上{d} 費用{d2}', { day: d.day + 1, d: yen(d.revenue), d2: yen(d.cost) })}"><i class="r" style="height:${Math.round((d.revenue / maxBar) * 100)}%"></i><i class="c" style="height:${Math.round((d.cost / maxBar) * 100)}%"></i></div>`,
      )
      .join('');
    let h = `<div class="fgrid">
      <div>${tr('現金')}</div><div class="n ${c.cash < 0 ? 'neg' : ''}">${yen(c.cash)}</div>
      <div>${tr('借入金')}</div><div class="n">${yen(c.loan)}</div>
      <div>${tr('資産評価(施設・車両・基地)')}</div><div class="n">${yen(assets)}</div>
      <div><b>${tr('純資産')}</b></div><div class="n"><b>${yen(c.netWorth(assets))}</b></div>
      <div>${tr('会社の評価(運行の質)')}</div><div class="n">${tr('{score}({this}点)', { score: tr(ratingName(this.rating().score)), this: Math.round(this.rating().score) })}</div>
      <div>${tr('格付け(信用)')}</div><div class="n"><b>${gradeOf(c.credit)}</b>${tr('({c}点)', { c: Math.round(c.credit) })}</div>
      <div>${tr('融資の上限 / 年利')}</div><div class="n">${yen(limit)} / ${(rate * 100).toFixed(1)}%</div>
      <div>${tr('株価 / 時価総額(発行{SHARES}株)', { SHARES: SHARES.toLocaleString() })}</div><div class="n"><b>${yen(c.stock)}</b> / ${yen(c.marketCap)}</div>
    </div>
    <h3 style="display:none"></h3>
    <div class="frow">${tr('借入:')} ${[1, 5, 20].map((m) => `<button data-fa="borrow" data-amount="${m * LOAN_STEP}">${tr('{m}00万円', { m })}</button>`).join('')}
      ${tr('返済:')} ${[1, 5].map((m) => `<button data-fa="repay" data-amount="${m * LOAN_STEP}">${tr('{m}00万円', { m })}</button>`).join('')}<button data-fa="repay" data-amount="0">${tr('全額')}</button></div>
    <h3>${tr('株価の推移(直近{length}日)', { length: c.stockHistory.length })}</h3>
    ${this.stockChart(c.stockHistory)}
    <h3>${tr('収支(直近{length}日 / 今日)', { length: c.history.length })}</h3>
    <div class="fbars">${bars || `<span class="muted">${tr('1日が終わると表示されます')}</span>`}</div>
    <div class="muted">${tr('緑=売上 赤=費用。直近{length}日: 売上 {histRev} / 費用 {histCost} / 損益', { length: c.history.length, histRev: yen(histRev), histCost: yen(histCost) })} <b class="${histRev - histCost < 0 ? 'neg' : ''}">${yen(histRev - histCost)}</b></div>
    <table><tr><th>${tr('分類')}</th><th>${tr('今日')}</th><th>${tr('累計')}</th></tr>
      <tr><th colspan="3">${tr('売上')}</th></tr>
      ${REVENUE_CATS.map((k) => `<tr><td>${tr(CAT_LABEL[k]!)}</td><td>${yen(c.today[k] ?? 0)}</td><td>${yen(c.total[k] ?? 0)}</td></tr>`).join('')}
      <tr><td><b>${tr('売上合計')}</b></td><td><b>${yen(sum(c.today, REVENUE_CATS))}</b></td><td><b>${yen(sum(c.total, REVENUE_CATS))}</b></td></tr>
      <tr><th colspan="3">${tr('費用')}</th></tr>
      ${COST_CATS.map((k) => `<tr><td>${tr(CAT_LABEL[k]!)}</td><td>${yen(c.today[k] ?? 0)}</td><td>${yen(c.total[k] ?? 0)}</td></tr>`).join('')}
      <tr><td><b>${tr('費用合計')}</b></td><td><b>${yen(sum(c.today, COST_CATS))}</b></td><td><b>${yen(sum(c.total, COST_CATS))}</b></td></tr>
    </table>`;
    const own = this.map.facilities.filter((f) => (f.owner ?? 'player') === 'player' && f.playerId === net.id);
    const other = this.map.facilities.filter((f) => f.owner === 'city' || ((f.owner ?? 'player') === 'player' && f.playerId !== net.id && f.playerId !== undefined && false));
    // Fiscal year: profit and loss since the start of the period, and past financial statements
    const dt = this.getDate();
    const f = c.fy;
    const fsum = (cats: readonly string[]) => cats.reduce((a, k) => a + (f[k] ?? 0), 0);
    const fRev = fsum(['fare-road', 'fare-rail', 'fare-air', 'facility', 'subsidiary', 'realestate', 'subsidy']);
    const fOp = fRev - (f.running ?? 0) - (f.upkeep ?? 0) - (f.levy ?? 0); // depreciation is fixed at the end of the period
    h += `<h3>${tr('決算(第{period}期 {year}年{month}月{day}日 / Q{quarter} ・ 3月末決算)', { period: dt.period, year: dt.year, month: dt.month, day: dt.day, quarter: dt.quarter })}</h3>`;
    h += `<div class="fgrid"><div>${tr('期首来の売上')}</div><div class="n">${yen(fRev)}</div><div>${tr('期首来の営業利益(減価償却前)')}</div><div class="n ${fOp < 0 ? 'neg' : ''}">${yen(fOp)}</div><div>${tr('インフラの簿価(毎期10%償却) / 繰越欠損金')}</div><div class="n">${yen(c.infra)} / ${yen(c.loss)}</div><div>${tr('法人税率')}</div><div class="n">${tr('{TAX_RATE}%(繰越欠損金で相殺)', { TAX_RATE: Math.round(TAX_RATE * 100) })}</div></div>`;
    h += `<div class="frow">${tr('配当性向:')} ${PAYOUT_OPTIONS.map((p) => `<button data-fa="payout" data-amount="${p}" class="${c.payout === p ? 'on' : ''}">${Math.round(p * 100)}%</button>`).join('')}<span class="muted"> ${tr('決算で当期純利益の何割を配当に回すか(株価にやや好影響)')}</span></div>`;
    h += c.reports.length
      ? `<table><tr><th>${tr('期')}</th><th>${tr('売上高')}</th><th>${tr('営業利益')}</th><th>${tr('税引前')}</th><th>${tr('法人税')}</th><th>${tr('当期純利益')}</th><th>${tr('配当')}</th><th>${tr('純資産')}</th><th>${tr('株価')}</th></tr>${[
          ...c.reports,
        ]
          .reverse()
          .map(
            (r) =>
              `<tr title="${tr('{from}〜{to} / 運行費{r} 維持費{r2} 償却{r3} 利息{r4}', { from: r.from, to: r.to, r: yen(r.running), r2: yen(r.upkeep), r3: yen(r.depreciation), r4: yen(r.interest) })}"><td>${tr('第{period}期', { period: r.period })}</td><td>${yen(r.revenue)}</td><td class="${r.opProfit < 0 ? 'neg' : ''}">${yen(r.opProfit)}</td><td>${yen(r.preTax)}</td><td>${yen(r.tax)}</td><td class="${r.netIncome < 0 ? 'neg' : ''}"><b>${yen(r.netIncome)}</b></td><td>${yen(r.dividend)}</td><td>${yen(r.netWorth)}</td><td>${yen(r.stock)}</td></tr>`,
          )
          .join('')}</table><div class="muted">${tr('行にカーソルを置くと内訳(運行費・維持費・償却・利息)が出ます。営業利益 = 売上高 − 運行費 − 維持費 − 減価償却費。')}</div>`
      : `<div class="muted">${tr('最初の決算は 2027年3月31日です。')}</div>`;
    const lv = c.training;
    h += `<h3>${tr('従業員教育')}</h3><div class="fgrid"><div>${tr('研修レベル')}</div><div class="n"><b>${lv}</b> / ${TRAINING.max}</div><div>${tr('効果(現在)')}</div><div class="n">${tr('運行費 −{TRAINING}% / 乗客 +{TRAINING2}%', { TRAINING: Math.round(TRAINING.costCut * lv * 100), TRAINING2: Math.round(TRAINING.demandUp * lv * 100) })}</div><div>${tr('研修費(毎日)')}</div><div class="n">${yen(lv * TRAINING.dailyPerLevel)}</div></div>`;
    h += c.trainingPending
      ? `<div class="muted">${tr('レベル{to}へ研修中(あと{left}日)', { to: c.trainingPending.to, left: c.trainingPending.left })}</div>`
      : lv >= TRAINING.max
        ? `<div class="muted">${tr('最高レベルです')}</div>`
        : `<div class="frow"><button data-fa="train" ${c.cash < trainingCost(lv) ? 'disabled' : ''}>${tr('研修してレベル{lv}へ({trainingCost}・{days}日)', { lv: lv + 1, trainingCost: yen(trainingCost(lv)), days: TRAINING.days })}</button><span class="muted"> ${tr('レベルが上がるほど、研修費が毎日かかります')}</span></div>`;
    const ps = this.players();
    const nameOf = (id: number) => esc(ps.find((p) => p.id === id)?.name ?? tr('会社{id}', { id }));
    const pc = this.pacts();
    const mine = pc.pacts.filter((p) => p.a === net.id || p.b === net.id);
    const inbox = pc.proposals.filter((p) => p.to === net.id);
    const sent = pc.proposals.filter((p) => p.from === net.id);
    const others = ps.filter(
      (p) =>
        p.id !== net.id &&
        !pc.pacts.some((x) => (x.a === p.id && x.b === net.id) || (x.b === p.id && x.a === net.id)) &&
        !pc.proposals.some((x) => (x.from === p.id && x.to === net.id) || (x.to === p.id && x.from === net.id)),
    );
    if (!this.pactTo || !others.some((p) => p.id === this.pactTo)) this.pactTo = others[0]?.id ?? 0;
    h += `<h3>${tr('提携(乗り入れ契約)')}</h3><div class="muted">${tr('他社と合意すると、互いの線路・道路を通る通行料が割り引かれます(双方向)。どちらからでも解消できます')}</div>`;
    h += mine.length
      ? `<table><tr><th>${tr('相手')}</th><th>${tr('通行料の割引')}</th><th></th></tr>${mine.map((p) => `<tr><td>${nameOf(p.a === net.id ? p.b : p.a)}</td><td>${Math.round(p.discount * 100)}%</td><td><button data-pact="cancel" data-id="${p.id}">${tr('解消')}</button></td></tr>`).join('')}</table>`
      : `<div class="muted">${tr('提携中の会社はありません')}</div>`;
    for (const p of inbox)
      h += `<div class="frow">${tr('📨 {from} から申し込み(通行料 {p}% 割引)', { from: nameOf(p.from), p: Math.round(p.discount * 100) })} <button data-pact="accept" data-id="${p.id}">${tr('承諾')}</button><button data-pact="reject" data-id="${p.id}">${tr('断る')}</button></div>`;
    for (const p of sent)
      h += `<div class="frow">${tr('⏳ {to} へ申し込み中({p}% 割引)', { to: nameOf(p.to), p: Math.round(p.discount * 100) })} <button data-pact="cancel" data-id="${p.id}">${tr('取り下げ')}</button></div>`;
    h += others.length
      ? `<div class="frow">${tr('申し込む:')} <select data-pf="to">${others.map((p) => `<option value="${p.id}" ${p.id === this.pactTo ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select> ${tr('割引')} <select data-pf="disc">${PACT_DISCOUNTS.map((d) => `<option value="${d}" ${d === this.pactDisc ? 'selected' : ''}>${Math.round(d * 100)}%</option>`).join('')}</select> <button data-pact="propose">${tr('申し込む')}</button></div>`
      : `<div class="muted">${tr('申し込める会社がありません')}</div>`;
    h += `<h3>${tr('競合会社(買収できます)')}</h3>`;
    h += `<table><tr><th>${tr('会社')}</th><th>${tr('企業価値')}</th><th>${tr('利益/日')}</th><th>${tr('株価')}</th><th>${tr('買収額')}</th><th></th></tr>${rivals
      .map(
        (r) =>
          `<tr><td>${esc(r.name)}${r.acquired ? (r.acquiredBy === net.id ? ` <b>${tr('(傘下)')}</b>` : tr(' (他のプレイヤーの傘下)')) : ''}</td><td>${yen(r.value)}</td><td>${yen(r.profit)}</td><td>${yen(r.value / 100000)}</td><td>${r.acquired ? '-' : yen(acquirePrice(r))}</td><td>${
            r.acquired && r.acquiredBy !== net.id
              ? ''
              : r.acquired
                ? `<button data-fa="rival-sell" data-id="${r.id}" title="${tr('企業価値の80%で手放す')}">${tr('手放す({divestPrice})', { divestPrice: yen(divestPrice(r)) })}</button>`
                : `<button data-fa="rival-buy" data-id="${r.id}" ${c.cash < acquirePrice(r) ? 'disabled' : ''}>${tr('買収')}</button>`
          }</td></tr>`,
      )
      .join(
        '',
      )}</table><div class="muted">${tr('買収すると、その会社が持つ民間施設が自社のものになり、利益が毎日「子会社の利益」として入ります。企業価値は日々変動します。')}</div>`;
    h += `<h3>${tr('自社の施設(経営資源)')}</h3>`;
    h += own.length
      ? `<table><tr><th>${tr('施設')}</th><th>${tr('売上/日')}</th><th>${tr('維持費/日')}</th><th>${tr('来場者')}</th><th>${tr('評価額')}</th><th></th></tr>${own
          .map(
            (f) =>
              `<tr><td>${FACILITY_SPECS[f.type].icon} ${esc(f.name)}</td><td>${yen(f.income ?? 0)}</td><td>${yen(facilityUpkeep(f))}</td><td>${Math.floor(f.visits ?? 0)}</td><td>${yen(facilityValue(f))}</td><td><button data-fa="sell" data-id="${f.id}" title="${tr('評価額の60%で売却(他社のものになる)')}">${tr('売却')}</button></td></tr>`,
          )
          .join('')}</table>`
      : `<div class="muted">${tr('施設(百貨店・モール・スタジアムなど)を建てると、近くの駅・バス停に来た人が売上になります。')}</div>`;
    h += `<h3>${tr('他社の施設(買収できます)')}</h3>`;
    h += other.length
      ? `<table><tr><th>${tr('施設')}</th><th>${tr('来場者')}</th><th>${tr('評価額(買収額)')}</th><th></th></tr>${other
          .map(
            (f) =>
              `<tr><td>${FACILITY_SPECS[f.type].icon} ${esc(f.name)}</td><td>${Math.floor(f.visits ?? 0)}</td><td>${yen(facilityValue(f))}</td><td><button data-fa="acquire" data-id="${f.id}" ${c.cash < facilityValue(f) ? 'disabled' : ''}>${tr('買収')}</button></td></tr>`,
          )
          .join('')}</table>`
      : `<div class="muted">${tr('街が大きくなると、民間の百貨店・ホテル・モールが建ちます。買収すると自社の売上になります。')}</div>`;
    // Rewrite each part only when it changed (so button elements are not swapped every second)
    this.setParts(h);
  }

  /** Share price line chart (SVG) */
  private stockChart(hist: number[]): string {
    if (hist.length < 2) return `<div class="muted">${tr('1日が終わると表示されます')}</div>`;
    const w = 700;
    const h = 60;
    const lo = Math.min(...hist);
    const hi = Math.max(...hist);
    const pts = hist.map((v, i) => `${((i / (hist.length - 1)) * w).toFixed(1)},${(h - 4 - ((v - lo) / Math.max(1, hi - lo)) * (h - 8)).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="background:#0b1420;border-radius:6px"><polyline fill="none" stroke="#4bb0ff" stroke-width="2" points="${pts}"/></svg><div class="muted">${tr('高値 {hi} / 安値 {lo}', { hi: yen(hi), lo: yen(lo) })}</div>`;
  }

  private parts: string[] = [];

  /** Update differences for each part separated by h3 headings */
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
