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

/** How many designs each size has (design 0 is the original layout) */
export const AIRPORT_DESIGNS = 10;

interface Spec {
  /** Length of the runway and the width of the airport */
  w: number;
  /** The designs: each is a list of rows (see parseRow) from top to bottom */
  designs: string[];
  /** The number of stands that tells the size of an airport apart from the other sizes (inclusive range) */
  stands: [number, number];
}

/**
 * Row tokens (an airport whose runway runs east-west; the first and the last column of every row except R is a taxiway ring):
 *   R           runway (the whole row)
 *   T           taxiway (the whole row)
 *   A           bare apron
 *   S<n>[a]     apron with n stands. a = E even (default) / L left half / R right half / C clustered in the middle
 *   H<n>        apron with n hangars (the depot) spread evenly
 *   M<p><w><h>  the terminal row. p = c / l / r: where the terminal (the stop) is. w = f the building fills the row / w wide / n narrow.
 *               h = where the hangars are: e both ends / n beside the building / l left end only / r right end only
 */
const SPECS: Record<AirportSize, Spec> = {
  S: {
    w: 10,
    stands: [1, 5],
    designs: ['R T S2 Mcfe', 'R T Mcfe S2', 'R T S3 Mcwn', 'R T S2 Mlwe A', 'R T S1 Mrwn S1', 'S2 Mcfe T R', 'R T S4 Mcnl', 'R T A S3C Mcfr', 'R T H2 S2 Mlnn', 'S2 Mcfe A T R'],
  },
  M: {
    w: 16,
    stands: [6, 14],
    designs: [
      'R T S4 Mcfe S4',
      'R T S3 Mcwn S3 S2',
      'R T Mcfe S4 S4',
      'S4 Mcfe S4 T R',
      'R T S6 Mlwe S3 A',
      'R T S5 A Mrwn S5',
      'R T H2 S4 Mcfe S4',
      'R T S4C Mcnl S4C',
      'S5 Mrwn S5 A T R',
      'R T S3 Mcnn A S3 S3',
    ],
  },
  L: {
    w: 24,
    stands: [15, 36],
    designs: [
      'R T S6 S6 Mcfe S6 S6 T R',
      'R T S6 S6 Mcfe S6 T R',
      'R T S8 Mcwe S8 A S4 T R',
      'R T S5 A S5 Mcfe S5 A S5 T R',
      'R T S6 Mlwe S6 S6 T R',
      'R T H3 S6 S6 Mcnn S6 S6 T R',
      'R T S6 S6 Mrwe S6 S6 T R',
      'R T S4C S4C Mcfe S4C S4C T R',
      'R T S6 S6 S6 Mcnl S6 T R',
      'R T S8 S8 Mcwn S8 S8 T R',
    ],
  },
  H: {
    w: 40,
    stands: [37, 200],
    designs: [
      'R T S10 S10 S10 Mcfe S10 S10 S10 T R',
      'R T H3 S10 S10 S10 Mcfe S10 S10 S10 T R',
      'R T S12 S12 Mcwe S12 S12 T R',
      'R T S10 A S10 A Mcfe A S10 A S10 T R',
      'R T H4 S10 S10 Mlwe S10 S10 S10 T R',
      'R T S10 S10 Mrwe S10 S10 S10 T R',
      'R T S10 S10 Mcnn S10 S10 S10 T R',
      'R T S8C S8C S8C Mcfe S8C S8C S8C T R',
      'R T S10 Mcwn S10 S10 S10 T R',
      'R T S12 S12 S12 Mcfe S12 S12 S12 T R',
    ],
  },
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

const designRows = (size: AirportSize, design: number): string[] => {
  const d = SPECS[size].designs;
  return d[Number.isInteger(design) && design >= 0 && design < d.length ? design : 0].split(' ');
};

/** The footprint (w x h) of an airport of this size, design and axis. 'x': the runway runs east-west; 'y': north-south */
export function airportFootprint(size: AirportSize, axis: AirportAxis, design = 0): { w: number; h: number } {
  const h = designRows(size, design).length;
  const w = SPECS[size].w;
  return axis === 'x' ? { w, h } : { w: h, h: w };
}

/** The size of an airport that has this many stands */
export function sizeByStands(stands: number): AirportSize {
  for (const sz of AIRPORT_SIZES) if (stands >= SPECS[sz].stands[0] && stands <= SPECS[sz].stands[1]) return sz;
  return 'S';
}

/** Columns of n stands in a row of width W */
function standColumns(W: number, n: number, align: string): number[] {
  const inner = W - 2;
  const cols: number[] = [];
  for (let i = 0; i < n; i++) {
    let x: number;
    if (align === 'L') x = 2 + 2 * i;
    else if (align === 'R') x = W - 3 - 2 * i;
    else if (align === 'C') x = Math.floor(W / 2) - (n - 1) + 2 * i;
    else x = 1 + Math.floor(((i + 0.5) * inner) / n);
    cols.push(Math.min(W - 2, Math.max(1, x)));
  }
  return [...new Set(cols)];
}

/** One row of codes from its token */
function parseRow(tok: string, W: number): number[] {
  const ring = (x: number) => x === 0 || x === W - 1;
  const fill = (f: (x: number) => number) => Array.from({ length: W }, (_, x) => f(x));
  const kind = tok[0];
  if (kind === 'R') return fill(() => AIR.RUNWAY);
  if (kind === 'T') return fill(() => AIR.TAXIWAY);
  if (kind === 'A') return fill((x) => (ring(x) ? AIR.TAXIWAY : AIR.APRON));
  if (kind === 'S') {
    const m = /^S(\d+)([ELRC])?$/.exec(tok)!;
    const cols = new Set(standColumns(W, Number(m[1]), m[2] ?? 'E'));
    return fill((x) => (ring(x) ? AIR.TAXIWAY : cols.has(x) ? AIR.STAND : AIR.APRON));
  }
  if (kind === 'H') {
    const cols = new Set(standColumns(W, Number(tok.slice(1)), 'E'));
    return fill((x) => (ring(x) ? AIR.TAXIWAY : cols.has(x) ? AIR.HANGAR : AIR.APRON));
  }
  // M: the terminal row
  const pos = tok[1];
  const width = tok[2];
  const hang = tok[3];
  const tx = pos === 'l' ? Math.floor(W / 4) : pos === 'r' ? W - 1 - Math.floor(W / 4) : Math.floor(W / 2);
  const half = width === 'f' ? W : width === 'w' ? Math.floor(W / 6) + 1 : Math.max(1, Math.floor(W / 10));
  const b0 = Math.max(2, tx - half);
  const b1 = Math.min(W - 3, tx + half);
  const hx = new Set<number>();
  if (hang === 'e' || hang === 'l') hx.add(1);
  if (hang === 'e' || hang === 'r') hx.add(W - 2);
  if (hang === 'n') {
    hx.add(b0 - 1);
    hx.add(b1 + 1);
  }
  return fill((x) => {
    if (ring(x)) return AIR.TAXIWAY;
    if (hx.has(x)) return AIR.HANGAR;
    if (x === tx) return AIR.TERMINAL;
    return x >= b0 && x <= b1 ? AIR.BUILDING : AIR.APRON;
  });
}

/** The layout, tile by tile */
export function buildLayout(size: AirportSize, axis: AirportAxis, design = 0): Layout {
  const W = SPECS[size].w;
  const toks = designRows(size, design);
  const rows = toks.map((t) => parseRow(t, W));
  const H = rows.length;
  const w = axis === 'x' ? W : H;
  const h = axis === 'x' ? H : W;
  const codes = new Uint8Array(w * h);
  let stands = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [tx, ty] = axis === 'x' ? [x, y] : [y, x]; // 'y' is the same layout turned by a quarter (transposed)
      codes[ty * w + tx] = rows[y][x];
      if (rows[y][x] === AIR.STAND) stands++;
    }
  }
  return { w, h, codes, runways: toks.filter((t) => t === 'R').length, stands };
}

/** Whether a tile value is something an aircraft can roll over on the ground (not the runway; that is entered by the takeoff/landing procedures) */
export const isTaxiable = (code: number): boolean => code === AIR.APRON || code === AIR.TAXIWAY || code === AIR.STAND || code === AIR.HANGAR;
