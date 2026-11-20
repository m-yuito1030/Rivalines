import { SLOTS, SLOT_LABEL } from '../../shared/save/storage';
import type { SaveMeta } from '../../shared/save/serialize';

export interface SlotHandlers {
  onSave?: (key: string) => void;
  onLoad: (key: string) => void;
  onDelete: (key: string) => void;
}

/** スロット一覧を描画する。onSave を渡すと「保存」ボタンも出る(ゲーム中のみ) */
export function renderSlots(el: HTMLElement, metas: Record<string, SaveMeta>, h: SlotHandlers): void {
  el.replaceChildren();
  for (const key of SLOTS) {
    const m = metas[key];
    const row = document.createElement('div');
    row.className = 'slot';
    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('b');
    title.textContent = SLOT_LABEL[key];
    const sub = document.createElement('span');
    sub.textContent = m ? `${m.gameDate} / ${m.size}² / 街${m.towns} 人口${m.pop} 車両${m.vehicles} (${new Date(m.savedAt).toLocaleString('ja-JP')})` : '(空)';
    info.append(title, sub);
    row.append(info);
    const btn = (label: string, fn: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.disabled = disabled;
      b.addEventListener('click', fn);
      row.append(b);
    };
    if (h.onSave && key !== 'auto') btn('保存', () => h.onSave!(key));
    btn('読込', () => h.onLoad(key), !m);
    btn('削除', () => h.onDelete(key), !m);
    el.append(row);
  }
}
