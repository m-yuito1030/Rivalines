/**
 * building バイトの形式: bit0-1 = 段階(1=S 2=M 3=L(2x2)。0 は 2x2 建物の付属タイル)
 *                        bit2-6 = 種類(0..24)  bit7 = オフィス
 * 付属タイル: 0x40 | ((アンカーまでの dx + 2*dy) << 2)。アンカーは 2x2 の最前面(x,y が最大)のタイル。
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
