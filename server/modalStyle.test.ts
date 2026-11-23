import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/client/style.css', import.meta.url), 'utf8');

/** スマホ用の指定(画面に収める・タイトルと「閉じる」を常に見える位置に)を含む @media ブロックの本文 */
const mobileBlock = (): string => {
  const i = css.indexOf('@media (pointer: coarse), (max-width: 820px) {\n  #menu, #fin-modal');
  expect(i).toBeGreaterThan(0);
  return css.slice(i, css.indexOf('\n}\n', i));
};

describe('全画面ウィンドウのスマホ用スタイル', () => {
  it('どのウィンドウ(#xxx-modal)も、スマホ用の「画面に収める」「タイトルを固定」の指定に入っている(新しいウィンドウの書き忘れ防止)', () => {
    // ウィンドウの外枠として定義されているもの: `#xxx-modal { position: fixed; ...`
    const ids = [...css.matchAll(/^#([a-z]+-modal) \{ position: fixed/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    const mobile = mobileBlock();
    for (const id of ids) {
      expect(mobile, `#${id} の外枠`).toMatch(new RegExp(`#${id}(,| \\{)`));
      expect(mobile, `#${id} .box`).toContain(`#${id} .box`);
      expect(mobile, `#${id} h2(タイトルと閉じるボタンの固定)`).toContain(`#${id} h2`);
    }
  });

  it('メニュー(#menu)は、パソコンでも画面に収まり(縦にスクロール)、タイトル行に ✕ がある', () => {
    expect(css).toMatch(/^#menu \.box \{[^}]*max-height: 92vh; overflow: auto/m);
    expect(readFileSync('index.html', 'utf8')).toMatch(/<h2>プレイヤー <button[^>]*id="menuX"/);
  });
});
