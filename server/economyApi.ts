import type { Simulation } from '../src/sim/simulation';
import { assetValue } from '../src/sim/economy';

export { PRICES, facilityValue, vehiclePrice, yen } from '../src/sim/economy';
export { acquirePrice } from '../src/sim/rivals';

/** 会社の資産評価(施設・車両・基地) */
export const assetValueFor = (sim: Simulation, who: number) => assetValue(sim.map, sim.transit, sim.rivals, who);
