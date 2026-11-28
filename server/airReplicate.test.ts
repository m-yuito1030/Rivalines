import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/shared/world/gameMap';
import { Simulation } from '../src/shared/sim/simulation';
import { SEA_LEVEL } from '../src/shared/world/constants';
import { airportAt } from '../src/shared/world/airports';
import { Mirror } from '../src/client/connection/mirror';
import type { ServerMsg } from '../src/shared/protocol';
import { execute } from './commands/index';
import { Replicator } from './replicate';
import { Accounts } from './accounts';

/**
 * The real path from the server to the screen for aircraft: commands build two airports and a route, aircraft fly,
 * the Replicator sends frames, and a client Mirror (what the browser runs) applies them. The aircraft the screen sees must be
 * where the server has them, and the aircraft path must be sent once (afterwards only how far it has gone).
 */
describe('飛行機の経路が、サーバーから画面へ正しく届く', () => {
  it('コマンドで空港 2 つ・路線・機体を作り、飛ばす。画面側の飛行機は、サーバーの位置と同じ。経路は 1 回だけ送られる', () => {
    const size = 300;
    const map = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 20));
    const sim = new Simulation(map, undefined, { multi: true });
    for (let i = 0; i < size * size; i++) {
      map.building.set(i, 0);
      map.road.set(i, 0);
      map.owner.set(i, 0);
    }
    map.towns.length = 0;
    map.facilities.length = 0;
    sim.setOnline([1]);
    const co = sim.playerCompany(1);
    co.cash = 1_000_000_000;

    // Two airports (medium and small) 100 tiles apart, a route, a depot on a hangar, and aircraft
    const a = execute(sim, 1, { t: 'place', tool: 'airport', x: 40, y: 100, air: { size: 'M', axis: 'x' } });
    const b = execute(sim, 1, { t: 'place', tool: 'airport', x: 150, y: 100, air: { size: 'S', axis: 'x' } });
    expect(a.ok, a.msg).toBe(true);
    expect(b.ok, b.msg).toBe(true);
    const ap = airportAt(map, map.idx(40, 100))!;
    expect(ap.size).toBe('M');
    const hangar = ap.hangars[0];
    const depot = execute(sim, 1, { t: 'place', tool: 'depot', x: hangar % size, y: Math.floor(hangar / size) });
    expect(depot.ok, depot.msg).toBe(true);
    const route = execute(sim, 1, { t: 'routeCreate', stops: [a.id!, b.id!] });
    expect(route.ok, route.msg).toBe(true);
    for (let i = 0; i < 3; i++) {
      const r = execute(sim, 1, { t: 'buyVehicle', depotId: depot.id!, routeId: route.id!, modelId: 'air-s', cars: 1 });
      expect(r.ok, r.msg).toBe(true);
    }
    // A medium aircraft cannot use the small airport
    const big = execute(sim, 1, { t: 'buyVehicle', depotId: depot.id!, routeId: route.id!, modelId: 'air-m', cars: 1 });
    expect(big.ok).toBe(false);

    // Server → screen
    const sent: ServerMsg[] = [];
    const repl = new Replicator(sim, new Accounts('/tmp/none-' + Math.random() + '.json'));
    const client = repl.newClient({ readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) } as never, 1, 'p1');
    repl.setView(client, 0, 60, 299, 150);
    const cmap = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 20));
    const csim = new Simulation(cmap, undefined, { multi: true });
    const mirror = new Mirror(cmap, csim);
    let delivered = 0;
    let pathMsgs = 0;
    let doneOnlyMsgs = 0;
    let maxErr = 0;
    let compared = 0;
    let sawAir = false;
    for (let tick = 1; tick < 2500; tick++) {
      if (tick % 40 === 0) {
        sim.transit.flow.addWaiting(sim.transit.stops.get(a.id!)!, b.id!, 30);
        sim.transit.flow.addWaiting(sim.transit.stops.get(b.id!)!, a.id!, 30);
      }
      sim.advance(0.1, 1000);
      repl.frame([client]);
      if (tick % 5 === 0) repl.structure([client]);
      for (const m of sent.splice(0)) {
        mirror.apply(m);
        if (m.type === 'frame') {
          for (const v of m.veh) {
            if (!v.flight) continue;
            sawAir = true;
            if (v.flight.pts) pathMsgs++;
            else doneOnlyMsgs++;
          }
        }
      }
      // The aircraft the screen has are where the server's are (right after a frame, before any smoothing)
      if (tick % 10 === 0) {
        for (const sv of sim.transit.vehicles) {
          const cv = csim.transit.mirrorVeh.get(sv.id);
          if (!cv) continue;
          const sp = sim.transit.planePos(sv);
          const cp = csim.transit.planePos(cv);
          maxErr = Math.max(maxErr, Math.hypot(sp.x - cp.x, sp.y - cp.y));
          compared++;
        }
      }
    }
    delivered = sim.transit.delivered;
    expect(sawAir).toBe(true);
    expect(compared).toBeGreaterThan(50);
    // Compared at the moment of a frame, the positions agree up to the 10 Hz sending (a taxiing aircraft moves a little between frames)
    expect(maxErr).toBeLessThan(8);
    // The path is sent once per leg; the rest are only "how far it has gone"
    expect(pathMsgs).toBeGreaterThan(0);
    expect(doneOnlyMsgs).toBeGreaterThan(pathMsgs * 3);
    expect(delivered).toBeGreaterThan(10);
    // The screen has the airport tiles (so it can draw and analyse them)
    expect(airportAt(cmap, cmap.idx(40, 100))?.size).toBe('M');
  });
});
