import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EN } from '../src/shared/i18n/en';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** Messages only the operators see (the admin API and the admin command), which are not translated */
const OPERATOR_ONLY = new Set(['鍵が違います', 'そのお知らせはありません', '分は 0〜43200 で指定してください(0 で解除)']);

describe('サーバーが返すメッセージの英訳', () => {
  it("プレイヤーに返す理由('…' の reason / 戻り値)は、すべて英語に訳してある", () => {
    const files = ['server/index.ts', 'server/accounts.ts', 'server/reports.ts', 'server/chat.ts'];
    const found = new Set<string>();
    for (const f of files) {
      for (const m of read(f).matchAll(/(?:reason: |return |: )'([^'\n]*[぀-ヿ一-鿿][^'\n]*)'/g)) found.add(m[1]);
    }
    // Only judge the sentences that are returned as a reason (the ones that start the way our reasons do)
    const missing = [...found]
      .filter((s) => !OPERATOR_ONLY.has(s) && EN[`ja:${s}`] === undefined && !s.includes('${'))
      .filter((s) => /[。を]|です|ません|ください|しました/.test(s));
    expect(missing).toEqual([]);
  });
});
