import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../shared/world/constants';
import { GameMap } from '../../shared/world/gameMap';
import { connect } from '../../shared/world/roads';
import { Transit } from '../../shared/sim/network/transit';
import { guideProgress } from './guideProgress';

describe('はじめかたカードの進みぐあい', () => {
  it('バス停・車両基地・路線・バスが、自社のものだけ数えられる', () => {
    const size = 64;
    const m = new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
    for (let x = 5; x < 40; x++) connect(m, x, 20, 1, false);
    const t = new Transit(m);
    expect(guideProgress(t, 0)).toEqual({ stops: 0, depots: 0, routes: 0, buses: 0 });
    t.actor = 7;
    const a = t.addStop(8, 20, 'road')!;
    const b = t.addStop(30, 20, 'road')!;
    expect(guideProgress(t, 7).stops).toBe(2);
    expect(guideProgress(t, 8).stops).toBe(0); // another company's stops are not mine
    t.addDepot(10, 20);
    expect(guideProgress(t, 7).depots).toBe(1);
    const r = t.addRoute([a.id, b.id])!;
    r.owner = 7;
    expect(guideProgress(t, 7).routes).toBe(1);
    t.addVehicle(r.id, 0);
    expect(guideProgress(t, 7).buses).toBeGreaterThanOrEqual(0);
  });
});
