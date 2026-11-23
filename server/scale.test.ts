import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/shared/world/gameMap';
import { Simulation } from '../src/shared/sim/simulation';
import { SEA_LEVEL } from '../src/shared/world/constants';
import { Accounts } from './accounts';
import { Replicator } from './replicate';
import { WindowLimiter } from './limits';

/** アカウントがたくさんあっても、配信する会社の一覧が膨らまない */
describe('スケール: アカウントの数に上限がない', () => {
  it('会社の一覧は、オンラインの会社と、オフラインの上位だけ。計算も少しずつ', () => {
    const N = 500;
    const dir = mkdtempSync(join(tmpdir(), 'scale-'));
    const file = join(dir, 'a.json');
    const list = Array.from({ length: N }, (_, i) => ({ id: i + 1, name: `p${i + 1}`, salt: '00', hash: '00', createdAt: 0, color: i }));
    writeFileSync(file, JSON.stringify(list));
    const accounts = new Accounts(file);
    expect(accounts.count).toBe(N);
    const map = new GameMap(64, 1, new Uint8Array(64 * 64).fill(SEA_LEVEL + 20));
    const sim = new Simulation(map, undefined, { multi: true });
    for (let id = 1; id <= N; id++) sim.playerCompany(id);
    // 会社ごとに時価総額を変えて、上位がどれか分かるようにする
    for (let id = 1; id <= N; id++) sim.playerCompany(id).stock = 100 + id;
    sim.setOnline([3, 4]);
    const repl = new Replicator(sim, accounts);
    const sent: { type: string; players?: { id: number; online: boolean }[] }[] = [];
    const c = repl.newClient({ readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) } as never, 3, 'p3');
    // 最初の配信: オフラインの会社は、まだ少ししか計算していないので、一覧が小さい
    repl.misc([c]);
    const first = sent.at(-1)!.players!;
    expect(
      first
        .filter((p) => p.online)
        .map((p) => p.id)
        .sort(),
    ).toEqual([3, 4]);
    expect(first.length).toBeLessThanOrEqual(2 + 60);
    // 何度か配信すると、計算し直しが進み、時価総額の上位60社が載る(全500社は載らない)
    for (let i = 0; i < 80; i++) repl.misc([c]);
    const later = sent.at(-1)!.players!;
    expect(later.length).toBe(2 + 60);
    const offlineIds = later.filter((p) => !p.online).map((p) => p.id);
    expect(offlineIds).toHaveLength(60);
    // 時価総額が高い(ID が大きい)順の上位
    expect(Math.min(...offlineIds)).toBeGreaterThan(N - 60 - 2);
    expect(later.every((p) => p.online === (p.id === 3 || p.id === 4))).toBe(true);
  });
});

describe('新規登録の頻度(サーバー全体)', () => {
  it('1時間あたりの上限まで受け付け、超えたら断る。時間がたてば、また受け付ける', () => {
    let now = 0;
    const lim = new WindowLimiter(3, 3_600_000, () => now);
    const take = (t: number) => {
      now = t;
      return lim.tryTake();
    };
    expect([take(0), take(10), take(20), take(30)]).toEqual([true, true, true, false]);
    expect(take(3_599_999)).toBe(false);
    expect(take(3_600_000)).toBe(true); // 最初の1件が窓から出た
    expect(take(3_600_001)).toBe(false); // 2件目(t=10)はまだ窓の中
    expect(take(3_600_010)).toBe(true); // 2件目も出た
  });
});
