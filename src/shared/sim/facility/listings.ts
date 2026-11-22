import { type Facility, removeFacility } from '../../world/facilities';
import type { GameMap } from '../../world/gameMap';
import { facilityValue } from '../economy/economy';

/**
 * 売り出し中の物件(不動産物件): どの会社も持っていない施設。プレイヤーが売却した施設と、街が建てた民間の施設がなる。
 * 誰でも評価額で買える。LISTING_DAYS 日のあいだ買い手がつかないと、取り壊されて更地に戻る。
 */
export const LISTING_DAYS = 28;

/** 売り出し中か(持ち主がいない民間の施設。競合会社が持っている施設・公共施設・自社/他のプレイヤーの施設は含まない) */
export const isForSale = (f: Pick<Facility, 'owner' | 'ownerId'>): boolean => f.owner === 'city' && f.ownerId === undefined;

/** 売り出しの残り日数(売り出し日からの経過で減る。まだ日付がつかない物件は満期の日数) */
export const listingLeft = (f: Pick<Facility, 'listedDay'>, day: number): number => (f.listedDay === undefined ? LISTING_DAYS : Math.max(0, LISTING_DAYS - (day - f.listedDay)));

/** 売り出し価格(評価額) */
export const askingPrice = (f: Facility): number => facilityValue(f);

/** 売り出し中の物件の一覧 */
export const listedFacilities = (map: Pick<GameMap, 'facilities'>): Facility[] => map.facilities.filter(isForSale);

/**
 * 日締め(day=今の日の通し番号): 新しく売り出された物件(売却したばかり・街が建てた・古いセーブ)に売り出し日をつけ、
 * 売り出しでなくなった物件の日付を消し、期限が過ぎた物件を取り壊して更地に戻す。取り壊した施設を返す
 */
export function processListings(map: GameMap, day: number): Facility[] {
  const removed: Facility[] = [];
  for (const f of [...map.facilities]) {
    if (!isForSale(f)) {
      if (f.listedDay !== undefined) f.listedDay = undefined;
      continue;
    }
    if (f.listedDay === undefined) {
      f.listedDay = day;
      map.facilityVer++;
    } else if (listingLeft(f, day) <= 0) {
      removeFacility(map, f);
      removed.push(f);
    }
  }
  return removed;
}
