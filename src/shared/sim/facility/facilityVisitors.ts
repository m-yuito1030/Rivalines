/**
 * 施設(スタジアム・遊園地・モール・公園・百貨店・ホテル)の来場者。1日の締めに、乗客の到着(停留所経由)とは別に「周辺から来る人」を計算する。
 *
 * - 周辺の人口の 2割 を上限に、0〜上限の範囲でランダムな人数が来る。
 * - 集客圏に停留所・駅があると、来場者が増える(STATION_BOOST)。
 * - 近くに同じ種類の施設(自社・他社どちらも)があると、人数が分散して減る。他の種類の施設も少し減らす。
 * - 広告(新聞・SNS・テレビ)を出すと、自施設は一時的に増え、近くの他の施設は減る。広告は施設ごとに一定期間に1度だけ。
 */
import { FACILITY_SPECS, type Facility, type FacilityType, facilityAttract, facilityBuildCost } from '../../world/facilities';
import { demandMul, elasticity, priceMul } from './pricing';
import { freshness, gradeOf, gradeSpendMul, nextRep, repMul, repOf, satisfaction } from '../../world/facilityQuality';
import type { GameMap } from '../../world/gameMap';
import type { Transit } from '../network/transit';

/** この種類の施設が、人口からの来場者の対象か(公共施設は対象外) */
export const VISITOR_TYPES: FacilityType[] = ['stadium', 'amusement', 'mall', 'park', 'department', 'hotel'];

/** 来場者の上限の目安(人口の割合)と、1日の来場者の上限(attract に対する割合)、停留所があるときの倍率 */
export const WALKIN_FRACTION = 0.2;
export const CAP_PER_ATTRACT = 0.3;
export const STATION_BOOST = 1.8;
/** 人口を数える範囲(タイル)と、競合・広告の影響が及ぶ範囲 */
export const POP_RADIUS = 60;
export const RIVAL_RADIUS = 30;

export type AdKind = 'news' | 'sns' | 'tv';
/** 広告: 費用は施設の建設費に対する割合。mul=自施設の来場者の倍率、rival=近くの他の施設の倍率、days=効く日数 */
export const AD_TYPES: Record<AdKind, { name: string; costRate: number; mul: number; rival: number; days: number }> = {
  news: { name: '新聞', costRate: 0.02, mul: 1.3, rival: 0.9, days: 3 },
  sns: { name: 'SNS', costRate: 0.05, mul: 1.6, rival: 0.85, days: 5 },
  tv: { name: 'テレビ', costRate: 0.15, mul: 2.2, rival: 0.7, days: 3 },
};
/** 広告を打ってから、同じ施設で次の広告を打てるまでの日数 */
export const AD_COOLDOWN_DAYS = 14;

export const adCost = (f: Pick<Facility, 'type' | 'size' | 'design'>, kind: AdKind): number => Math.round((facilityBuildCost(f) * AD_TYPES[kind].costRate) / 1000) * 1000;

/** 広告が効いているか(day: 日の通し番号) */
export const adActive = (f: Facility, day: number): boolean => !!f.ad && day >= f.ad.from && day < f.ad.from + AD_TYPES[f.ad.kind].days;

/** 広告を打てるか。打てなければ理由 */
export function adAvailable(f: Facility, day: number): string | null {
  if (!VISITOR_TYPES.includes(f.type)) return 'この施設には広告を出せません';
  if (f.ad && day < f.ad.from + AD_COOLDOWN_DAYS) return `前の広告から${AD_COOLDOWN_DAYS}日あけてください(あと${f.ad.from + AD_COOLDOWN_DAYS - day}日)`;
  return null;
}

/**
 * 1日の締め: 各施設の来場者を決め、自社(player)の施設は売上にする。
 * pay: 自社施設の売上を受け取る会社(マルチ: 施設の持ち主の会社。ソロ: 自社)。null なら売上にしない(他社・街の施設)。
 * 戻り値: 来場者の合計
 */
export function dailyVisitors(map: GameMap, transit: Transit, day: number, rng: () => number, pay: (f: Facility, amount: number) => void): number {
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
  // 周辺の人口(距離で薄める)
  const popNear = (f: Facility): number => {
    let p = 0;
    for (const t of map.towns) {
      const d = Math.hypot(t.x - f.x0, t.y - f.y0);
      if (d < POP_RADIUS) p += t.pop * Math.min(1, (POP_RADIUS - d) / (POP_RADIUS * 0.75));
    }
    return p;
  };
  // 集客圏に停留所がある施設
  const served = new Set<number>();
  for (const s of transit.stops.values()) if (!s.waypoint && s.facs) for (const id of s.facs) served.add(id);
  let total = 0;
  for (const f of fs) {
    const spec = FACILITY_SPECS[f.type];
    const cap = facilityAttract(f) * CAP_PER_ATTRACT;
    const station = served.has(f.id);
    let v = Math.min(cap, rng() * WALKIN_FRACTION * popNear(f)) * (station ? STATION_BOOST : 1);
    // 近くの施設(自社・他社どちらも)との分散
    const others = near(f, RIVAL_RADIUS);
    const same = others.filter((o) => o.type === f.type).length;
    v /= 1 + 0.6 * same + 0.1 * (others.length - same);
    // 広告: 自施設は増え、近くで広告を打っている他の施設の分だけ減る
    if (adActive(f, day)) v *= AD_TYPES[f.ad!.kind].mul;
    for (const o of others) if (adActive(o, day)) v *= AD_TYPES[o.ad!.kind].rival;
    // 料金: 上げると1人あたりの売上が増え、来場者は減る(いちばん儲かる料金は周辺の事情で変わる)
    const k = elasticity(f.type, same, station, adActive(f, day));
    f.elast = k;
    v *= demandMul(priceMul(f), k);
    // 質: 新しさ(古いと人気が落ちる)と評判(満足度に向かって少しずつ動く)が来場者に効く。評判は料金・設備・駅・混雑で決まる
    f.renov ??= day;
    const fresh = freshness(f, day);
    v *= fresh * repMul(repOf(f));
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
