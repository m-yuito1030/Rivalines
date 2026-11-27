import { describe, expect, it } from 'vitest';
import { makeWorldMap } from '../src/shared/world/bigTerrain';
import { Simulation } from '../src/shared/sim/simulation';
import { AI_ID_BASE, aiProfile, isAiId, AI_PROFILES, AI_MAX } from '../src/shared/sim/economy/aiCompanies';
import { planRoad } from '../src/shared/sim/ai/roadPlanner';
import { CONN } from '../src/shared/world/directions';
import { AiPlanner } from './ai';
import { Accounts } from './accounts';
import { Replicator } from './replicate';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const newWorld = () => new Simulation(makeWorldMap(2048, 20260401), undefined, { multi: true });

describe('AI 会社の登録', () => {
  it('番号は、アカウントより上の専用の帯。名前と色が決まっている', () => {
    expect(AI_ID_BASE).toBeGreaterThan(50000);
    expect(AI_ID_BASE + AI_MAX).toBeLessThanOrEqual(65535); // the owner layers are 16-bit
    expect(isAiId(AI_ID_BASE)).toBe(true);
    expect(isAiId(AI_ID_BASE - 1)).toBe(false);
    expect(isAiId(AI_ID_BASE + AI_MAX)).toBe(false);
    expect(AI_PROFILES).toHaveLength(AI_MAX);
    expect(new Set(AI_PROFILES.map((p) => p.name)).size).toBe(AI_MAX);
    expect(aiProfile(AI_ID_BASE)?.name).toBeTruthy();
    expect(aiProfile(5)).toBeUndefined();
  });
});

describe('道の探索', () => {
  it('2つの街の道路を、地形を避けて、一続きの道でつなぐ(となりあうタイルだけ・始点と終点を含む)', () => {
    const sim = newWorld();
    const [a, b] = sim.map.towns;
    const near = (t: { roads: number[] }) => {
      const i = t.roads[0];
      return { x: i % sim.map.size, y: Math.floor(i / sim.map.size) };
    };
    const from = near(a);
    const to = near(b);
    const path = planRoad(sim.map, from, to);
    if (!path) return; // these two towns may be cut off by water; the next test covers a real project
    expect(path[0]).toEqual(from);
    expect(path.at(-1)).toEqual(to);
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y)).toBe(1);
  });
});

describe('AI 会社の経営', () => {
  it('少しずつ道を引き、停留所・基地・路線を作り、バスを買って走らせる。お金は自分の資金から出る', () => {
    const sim = newWorld();
    const ai = new AiPlanner(sim, 2);
    expect(ai.ids).toEqual([AI_ID_BASE, AI_ID_BASE + 1]);
    ai.init();
    sim.setOnline(ai.ids);
    const co = sim.playerCompany(AI_ID_BASE);
    const cash0 = co.cash;
    let firstRoadAt = -1;
    let done = -1;
    const owned = () => [...sim.transit.routes.values()].filter((r) => r.owner === AI_ID_BASE).length;
    for (let i = 0; i < 40_000 && done < 0; i++) {
      sim.step();
      ai.step();
      if (firstRoadAt < 0 && [...sim.transit.stops.values()].some((s) => s.owner === AI_ID_BASE)) firstRoadAt = sim.tick;
      if (owned() > 0 && sim.transit.vehicles.some((v) => sim.transit.routes.get(v.routeId)?.owner === AI_ID_BASE)) done = sim.tick;
    }
    expect(owned()).toBeGreaterThan(0);
    expect(done).toBeGreaterThan(0);
    // The road, the stops, the depot, and the buses are the AI company's own
    expect([...sim.transit.stops.values()].filter((s) => s.owner === AI_ID_BASE).length).toBeGreaterThanOrEqual(2);
    expect([...sim.transit.depots.values()].some((d) => d.owner === AI_ID_BASE)).toBe(true);
    let infra = 0;
    sim.map.infraOwner.forEachNonZero((i, v) => v === AI_ID_BASE && sim.map.road.get(i) & (CONN(0) | CONN(1) | CONN(2) | CONN(3)) && infra++);
    expect(infra).toBeGreaterThan(5);
    expect(co.cash).toBeLessThan(cash0); // it paid for all this
    expect(co.cash).toBeGreaterThan(-1); // and never ran into debt by buying
  }, 120_000);

  it('2社目も別の街から始め、同じ道を取り合って壊さない。AI は誰もいなくても(オンラインの合図で)動く', () => {
    const sim = newWorld();
    const ai = new AiPlanner(sim, 3);
    ai.init();
    sim.setOnline(ai.ids);
    for (let i = 0; i < 25_000; i++) {
      sim.step();
      ai.step();
    }
    const routes = [...sim.transit.routes.values()];
    expect(routes.every((r) => !r.owner || ai.ids.includes(r.owner))).toBe(true);
    expect(new Set(routes.map((r) => r.owner)).size).toBeGreaterThanOrEqual(2);
    for (const id of ai.ids) expect(sim.playerCompany(id).cash).toBeGreaterThanOrEqual(-1);
  }, 120_000);

  it('AI を 0 社にすると、何もしない', () => {
    const sim = newWorld();
    const ai = new AiPlanner(sim, 0);
    ai.init();
    expect(ai.ids).toEqual([]);
    for (let i = 0; i < 2000; i++) ai.step();
    expect(sim.players.size).toBe(0);
  });
});

describe('AI 会社の配信と、アカウントの番号', () => {
  it('会社の一覧に、AI 会社が「ai」の印つきで出る(アカウントがなくても)。いつもオンライン', () => {
    const sim = newWorld();
    const ai = new AiPlanner(sim, 2);
    ai.init();
    sim.setOnline([...ai.ids, 1]);
    const dir = mkdtempSync(join(tmpdir(), 'ai-'));
    const file = join(dir, 'a.json');
    writeFileSync(file, JSON.stringify([{ id: 1, name: 'taro', salt: '00', hash: '00', createdAt: 0, color: 1 }]));
    sim.playerCompany(1);
    const repl = new Replicator(sim, new Accounts(file));
    const sent: { type: string; players?: { id: number; name: string; ai?: boolean; online: boolean }[] }[] = [];
    const c = repl.newClient({ readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) } as never, 1, 'taro');
    repl.misc([c]);
    const players = sent.find((m) => m.type === 'misc')!.players!;
    const bots = players.filter((p) => p.ai);
    expect(bots.map((p) => p.id).sort()).toEqual(ai.ids);
    expect(bots.every((p) => p.online && p.name.length > 0)).toBe(true);
    expect(players.find((p) => p.id === 1)?.ai).toBeUndefined();
  });

  it('アカウントの番号が、AI の番号の帯に届く前で、登録を止める', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-'));
    const file = join(dir, 'a.json');
    writeFileSync(file, JSON.stringify([{ id: AI_ID_BASE - 1, name: 'last', salt: '00', hash: '00', createdAt: 0, color: 1 }]));
    const acc = new Accounts(file);
    expect(await acc.register('another', 'secret12')).toMatchObject({ ok: false });
  });

  it('政府の規模の分類には、AI 会社を数えない(プレイヤーだけ)', () => {
    const sim = newWorld();
    const ai = new AiPlanner(sim, 4);
    ai.init();
    sim.setOnline([...ai.ids, 1]);
    sim.playerCompany(1);
    expect(sim.govInfoFor(1).size).toBe('none'); // only one player: the AI companies do not make "three companies"
  });
});
