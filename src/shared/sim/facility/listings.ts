import { type Facility, removeFacility } from '../../world/facilities';
import type { GameMap } from '../../world/gameMap';
import { facilityValue } from '../economy/economy';

/**
 * Listed properties (real estate): facilities owned by no company. Facilities sold by players and private facilities built by towns become these.
 * Anyone can buy one at its valuation. If no buyer comes for LISTING_DAYS days, it is demolished and the land is cleared.
 */
export const LISTING_DAYS = 28;

/** Whether it is listed (a private facility with no owner. Excludes facilities owned by rival companies, public facilities, and the company's own / other players' facilities) */
export const isForSale = (f: Pick<Facility, 'owner' | 'ownerId'>): boolean => f.owner === 'city' && f.ownerId === undefined;

/** Days left on the listing (decreases with time since the listing date; for a property with no date yet, the full term) */
export const listingLeft = (f: Pick<Facility, 'listedDay'>, day: number): number => (f.listedDay === undefined ? LISTING_DAYS : Math.max(0, LISTING_DAYS - (day - f.listedDay)));

/** Asking price (valuation) */
export const askingPrice = (f: Facility): number => facilityValue(f);

/** List of properties currently for sale */
export const listedFacilities = (map: Pick<GameMap, 'facilities'>): Facility[] => map.facilities.filter(isForSale);

/**
 * Day close (day = the running day number): set a listing date on newly listed properties (just sold, built by a town, or from an old save),
 * clear the date of properties no longer listed, and demolish properties past their deadline, clearing the land. Returns the demolished facilities
 */
export function processListings(map: GameMap, day: number): Facility[] {
  const removed: Facility[] = [];
  for (const f of [...map.facilities]) {
    if (!isForSale(f)) {
      if (f.listedDay !== undefined) f.listedDay = undefined;
      continue;
    }
    if (f.listedDay === undefined) {
      f.listedDay = day;
      map.facilityVer++;
    } else if (listingLeft(f, day) <= 0) {
      removeFacility(map, f);
      removed.push(f);
    }
  }
  return removed;
}
