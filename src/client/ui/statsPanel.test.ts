import { describe, expect, it } from 'vitest';
import { routeStats, townStats } from './statsPanel';
import type { Transit } from '../../shared/sim/network/transit';

describe('statsPanel', () => {
  it('集計: 路線の輸送人数(旧セーブでcarried未定義でも0)と街ごとの待ち人数', () => {
    const t = {
      routes: new Map([
        [1, { id: 1, name: 'バス1', color: 0, mode: 'road', carried: 12.7 }],
        [2, { id: 2, name: 'バス2', color: 0, mode: 'road' }],
      ]),
      vehicles: [{ routeId: 1, cap: 10, load: 5, stuck: 30 }],
      stops: new Map([
        [1, { townId: 1, waiting: 7.9 }],
        [2, { townId: 1, waiting: 3 }],
      ]),
    } as unknown as Transit;
    const rs = routeStats(t);
    expect(rs[0]).toMatchObject({ carried: 12, vehicles: 1, loadPct: 50, stuck: 1 });
    expect(rs[1]).toMatchObject({ carried: 0, loadPct: null });
    const ts = townStats(t, [{ id: 1, name: 'A', pop: 100 } as never]);
    expect(ts[0]).toMatchObject({ waiting: 10, stops: 2 });
  });
});
