/**
 * Visitors to facilities (stadium, amusement park, mall, park, department store, hotel). At each day close, besides passengers arriving via stops, "people from the surroundings" are computed.
 *
 * - A random number between 0 and the cap come, with the cap being 20% of the surrounding population.
 * - A stop or station in the catchment increases visitors (STATION_BOOST).
 * - Nearby facilities of the same type (the company's or others') spread the people out and reduce the count. Facilities of other types reduce it a little too.
 * - Advertising (newspaper, social media, TV) temporarily raises the facility's own visitors and lowers those of nearby facilities. Each facility can advertise only once per period.
 */
import { FACILITY_SPECS, NEW_FACILITY_TYPES, type Facility, type FacilityType, facilityAttract, facilityBuildCost } from '../../world/facilities';
import { demandMul, elasticity, priceMul } from './pricing';
import { freshness, gradeOf, gradeSpendMul, nextRep, repMul, repOf, satisfaction } from '../../world/facilityQuality';
import type { GameMap } from '../../world/gameMap';
import type { Transit } from '../network/transit';

/** Whether this facility type draws visitors from the population (public facilities do not) */
export const VISITOR_TYPES: FacilityType[] = ['stadium', 'amusement', 'mall', 'park', 'department', 'hotel', ...NEW_FACILITY_TYPES];

/** Guideline for the visitor cap (share of population), the daily visitor cap (share of attract), and the multiplier when a stop is present */
export const WALKIN_FRACTION = 0.2;
export const CAP_PER_ATTRACT = 0.3;
export const STATION_BOOST = 1.8;
/** Radius (tiles) for counting population, and the range within which rivals and advertising have an effect */
export const POP_RADIUS = 60;
export const RIVAL_RADIUS = 30;

export type AdKind = 'news' | 'sns' | 'tv';
/** Advertising: the cost is a share of the facility's construction cost. mul = multiplier on its own visitors, rival = multiplier on nearby facilities, days = days it lasts */
export const AD_TYPES: Record<AdKind, { name: string; costRate: number; mul: number; rival: number; days: number }> = {
  news: { name: '新聞', costRate: 0.02, mul: 1.3, rival: 0.9, days: 3 },
  sns: { name: 'SNS', costRate: 0.05, mul: 1.6, rival: 0.85, days: 5 },
  tv: { name: 'テレビ', costRate: 0.15, mul: 2.2, rival: 0.7, days: 3 },
};
/** Days until the same facility can advertise again after advertising */
export const AD_COOLDOWN_DAYS = 14;

export const adCost = (f: Pick<Facility, 'type' | 'size' | 'design'>, kind: AdKind): number => Math.round((facilityBuildCost(f) * AD_TYPES[kind].costRate) / 1000) * 1000;

/** Whether advertising is in effect (day: the running day number) */
export const adActive = (f: Facility, day: number): boolean => !!f.ad && day >= f.ad.from && day < f.ad.from + AD_TYPES[f.ad.kind].days;

/** Whether advertising is possible. If not, the reason */
export function adAvailable(f: Facility, day: number): string | null {
  if (!VISITOR_TYPES.includes(f.type)) return 'この施設には広告を出せません';
  if (f.ad && day < f.ad.from + AD_COOLDOWN_DAYS) return `前の広告から${AD_COOLDOWN_DAYS}日あけてください(あと${f.ad.from + AD_COOLDOWN_DAYS - day}日)`;
  return null;
}

/**
 * Day close: decide each facility's visitors and turn the company's own (player) facilities' share into sales.
 * pay: the company that receives a facility's sales (multiplayer: the facility's owner; solo: the player). If null, it is not counted as sales (other companies' and towns' facilities).
 * visitorMul: a national policy's multiplier on visitors (e.g. tourism promotion).
 * Returns: total visitors
 */
export function dailyVisitors(map: GameMap, transit: Transit, day: number, rng: () => number, pay: (f: Facility, amount: number) => void, visitorMul = 1): number {
  const fs = map.facilities.filter((f) => VISITOR_TYPES.includes(f.type));
  if (!fs.length) return 0;
  const cell = 32;
  const key = (x: number, y: number) => Math.floor(y / cell) * 100000 + Math.floor(x / cell);
  const grid = new Map<number, Facility[]>();
  for (const f of fs) {
    const k = key(f.x0, f.y0);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(f);
  }
  const near = (f: Facility, R: number): Facility[] => {
    const out: Facility[] = [];
    const c0 = Math.floor((f.x0 - R) / cell);
    const c1 = Math.floor((f.x0 + R) / cell);
    const r0 = Math.floor((f.y0 - R) / cell);
    const r1 = Math.floor((f.y0 + R) / cell);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const o of grid.get(r * 100000 + c) ?? []) if (o !== f && Math.hypot(o.x0 - f.x0, o.y0 - f.y0) <= R) out.push(o);
      }
    }
    return out;
  };
  // Surrounding population (thinned by distance)
  const popNear = (f: Facility): number => {
    let p = 0;
    for (const t of map.towns) {
      const d = Math.hypot(t.x - f.x0, t.y - f.y0);
      if (d < POP_RADIUS) p += t.pop * Math.min(1, (POP_RADIUS - d) / (POP_RADIUS * 0.75));
    }
    return p;
  };
  // Facilities with a stop in the catchment
  const served = new Set<number>();
  for (const s of transit.stops.values()) if (!s.waypoint && s.facs) for (const id of s.facs) served.add(id);
  let total = 0;
  for (const f of fs) {
    const spec = FACILITY_SPECS[f.type];
    const cap = facilityAttract(f) * CAP_PER_ATTRACT;
    const station = served.has(f.id);
    let v = Math.min(cap, rng() * WALKIN_FRACTION * popNear(f)) * (station ? STATION_BOOST : 1);
    // Spreading with nearby facilities (the company's and others')
    const others = near(f, RIVAL_RADIUS);
    const same = others.filter((o) => o.type === f.type).length;
    v /= 1 + 0.6 * same + 0.1 * (others.length - same);
    // Advertising: its own rises and falls by the amount of nearby facilities that are advertising
    if (adActive(f, day)) v *= AD_TYPES[f.ad!.kind].mul;
    for (const o of others) if (adActive(o, day)) v *= AD_TYPES[o.ad!.kind].rival;
    // Price: raising it increases sales per person but reduces visitors (the most profitable price depends on the surroundings)
    const k = elasticity(f.type, same, station, adActive(f, day));
    f.elast = k;
    v *= demandMul(priceMul(f), k);
    // Quality: novelty (popularity falls as it ages) and reputation (moves gradually toward satisfaction) affect visitors. Reputation is decided by price, equipment, stations, and crowding
    f.renov ??= day;
    const fresh = freshness(f, day);
    v *= fresh * repMul(repOf(f)) * visitorMul;
    f.rep = nextRep(repOf(f), satisfaction({ grade: gradeOf(f), priceMul: priceMul(f), served: station, crowded: v >= cap * 0.95, fresh }));
    f.visits = (f.visits ?? 0) + v;
    total += v;
    if ((f.owner ?? 'player') === 'player' && spec.conversion * spec.spend > 0) {
      const amount = v * spec.conversion * spec.spend * priceMul(f) * gradeSpendMul(gradeOf(f));
      if (amount > 0) {
        pay(f, amount);
        f.dayIncome = (f.dayIncome ?? 0) + amount;
      }
    }
  }
  return total;
}
