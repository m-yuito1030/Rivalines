import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/shared/world/gameMap';
import { Simulation } from '../src/shared/sim/simulation';
import { SEA_LEVEL } from '../src/shared/world/constants';
import { isForSale } from '../src/shared/sim/facility/listings';
import { execute } from './commands/index';
import { Accounts } from './accounts';
import { Reports } from './reports';

const tmp = () => mkdtempSync(join(tmpdir(), 'mod-'));

describe('アカウントの管理', () => {
  it('BAN するとトークンが使えず、解除すれば戻る。理由は保存される', async () => {
    const acc = new Accounts(join(tmp(), 'a.json'));
    const r = await acc.register('taro', 'secret12');
    if (!r.ok) throw new Error('register');
    const t = acc.issueToken(r.account.id);
    expect(acc.fromToken(t)?.id).toBe(r.account.id);
    acc.setBan(r.account.id, '迷惑行為');
    expect(acc.fromToken(t)).toBeNull();
    expect(acc.byId(r.account.id)!.banned?.reason).toBe('迷惑行為');
    acc.setBan(r.account.id, null);
    expect(acc.fromToken(t)?.id).toBe(r.account.id);
  });

  it('パスワードを変えると、それまでのトークンは無効になり、新しいパスワードで入れる', async () => {
    const acc = new Accounts(join(tmp(), 'a.json'));
    const r = await acc.register('taro', 'secret12');
    if (!r.ok) throw new Error('register');
    const old = acc.issueToken(r.account.id);
    expect(await acc.setPassword(r.account.id, 'short')).toMatch(/6文字/);
    expect(await acc.setPassword(r.account.id, 'newsecret1')).toBeNull();
    expect(acc.fromToken(old)).toBeNull();
    expect(await acc.verify('taro', 'secret12')).toBeNull();
    expect((await acc.verify('taro', 'newsecret1'))?.id).toBe(r.account.id);
  });

  it('会社名・プロフィールを消せる。名前または #ID で探せる', async () => {
    const acc = new Accounts(join(tmp(), 'a.json'));
    const r = await acc.register('Taro', 'secret12');
    if (!r.ok) throw new Error('register');
    acc.setProfile(r.account.id, { company: 'ひどい名前', bio: 'ひどい文', color: 1 });
    acc.clearText(r.account.id);
    expect(acc.byId(r.account.id)).toMatchObject({ company: undefined, bio: undefined });
    expect(acc.find('taro')?.id).toBe(r.account.id);
    expect(acc.find(`#${r.account.id}`)?.name).toBe('Taro');
    expect(acc.find('#999')).toBeUndefined();
  });

  it('削除したアカウントのIDは、再起動しても、あとから登録した人に使い回されない', async () => {
    const file = join(tmp(), 'a.json');
    const acc = new Accounts(file);
    const a = await acc.register('aaa', 'secret12');
    const b = await acc.register('bbb', 'secret12');
    if (!a.ok || !b.ok) throw new Error('register');
    expect(acc.remove(b.account.id)).toBe(true);
    expect(acc.find('bbb')).toBeUndefined();
    const again = new Accounts(file); // 再起動
    const c = await again.register('ccc', 'secret12');
    if (!c.ok) throw new Error('register');
    expect(c.account.id).toBeGreaterThan(b.account.id);
    expect(again.count).toBe(2);
    expect(await again.register('bbb', 'secret12')).toMatchObject({ ok: true }); // 名前は空く
  });
});

describe('通報', () => {
  const me = { id: 1, name: 'a' };
  const you = { id: 2, name: 'b' };
  it('理由が必要・自分は不可・同じ相手は1日1回・1日5件まで。保存され、対応済みにすると消える', () => {
    const file = join(tmp(), 'r.json');
    const r = new Reports(file);
    expect(r.add(me, me, 'x')).toMatch(/自分/);
    expect(r.add(me, you, '  ')).toMatch(/理由/);
    expect(r.add(me, you, 'あ'.repeat(201))).toMatch(/200/);
    expect(r.add(me, you, '暴言')).toBeNull();
    expect(r.add(me, you, '暴言')).toMatch(/すでに/);
    for (let i = 3; i <= 6; i++) expect(r.add(me, { id: i, name: `n${i}` }, '迷惑')).toBeNull();
    expect(r.add(me, { id: 7, name: 'n7' }, '迷惑')).toMatch(/1日5件/);
    expect(r.add(me, { id: 8, name: 'n8' }, '迷惑', Date.now() + 25 * 3600 * 1000)).toBeNull(); // 翌日は、また出せる
    expect(new Reports(file).all()).toHaveLength(6);
    expect(r.dismiss({ target: 2 })).toBe(1);
    expect(new Reports(file).all().some((x) => x.target === 2)).toBe(false);
  });
});

describe('会社の削除(sim.removePlayer)', () => {
  it('施設は売り出し物件になり、停留所・提携・競りの入札・許可が片付く。他社のものは残る', () => {
    const size = 128;
    const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 20));
    const sim = new Simulation(map, undefined, { multi: true });
    for (let i = 0; i < size * size; i++) {
      map.building.set(i, 0);
      map.road.set(i, 0);
      map.owner.set(i, 0);
    }
    map.towns.length = 0;
    map.facilities.length = 0;
    sim.setOnline([1, 2]);
    execute(sim, 1, { t: 'place', tool: 'hotel', x: 40, y: 40, fac: { design: 3, size: 'M' } });
    execute(sim, 2, { t: 'place', tool: 'hotel', x: 60, y: 60, fac: { design: 3, size: 'M' } });
    execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 110, y: 100 } });
    const s1 = sim.transit.addStop(95, 100)!;
    s1.owner = 1;
    const s2 = sim.transit.addStop(105, 100)!;
    s2.owner = 2;
    s2.allow = [1];
    sim.transit.grants.set(2, new Set([1]));
    sim.pacts.pacts.push({ id: 1, a: 1, b: 2, discount: 0.5 });
    sim.removePlayer(1);
    const [h1, h2] = sim.map.facilities;
    expect(isForSale(h1!)).toBe(true);
    expect(h1!.playerId).toBeUndefined();
    expect(h2!.playerId).toBe(2);
    expect(sim.transit.stops.has(s1.id)).toBe(false);
    expect(sim.transit.stops.has(s2.id)).toBe(true);
    expect(s2.allow).toEqual([]);
    expect(sim.transit.grants.get(2)?.has(1)).toBe(false);
    expect(sim.pacts.pacts).toHaveLength(0);
    expect(sim.players.has(1)).toBe(false);
    expect(sim.players.has(2)).toBe(true);
  });
});
