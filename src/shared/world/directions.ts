/** Directions: 0=N(-y) 1=E(+x) 2=S(+y) 3=W(-x) */
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
export const opposite = (d: number) => (d + 2) & 3;
/** road bits: low 4 bits = connections, high 4 bits = can exit in that direction (passable) */
export const CONN = (d: number) => 1 << d;
export const OUT = (d: number) => 16 << d;

/**
 * 8 directions (for rail): 0..3 are the same as above, 4=NE(+1,-1) 5=SE(+1,+1) 6=SW(-1,+1) 7=NW(-1,-1).
 * Diagonal directions look horizontal/vertical on screen. The rail bit is 1<<d (d=0..7).
 */
export const DX8 = [0, 1, 0, -1, 1, 1, -1, -1] as const;
export const DY8 = [-1, 0, 1, 0, -1, 1, 1, -1] as const;
export const opposite8 = (d: number) => (d < 4 ? (d + 2) & 3 : 4 + ((d - 2) & 3));
export const isDiag = (d: number) => d >= 4;
/** The diagonal bits of rail (high 4 bits) */
export const RAIL_DIAG = 0xf0;
