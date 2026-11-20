export interface Town {
  id: number; // 1始まり(map.owner に格納)
  name: string;
  x: number; // 中心タイル
  y: number;
  pop: number;
  houses: number;
  /** この街が敷いた道路タイル(index = y*size+x)。成長時の抽選用 */
  roads: number[];
  nextGrowth: number; // 次回成長するシミュレーションtick
  /** 最近の輸送実績(乗降人数, 日ごとに減衰)。成長を加速する */
  pax: number;
  /** 街の段階(0村 1街 2都市 3特大都市 4首都)。生まれたときに決まり、その人口の範囲でだけ成長する。古いセーブにはなく、人口から決める */
  tier?: number;
}

/** 建物レベル(1..3)ごとの人口(村・街の基準。大都市ほど建物あたりの人口が多い=高層化: popMul) */
export const POP_PER_LEVEL = [0, 6, 16, 36] as const;

/**
 * 街の段階。min は生まれたときの人口、max(未満)はその段階で成長できる上限。
 * weight は生まれる割合(合計1)、mul は建物あたりの人口倍率、radius は街の広がり(タイル)、roads は道路タイルの上限。
 * 街のデザイン: maxLevel は建物の最大の高さ(1=S 2=M 3=L)、l1/l2 は低層・中層の累積割合(残りが高層)、office はオフィスビルの多さ(中心ほど多い)。村は低い住宅だけ、都市から高層・オフィス街になる。
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
/** 建物あたり人口の倍率(街の段階による) */
export const popMul = (t: Pick<Town, 'pop' | 'tier'> | undefined): number => (t ? TIERS[townTier(t)].mul : 1);
