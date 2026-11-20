import type { Simulation } from '../src/shared/sim/simulation';
import { assetValue } from '../src/shared/sim/economy/economy';

export { PRICES, facilityValue, vehiclePrice, yen } from '../src/shared/sim/economy/economy';
export { acquirePrice } from '../src/shared/sim/economy/rivals';

/** 会社の資産評価(施設・車両・基地) */
export const assetValueFor = (sim: Simulation, who: number) => assetValue(sim.map, sim.transit, sim.rivals, who);
