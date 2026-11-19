/** 方向: 0=N(-y) 1=E(+x) 2=S(+y) 3=W(-x) */
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
export const opposite = (d: number) => (d + 2) & 3;
/** road ビット: 下位4bit=接続, 上位4bit=その方向へ出られる(通行可) */
export const CONN = (d: number) => 1 << d;
export const OUT = (d: number) => 16 << d;

/**
 * 8方向(線路用): 0..3 は上と同じ、4=NE(+1,-1) 5=SE(+1,+1) 6=SW(-1,+1) 7=NW(-1,-1)。
 * 斜め方向は画面上では横・縦に見える。rail のビットは 1<<d(d=0..7)。
 */
export const DX8 = [0, 1, 0, -1, 1, 1, -1, -1] as const;
export const DY8 = [-1, 0, 1, 0, -1, 1, 1, -1] as const;
export const opposite8 = (d: number) => (d < 4 ? (d + 2) & 3 : 4 + ((d - 2) & 3));
export const isDiag = (d: number) => d >= 4;
/** rail の斜めビット(上位4bit) */
export const RAIL_DIAG = 0xf0;
