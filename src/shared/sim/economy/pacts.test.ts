import { describe, expect, it } from 'vitest';
import { MAX_PROPOSALS, Pacts } from './pacts';

describe('提携', () => {
  it('申し込み→承諾で成立し、双方向に割引が効く。割引率の不正・自社・重複は不可', () => {
    const p = new Pacts();
    expect(p.propose(1, 1, 0.5)).not.toBeNull();
    expect(p.propose(1, 2, 0.3)).not.toBeNull();
    expect(p.propose(1, 2, 0.5)).toBeNull();
    expect(p.propose(2, 1, 0.5)).not.toBeNull(); // 逆向きの重複
    expect(p.discountBetween(1, 2)).toBe(0); // 承諾前は割引なし
    const id = p.proposals[0].id;
    expect(p.respond(1, id, true)).not.toBeNull(); // 申し込んだ側は返事できない
    expect(p.respond(3, id, true)).not.toBeNull();
    expect(p.respond(2, id, true)).toBeNull();
    expect(p.discountBetween(1, 2)).toBe(0.5);
    expect(p.discountBetween(2, 1)).toBe(0.5);
    expect(p.discountBetween(1, 3)).toBe(0);
    expect(p.discountBetween(1, 1)).toBe(0);
    expect(p.propose(1, 2, 1)).not.toBeNull(); // 提携中
  });

  it('断る・取り下げ・解消(当事者のみ)', () => {
    const p = new Pacts();
    p.propose(1, 2, 0.25);
    expect(p.respond(2, p.proposals[0].id, false)).toBeNull();
    expect(p.proposals).toHaveLength(0);
    expect(p.pacts).toHaveLength(0);
    p.propose(1, 2, 0.25);
    expect(p.cancel(2, p.proposals[0].id)).not.toBeNull(); // 取り下げは申し込んだ側だけ
    expect(p.cancel(1, p.proposals[0].id)).toBeNull();
    p.propose(1, 2, 1);
    p.respond(2, p.proposals[0].id, true);
    const id = p.pacts[0].id;
    expect(p.cancel(3, id)).not.toBeNull();
    expect(p.cancel(2, id)).toBeNull(); // 受けた側からも解消できる
    expect(p.discountBetween(1, 2)).toBe(0);
  });

  it('申し込みは同時に上限まで。セーブ・復元ができる', () => {
    const p = new Pacts();
    for (let i = 0; i < MAX_PROPOSALS; i++) expect(p.propose(1, 10 + i, 0.5)).toBeNull();
    expect(p.propose(1, 99, 0.5)).not.toBeNull();
    p.respond(10, p.proposals[0].id, true);
    const q = new Pacts();
    q.load(JSON.parse(JSON.stringify(p.toJSON())));
    expect(q.discountBetween(1, 10)).toBe(0.5);
    expect(q.proposals).toHaveLength(MAX_PROPOSALS - 1);
    expect(q.propose(2, 3, 0.5)).toBeNull();
    expect(new Set([...q.pacts.map((x) => x.id), ...q.proposals.map((x) => x.id)]).size).toBe(q.pacts.length + q.proposals.length);
  });
});
