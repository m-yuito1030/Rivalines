import './guide.css';
import { esc } from '../app/dom';
import { tr } from '../i18n';
import { net } from '../connection/net';
import type { Transit } from '../../shared/sim/network/transit';
import { guideProgress } from './guideProgress';

const OFF_KEY = 'rivalines-guide-off';

interface Step {
  title: string;
  hint: string;
  done: boolean;
  /** The button that gets the player started on this step */
  action?: { label: string; run: () => void };
}

/**
 * The first-steps card. It lists what to do to get the first bus route running (two stops, a depot, a route, a bus) and ticks each step off by itself,
 * looking at what the company has. It goes away for good once the first bus is bought, or when the player closes it (the menu can bring it back).
 */
export class FirstGuide {
  private readonly el = document.createElement('div');
  private lastKey = '';
  private mini = false;
  /** The player asked for the card from the menu: show it even when every step is done (as the "what next" card) */
  private asked = false;

  constructor(
    private readonly transit: Transit,
    private readonly actions: { stop: () => void; depot: () => void; routes: () => void; manual: () => void },
  ) {
    this.el.id = 'guide';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.mini = window.matchMedia('(max-width: 700px)').matches;
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-g=close]')) return this.close();
      if (t.closest('[data-g=manual]')) return this.actions.manual();
      const step = t.closest<HTMLElement>('[data-g-step]');
      if (step) return this.stepActions[Number(step.dataset.gStep)]?.();
      if (this.mini) {
        this.mini = false;
        this.lastKey = '';
        this.update();
      }
    });
  }

  private stepActions: (() => void)[] = [];

  /** Bring the card back (the menu's "How to start") */
  show(): void {
    this.asked = true;
    localStorage.removeItem(OFF_KEY);
    this.mini = false;
    this.lastKey = '';
    this.update();
  }

  private close(): void {
    this.asked = false;
    localStorage.setItem(OFF_KEY, '1');
    this.el.hidden = true;
  }

  private steps(): Step[] {
    const { stops, depots, routes, buses } = guideProgress(this.transit, net.id);
    return [
      {
        title: tr('バス停を2つ置く'),
        hint: tr('道路の上を2か所クリック。建物の多い場所がおすすめ({n}/2)', { n: Math.min(2, stops) }),
        done: stops >= 2,
        action: { label: tr('バス停の道具 (B)'), run: this.actions.stop },
      },
      {
        title: tr('車両基地を置く'),
        hint: tr('道路の上を1か所クリック。バスはここから出ます'),
        done: depots >= 1,
        action: { label: tr('車両基地の道具'), run: this.actions.depot },
      },
      {
        title: tr('路線を作る'),
        hint: tr('路線パネルで「＋🚌」→ バス停を順にクリック → Enter'),
        done: routes >= 1,
        action: { label: tr('路線パネルを開く'), run: this.actions.routes },
      },
      {
        title: tr('バスを買う'),
        hint: tr('路線パネルの「＋車両」。基地の入口が空くまで、続けて買えないことがあります'),
        done: buses >= 1,
        action: { label: tr('路線パネルを開く'), run: this.actions.routes },
      },
    ];
  }

  /** Called every second or two */
  update(): void {
    if (localStorage.getItem(OFF_KEY)) return void (this.el.hidden = true);
    const steps = this.steps();
    const doneN = steps.filter((s) => s.done).length;
    // Finished: the card has done its job
    if (doneN === steps.length) {
      if (!this.asked) {
        this.el.hidden = true;
        localStorage.setItem(OFF_KEY, '1');
        return;
      }
      // Asked for from the menu after finishing: say what to do next
      if (this.lastKey === 'next') return;
      this.lastKey = 'next';
      this.el.hidden = false;
      this.el.classList.remove('mini');
      this.el.innerHTML = `<h3><span>🎉 ${esc(tr('最初のバス路線ができました'))}</span><button type="button" data-g="close" title="${esc(tr('閉じる'))}">✕</button></h3>
        <div class="body"><ol>
          <li><span class="mark">•</span><div class="t">${esc(tr('バス停と路線を増やして、街と街をつなぎましょう'))}</div></li>
          <li><span class="mark">•</span><div class="t">${esc(tr('路線パネルの「通行料」が運賃収入の3割を超えたら、自社の道路で走れないか考えましょう'))}</div></li>
          <li><span class="mark">•</span><div class="t">${esc(tr('現金は「経営 (F)」で見られます'))}</div></li>
        </ol><div class="foot">${esc(tr('くわしくは'))} <a href="#" data-g="manual">${esc(tr('マニュアル'))}</a></div></div>`;
      return;
    }
    const now = steps.findIndex((s) => !s.done);
    const key = `${steps.map((s) => (s.done ? 1 : 0)).join('')}|${this.mini ? 1 : 0}|${steps[0].hint}`;
    this.el.hidden = false;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.el.classList.toggle('mini', this.mini);
    this.stepActions = steps.map((s) => s.action?.run ?? (() => {}));
    this.el.innerHTML = this.mini
      ? `<h3>❓ ${esc(tr('はじめかた'))} ${doneN}/${steps.length}</h3>`
      : `<h3><span>❓ ${esc(tr('はじめかた'))} ${doneN}/${steps.length}</span><button type="button" data-g="close" title="${esc(tr('閉じる(メニューからまた開けます)'))}">✕</button></h3>
        <div class="body"><ol>${steps
          .map(
            (s, i) =>
              `<li class="${s.done ? 'done' : i === now ? 'now' : ''}"><span class="mark">${s.done ? '✓' : i + 1}</span><div class="t">${esc(s.title)}<small>${esc(s.hint)}</small>${
                i === now && s.action ? `<button type="button" data-g-step="${i}">${esc(s.action.label)}</button>` : ''
              }</div></li>`,
          )
          .join('')}</ol>
        <div class="foot">${esc(tr('くわしくは'))} <a href="#" data-g="manual">${esc(tr('マニュアル'))}</a></div></div>`;
  }
}
