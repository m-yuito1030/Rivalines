import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/shared/world/gameMap';
import { Simulation } from '../src/shared/sim/simulation';
import { SEA_LEVEL } from '../src/shared/world/constants';
import { execute } from './commands/index';
import { Replicator } from './replicate';
import { Accounts } from './accounts';

/** 道路・停留所2つ(乗客が多い)・路線・基地・車両1台。自社(プレイヤー1)のもの */
const setup = () => {
  const map = new GameMap(128, 1, new Uint8Array(128 * 128).fill(SEA_LEVEL + 20));
  const sim = new Simulation(map, undefined, { multi: true });
  for (let i = 0; i < map.size * map.size; i++) {
    map.building.set(i, 0);
    map.road.set(i, 0);
    map.owner.set(i, 0);
  }
  map.towns.length = 0;
  map.facilities.length = 0;
  sim.setOnline([1]);
  execute(sim, 1, { t: 'build', tool: 'road', a: { x: 90, y: 100 }, b: { x: 120, y: 100 } });
  const a = execute(sim, 1, { t: 'ensureStop', x: 92, y: 100, kind: 'road' });
  const b = execute(sim, 1, { t: 'ensureStop', x: 118, y: 100, kind: 'road' });
  const rt = execute(sim, 1, { t: 'routeCreate', stops: [a.id!, b.id!] });
  const dp = execute(sim, 1, { t: 'place', tool: 'depot', x: 95, y: 100 });
  execute(sim, 1, { t: 'buyVehicle', depotId: dp.id!, routeId: rt.id!, modelId: sim.transit.routes.get(rt.id!)!.modelId, cars: 1 });
  return { sim, map, a: a.id!, b: b.id! };
};

describe('乗降客数と、車両が稼いだ額を画面へ送る', () => {
  it('停車中の車両は、いま乗った人数・降りた人数を持ち、稼いだ額が自社の画面にだけ送られる', () => {
    const { sim, map, a, b } = setup();
    // 自社の画面(プレイヤー1)と、他社の画面(プレイヤー2)
    const sent: Record<number, { type: string; veh?: { state: string; on: number; off: number }[]; earn?: [number, number][] }[]> = { 1: [], 2: [] };
    const repl = new Replicator(sim, new Accounts('/tmp/none-' + Math.random() + '.json'));
    const mk = (id: number) => {
      const c = repl.newClient({ readyState: 1, send: (s: string) => sent[id].push(JSON.parse(s)) } as never, id, `p${id}`);
      repl.setView(c, 80, 90, 130, 110);
      return c;
    };
    const c1 = mk(1);
    const c2 = mk(2);
    let sawBoard = false;
    let sawEarn = false;
    for (let i = 0; i < 2500; i++) {
      // 街がないので、乗客は停留所へ直接足す(互いの停留所へ行く人)
      if (i % 20 === 0) {
        sim.transit.flow.addWaiting(sim.transit.stops.get(a)!, b, 15);
        sim.transit.flow.addWaiting(sim.transit.stops.get(b)!, a, 15);
      }
      sim.advance(0.1, 1000);
      repl.frame([c1, c2]);
    }
    for (const m of sent[1]) {
      if (m.type !== 'frame') continue;
      if (m.veh?.some((v) => v.state === 'load' && v.on + v.off > 0)) sawBoard = true;
      if (m.earn?.length) sawEarn = true;
    }
    expect(sawBoard).toBe(true);
    expect(sawEarn).toBe(true);
    // 他社の画面には、稼いだ額は送られない
    expect(sent[2].some((m) => m.type === 'frame' && (m.earn?.length ?? 0) > 0)).toBe(false);
    void map;
  });
});
