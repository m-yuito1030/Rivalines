export interface Town {
  id: number; // 1-based (stored in map.owner)
  name: string;
  x: number; // centre tile
  y: number;
  pop: number;
  houses: number;
  /** Road tiles this town laid (index = y*size+x). For random picks when growing */
  roads: number[];
  nextGrowth: number; // the simulation tick of the next growth
  /** Recent transport results (boardings and alightings, decaying daily). Speeds up growth */
  pax: number;
  /** Town tier (0 village, 1 town, 2 city, 3 metropolis, 4 capital). Decided at birth; it grows only within that tier's population range. Absent in old saves, where it is decided from population */
  tier?: number;
}

/** Population per building level (1..3) (the baseline for villages and towns; bigger cities have more people per building = taller buildings: popMul) */
export const POP_PER_LEVEL = [0, 6, 16, 36] as const;

/**
 * Town tiers. min is the population at birth, max (exclusive) is the upper limit of growth at that tier.
 * weight is the share born (sums to 1), mul is the population multiplier per building, radius is the town's extent (tiles), roads is the cap on road tiles.
 * Town design: maxLevel is the maximum building height (1=S 2=M 3=L), l1/l2 are cumulative shares of low and mid rise (the rest is high rise), office is how many office buildings (more toward the centre). Villages have only low houses; high-rises and office districts start at cities.
 */
export const TIERS = [
  { name: '村', min: 100, max: 1000, weight: 0.6, mul: 1, radius: 10, roads: 4000, maxLevel: 1, l1: 1, l2: 1, office: 0 },
  { name: '街', min: 1000, max: 10000, weight: 0.265, mul: 1, radius: 22, roads: 4000, maxLevel: 2, l1: 0.72, l2: 1, office: 0.25 },
  { name: '都市', min: 10000, max: 100000, weight: 0.1, mul: 2, radius: 45, roads: 9000, maxLevel: 3, l1: 0.4, l2: 0.75, office: 0.7 },
  { name: '特大都市', min: 100000, max: 300000, weight: 0.03, mul: 5, radius: 70, roads: 16000, maxLevel: 3, l1: 0.2, l2: 0.5, office: 0.85 },
  { name: '首都', min: 300000, max: 500000, weight: 0.005, mul: 8, radius: 90, roads: 24000, maxLevel: 3, l1: 0.1, l2: 0.35, office: 0.95 },
] as const;

export const tierOfPop = (pop: number): number => {
  let t = 0;
  for (let i = 1; i < TIERS.length; i++) if (pop >= TIERS[i].min) t = i;
  return t;
};
export const townTier = (t: Pick<Town, 'pop' | 'tier'>): number => t.tier ?? tierOfPop(t.pop);
/** Multiplier on population per building (by town tier) */
export const popMul = (t: Pick<Town, 'pop' | 'tier'> | undefined): number => (t ? TIERS[townTier(t)].mul : 1);
