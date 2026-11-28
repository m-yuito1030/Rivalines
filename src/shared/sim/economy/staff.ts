import { aircraftClass, modelOf } from '../../data/models';
import { facilityUpkeep } from '../../world/facilities';
import type { GameMap } from '../../world/gameMap';
import { airportAt } from '../../world/airports';
import type { Transit } from '../network/transit';

/**
 * Staff. Every vehicle, station, airport, depot and facility needs a number of employees. The company hires them (a hiring fee per person,
 * and applicants come in proportion to the advertising budget), pays a wage every day, and trains them (education raises the skill).
 * When there are not enough skilled staff, vehicles run slower, fewer passengers come, and facilities earn less.
 */
export const STAFF = {
  /** Daily wage per employee */
  wage: 2_000,
  /** Fee paid for each person hired */
  hireFee: 20_000,
  /** Applicants per day without advertising, and one more applicant per this much advertising money per day */
  baseApplicants: 3,
  adPerApplicant: 5_000,
  /** Skill of a new hire (0..100) and the daily fall of the skill of the whole staff (people forget, the work changes) */
  newSkill: 30,
  skillDecay: 0.1,
  /** Education: one skill point per employee costs this much */
  eduPerPoint: 1_000,
  /** Share of employees who leave each day */
  quit: 0.003,
  /** Hiring stops when the staff is this many times the number needed (plus a few) */
  hireUntil: 1.3,
  /** The free staff given to a company on its first day, at least */
  minStart: 10,
  /** The speed / traffic / sales of a company with no staff at all (it rises up to 1 with the staff ratio) */
  floor: 0.25,
  /** Choices for the three daily budgets (yen per day) */
  budgets: [0, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000],
} as const;

export interface StaffBudget {
  hire: number;
  ad: number;
  edu: number;
}
export const DEFAULT_BUDGET: StaffBudget = { hire: 100_000, ad: 50_000, edu: 0 };

const AIRCRAFT_CREW = { S: 4, M: 8, L: 14 } as const;
const AIRPORT_STAFF = { legacy: 4, S: 8, M: 20, L: 50, H: 120 } as const;

/** Employees needed to run everything the company has (ownerId undefined = the single-player company) */
export function requiredStaff(map: GameMap, transit: Transit, ownerId?: number): number {
  let n = 0;
  for (const v of transit.vehicles) {
    if (ownerId !== undefined && transit.routes.get(v.routeId)?.owner !== ownerId) continue;
    const m = modelOf(v.modelId);
    n += v.mode === 'road' ? 1 : v.mode === 'rail' ? 2 + v.cars : AIRCRAFT_CREW[aircraftClass(m)];
  }
  for (const s of transit.stops.values()) {
    if (s.waypoint || (ownerId !== undefined && s.owner !== ownerId)) continue;
    if (s.kind === 'rail') n += 2 + (s.station?.tracks ?? 1);
    else if (s.kind === 'air') n += AIRPORT_STAFF[airportAt(map, map.idx(s.x, s.y))?.size ?? 'legacy'];
  }
  for (const d of transit.depots.values()) if (ownerId === undefined || d.owner === ownerId) n += 1;
  for (const f of map.facilities) {
    if ((f.owner ?? 'player') !== 'player' || (ownerId !== undefined && f.playerId !== ownerId)) continue;
    n += Math.max(2, Math.min(60, Math.round(facilityUpkeep(f) / 8000)));
  }
  return n;
}

/** The skill-weighted share of the needed staff that is actually there (0..1; 1 when nobody is needed) */
export const staffRatio = (staff: number, skill: number, required: number): number => (required <= 0 ? 1 : Math.min(1, (staff * (0.7 + (0.3 * skill) / 100)) / required));
/** Multiplier on speed, passengers and facility sales for a staff ratio */
export const staffMulOf = (ratio: number): number => STAFF.floor + (1 - STAFF.floor) * ratio;
