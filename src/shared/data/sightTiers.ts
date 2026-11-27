/**
 * For each type of sight, the range [min, max] of town tiers (0 village, 1 town, 2 city) where it may be placed.
 * Only looks that suit the size are chosen, so villages do not get towers or large outlets and casinos. Types not listed are for towns and cities.
 * The key is "category/type" (cat/type in sights.json).
 */
export const SIGHT_TIERS: Record<string, [number, number]> = {
  // Shrines: shrines, Inari, and small sanctuaries from villages. Large shrine complexes from towns up
  '神社/小さな祠+御神木': [0, 1],
  '神社/稲荷(千本鳥居)': [0, 2],
  '神社/本殿+鳥居': [0, 2],
  '神社/神明造(千木)': [0, 2],
  '神社/拝殿(入母屋)+狛犬': [0, 2],
  '神社/山上神社(石段)': [0, 2],
  '神社/神楽殿': [1, 2],
  '神社/拝殿+本殿(2棟)': [1, 2],
  '神社/大社造(高床)': [1, 2],
  '神社/社殿群+手水舎': [1, 2],
  // Temples: ruins and pagodas from villages. Grand ones in cities
  '神殿・寺院/遺跡の神殿': [0, 2],
  '神殿・寺院/仏塔(ストゥーパ)': [0, 2],
  '神殿・寺院/ギリシャ神殿': [1, 2],
  '神殿・寺院/ローマ円形神殿': [1, 2],
  '神殿・寺院/エジプト神殿': [1, 2],
  '神殿・寺院/マヤ階段神殿': [1, 2],
  '神殿・寺院/ヒンドゥー寺院': [1, 2],
  '神殿・寺院/太陽神殿': [1, 2],
  '神殿・寺院/海神殿': [1, 2],
  '神殿・寺院/パンテオン風大神殿': [2, 2],
  // Towers: lighthouses, water towers, clock towers, and five-story pagodas from villages. Radio towers from towns. Skyscrapers and observation towers in cities only
  'タワー/灯台': [0, 2],
  'タワー/給水塔': [0, 2],
  'タワー/時計塔': [0, 2],
  'タワー/五重塔': [0, 2],
  'タワー/電波塔(格子鉄塔)': [1, 2],
  'タワー/レーダー通信塔': [1, 2],
  'タワー/スカイツリー風': [2, 2],
  'タワー/スペースニードル風': [2, 2],
  'タワー/エッフェル塔風': [2, 2],
  'タワー/ガラス超高層': [2, 2],
  // Hot springs: bathhouses, foot baths, and rock baths from villages. Spa resorts and high-rise hotels in cities
  '温泉/湯屋+煙突': [0, 2],
  '温泉/露天風呂付き旅館': [0, 2],
  '温泉/湯畑': [0, 2],
  '温泉/岩風呂': [0, 1],
  '温泉/足湯あずまや': [0, 1],
  '温泉/洞窟風呂': [0, 2],
  '温泉/温泉街(旅館2棟)': [1, 2],
  '温泉/スーパー銭湯': [1, 2],
  '温泉/大浴場スパリゾート': [2, 2],
  '温泉/高層温泉ホテル': [2, 2],
  // Outlets: from towns. Glass arcades and gate towers in cities
  'アウトレット/カラフルヴィレッジ': [1, 2],
  'アウトレット/北欧ヴィレッジ': [1, 2],
  'アウトレット/並木ストリート': [1, 2],
  'アウトレット/噴水広場コの字': [1, 2],
  'アウトレット/リノベ倉庫街': [1, 2],
  'アウトレット/ウッドデッキ海辺': [1, 2],
  'アウトレット/地中海リゾート': [1, 2],
  'アウトレット/時計塔広場': [1, 2],
  'アウトレット/ガラスアーケード': [2, 2],
  'アウトレット/ゲートタワー+駐車場': [2, 2],
  // Casinos: cities only (a casino ship is allowed in towns too)
  'カジノ/カジノ船': [1, 2],
  'カジノ/ラスベガス風ツインタワー': [2, 2],
  'カジノ/ピラミッド型': [2, 2],
  'カジノ/城型カジノ': [2, 2],
  'カジノ/ルーレット型': [2, 2],
  'カジノ/ネオンタワー': [2, 2],
  'カジノ/ドーム宮殿': [2, 2],
  'カジノ/サイコロ型': [2, 2],
  'カジノ/連結タワー+ブリッジ': [2, 2],
  'カジノ/スロットマシン型': [2, 2],
  // Landmarks (fountains, statues, etc.): any tier
  '名所/噴水': [0, 2],
  '名所/広葉樹': [0, 2],
  '名所/針葉樹': [0, 2],
  '名所/花木': [0, 2],
  '名所/銅像・石像': [0, 2],
  '名所/灯籠・街灯': [0, 2],
  '名所/東屋': [0, 2],
  '名所/花壇': [0, 2],
  '名所/池': [0, 2],
  '名所/記念碑': [0, 2],
};

export interface SightMeta {
  cat: string;
  type: string;
  variant: string;
}

/** Whether design d may be placed in a town of tier `tier` */
export function sightFits(meta: SightMeta, tier: number): boolean {
  const [lo, hi] = SIGHT_TIERS[`${meta.cat}/${meta.type}`] ?? [1, 2];
  return tier >= lo && tier <= hi;
}

/** Display name: the type (and the finer type if any) */
export const sightLabel = (m: SightMeta): string => (m.variant && m.variant !== m.type.split('・')[0] ? `${m.type}(${m.variant})` : m.type);
