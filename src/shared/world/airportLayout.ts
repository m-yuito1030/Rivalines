/**
 * Airport layouts. An airport is a rectangle of tiles in the air layer (map.air). The value of a tile says what it is.
 *
 * Four sizes (S / M / L / Hub). The bigger the airport, the more runways and stands it has and the bigger the aircraft it can take.
 * Rows (top to bottom, for an airport whose runway runs east-west):
 *
 *   runway            ← takeoffs and landings (one aircraft at a time per runway)
 *   taxiway           ← aircraft roll to the runway threshold along this row
 *   stand rows        ← apron with parking stands (one aircraft per stand: where passengers get on and off)
 *   terminal row      ← the terminal building (the stop) with a hangar (the depot) at each end
 *   stand rows        ← more stands on the other side of the terminal
 *   (taxiway, runway) ← a second parallel runway for the large airports
 *
 * The first and last columns are a taxiway that goes around, so every stand can be reached.
 */

/** Values of map.air */
export const AIR = {
  NONE: 0,
  /** Apron: open paved ground that aircraft can roll over */
  APRON: 1,
  RUNWAY: 2,
  /** The tile of the terminal that is the stop (the one tile that passengers and routes refer to) */
  TERMINAL: 3,
  TAXIWAY: 4,
  /** A parking stand: one aircraft at a time, where it loads and unloads */
  STAND: 5,
  /** A hangar: the depot of the airport (where bought aircraft appear) */
  HANGAR: 6,
  /** The rest of the terminal building (not a stop; aircraft cannot enter) */
  BUILDING: 7,
} as const;

export type AirportSize = 'S' | 'M' | 'L' | 'H';
export type AirportAxis = 'x' | 'y';
export const AIRPORT_SIZES: readonly AirportSize[] = ['S', 'M', 'L', 'H'];

interface Spec {
  /** Length of the runway and the width of the airport */
  w: number;
  /** Stand rows above / below the terminal row */
  top: number;
  bottom: number;
  /** 1, or 2 parallel runways */
  runways: 1 | 2;
  /** Stands in each stand row */
  perRow: number;
}
const SPECS: Record<AirportSize, Spec> = {
  S: { w: 10, top: 1, bottom: 0, runways: 1, perRow: 2 },
  M: { w: 16, top: 1, bottom: 1, runways: 1, perRow: 4 },
  L: { w: 24, top: 2, bottom: 2, runways: 2, perRow: 6 },
  H: { w: 40, top: 3, bottom: 3, runways: 2, perRow: 10 },
};

export const AIRPORT_NAMES: Record<AirportSize, { ja: string; en: string }> = {
  S: { ja: '小', en: 'Small' },
  M: { ja: '中', en: 'Medium' },
  L: { ja: '大', en: 'Large' },
  H: { ja: 'ハブ', en: 'Hub' },
};

/** The biggest aircraft class each size takes: S → small aircraft only, M → up to medium, L and Hub → all */
export const AIRPORT_MAX_CLASS: Record<AirportSize, AirportSize> = { S: 'S', M: 'M', L: 'L', H: 'L' };
const CLASS_RANK: Record<string, number> = { S: 0, M: 1, L: 2 };
/** Whether an airport of this size takes an aircraft of this class (S small, M medium, L large) */
export const airportTakes = (size: AirportSize, aircraftClass: 'S' | 'M' | 'L'): boolean => CLASS_RANK[aircraftClass] <= CLASS_RANK[AIRPORT_MAX_CLASS[size]];

export interface Layout {
  /** Footprint in tiles (after the rotation for the axis) */
  w: number;
  h: number;
  /** Row by row: codes[y * w + x] */
  codes: Uint8Array;
  runways: number;
  stands: number;
}

/** The footprint (w x h) of an airport of this size and axis. 'x': the runway runs east-west; 'y': north-south */
export function airportFootprint(size: AirportSize, axis: AirportAxis): { w: number; h: number } {
  const s = SPECS[size];
  const h = 2 + s.top + 1 + s.bottom + (s.runways === 2 ? 2 : 0);
  return axis === 'x' ? { w: s.w, h } : { w: h, h: s.w };
}

/** The layout, tile by tile */
export function buildLayout(size: AirportSize, axis: AirportAxis): Layout {
  const s = SPECS[size];
  const W = s.w;
  const rows: number[][] = [];
  const row = (fill: (x: number) => number) => rows.push(Array.from({ length: W }, (_, x) => fill(x)));
  const ring = (x: number) => x === 0 || x === W - 1;
  // Stand positions: evenly spaced in the columns between the two ring columns
  const inner = W - 2;
  const standCols = new Set(Array.from({ length: s.perRow }, (_, i) => 1 + Math.floor(((i + 0.5) * inner) / s.perRow)));
  const standRow = () => row((x) => (ring(x) ? AIR.TAXIWAY : standCols.has(x) ? AIR.STAND : AIR.APRON));
  const runway = () => row(() => AIR.RUNWAY);
  const taxi = () => row(() => AIR.TAXIWAY);
  runway();
  taxi();
  for (let i = 0; i < s.top; i++) standRow();
  // Terminal row: a hangar at each end next to the ring taxiway, the terminal building in between (its middle tile is the stop)
  const mid = Math.floor(W / 2);
  row((x) => (ring(x) ? AIR.TAXIWAY : x === 1 || x === W - 2 ? AIR.HANGAR : x === mid ? AIR.TERMINAL : AIR.BUILDING));
  for (let i = 0; i < s.bottom; i++) standRow();
  if (s.runways === 2) {
    taxi();
    runway();
  }
  const H = rows.length;
  const w = axis === 'x' ? W : H;
  const h = axis === 'x' ? H : W;
  const codes = new Uint8Array(w * h);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [tx, ty] = axis === 'x' ? [x, y] : [y, x]; // 'y' is the same layout turned by a quarter (transposed)
      codes[ty * w + tx] = rows[y][x];
    }
  }
  return { w, h, codes, runways: s.runways, stands: s.perRow * (s.top + s.bottom) };
}

/** Whether a tile value is something an aircraft can roll over on the ground (not the runway; that is entered by the takeoff/landing procedures) */
export const isTaxiable = (code: number): boolean => code === AIR.APRON || code === AIR.TAXIWAY || code === AIR.STAND || code === AIR.HANGAR;
