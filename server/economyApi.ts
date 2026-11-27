import type { Simulation } from '../src/shared/sim/simulation';
import { assetValue } from '../src/shared/sim/economy/economy';

export { PRICES, facilityValue, vehiclePrice, yen } from '../src/shared/sim/economy/economy';
export { acquirePrice } from '../src/shared/sim/economy/rivals';

/** Asset value of a company (facilities, vehicles, depots) */
export const assetValueFor = (sim: Simulation, who: number) => assetValue(sim.map, sim.transit, sim.rivals, who);
