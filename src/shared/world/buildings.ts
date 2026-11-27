/**
 * Format of the building byte: bits 0-1 = tier (1 = S, 2 = M, 3 = L (2x2). 0 is an attached tile of a 2x2 building)
 *                              bits 2-6 = kind (0..24)  bit 7 = office
 * Attached tile: 0x40 | ((dx to the anchor + 2*dy) << 2). The anchor is the frontmost tile (largest x,y) of the 2x2.
 */
export const SPRITE_VARIANTS = 25;
export const OFFICE_BIT = 128;
export const buildingLevel = (b: number) => b & 3;
export const buildingVariant = (b: number) => ((b >> 2) & 31) % SPRITE_VARIANTS;
export const isOffice = (b: number) => (b & OFFICE_BIT) !== 0;
export const makeBuilding = (level: number, variant: number, office: boolean) => level | (variant << 2) | (office ? OFFICE_BIT : 0);
export const fillerOf = (dxToAnchor: number, dyToAnchor: number) => 0x40 | ((dxToAnchor + 2 * dyToAnchor) << 2);
export const fillerAnchorOffset = (b: number): [number, number] => {
  const code = (b >> 2) & 3;
  return [code & 1, code >> 1];
};
