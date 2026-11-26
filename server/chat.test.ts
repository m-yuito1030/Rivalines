import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Chat, CHAT_KEEP } from './chat';
import { Announcements } from './announcements';

const a = { id: 1, name: '白見急行' };
const b = { id: 2, name: 'taro' };

describe('全体チャット', () => {
  it('発言できる。空・長すぎる・タグや制御文字は、除くか断る', () => {
    const c = new Chat();
    expect(c.post(a, '   ')).toMatchObject({ ok: false });
    expect(c.post(a, 'あ'.repeat(101))).toMatchObject({ ok: false });
    const r = c.post(a, 'こんにちは\n<b>世界</b>', 1000);
    expect(r.ok && r.msg.text).toBe('こんにちは b 世界 /b');
    expect(r.ok && r.msg).toMatchObject({ from: 1, name: '白見急行', at: 1000 });
  });

  it('連投は10秒に5件まで。同じ発言を30秒以内に続けて送れない。別の人には影響しない', () => {
    const c = new Chat();
    for (let i = 0; i < 5; i++) expect(c.post(a, `発言${i}`, 1000 + i)).toMatchObject({ ok: true });
    expect(c.post(a, '6つ目', 1100)).toMatchObject({ ok: false });
    expect(c.post(b, '別の人', 1100)).toMatchObject({ ok: true });
    expect(c.post(a, '発言0', 20_000)).toMatchObject({ ok: false }); // 同じ文
    expect(c.post(a, '新しい文', 20_000)).toMatchObject({ ok: true });
    expect(c.post(a, '発言0', 40_000)).toMatchObject({ ok: true }); // 30秒たてばよい
  });

  it('履歴は直近100件だけで、ディスクには書かない(メモリの中だけ)。止められた人は発言できず、解除できる', () => {
    const c = new Chat();
    for (let i = 0; i < CHAT_KEEP + 20; i++) c.post({ id: 100 + i, name: 'n' }, `m${i}`, 1000 + i);
    const log = c.recentLog();
    expect(log).toHaveLength(CHAT_KEEP);
    expect(log.at(-1)!.text).toBe(`m${CHAT_KEEP + 19}`);
    c.mute(1, 10, 5000);
    expect(c.post(a, 'こんにちは', 6000)).toMatchObject({ ok: false });
    expect(c.post(a, 'こんにちは', 5000 + 11 * 60000)).toMatchObject({ ok: true });
    c.mute(1, 10, 5000);
    c.mute(1, 0);
    expect(c.post(a, 'また', 7000)).toMatchObject({ ok: true });
  });

  it('退会・BANした人の発言は、履歴から消える', () => {
    const c = new Chat();
    c.post(a, 'one', 1);
    c.post(b, 'two', 2);
    c.forget(1);
    expect(c.recentLog().map((m) => m.text)).toEqual(['two']);
  });
});

describe('お知らせ', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'news-')), 'announcements.json');

  it('足す・新しい順に読む・消せる。再読み込みしても残る。長すぎるものは断る', () => {
    const f = file();
    const n = new Announcements(f);
    expect(n.list()).toEqual([]);
    expect(n.add('', '本文')).toMatchObject({ ok: false });
    expect(n.add('あ'.repeat(41), '本文')).toMatchObject({ ok: false });
    expect(n.add('題', 'x'.repeat(501))).toMatchObject({ ok: false });
    n.add('一つ目', '本文1', 1);
    n.add('二つ目', '行1\n行2<b>', 2);
    expect(n.list().map((x) => x.title)).toEqual(['二つ目', '一つ目']);
    expect(n.list()[0].body).toBe('行1\n行2b');
    expect(new Announcements(f).list()).toHaveLength(2);
    expect(n.remove(1)).toBe(true);
    expect(n.remove(99)).toBe(false);
    expect(new Announcements(f).list().map((x) => x.id)).toEqual([2]);
  });

  it('読み取り専用(次期バージョン)は、本稼働のファイルを読むだけで、書けない。ファイルの更新に追随する', () => {
    const f = file();
    const live = new Announcements(f);
    const follow = new Announcements(f, true);
    expect(follow.list()).toEqual([]);
    expect(follow.add('x', 'y')).toMatchObject({ ok: false });
    live.add('お知らせ', '本文', 5);
    expect(follow.list().map((x) => x.title)).toEqual(['お知らせ']);
    writeFileSync(f, '壊れたデータ');
    expect(follow.list()).toEqual([]); // 壊れていても落ちない
  });

  it('30件までしか残さない(古いものから消える)', () => {
    const n = new Announcements(file());
    for (let i = 1; i <= 35; i++) n.add(`t${i}`, 'b', i);
    expect(n.list()).toHaveLength(30);
    expect(n.list()[0].title).toBe('t35');
  });
});
