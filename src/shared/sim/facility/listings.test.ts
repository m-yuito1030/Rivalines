import { describe, expect, it } from 'vitest';
import { LISTING_DAYS, askingPrice, isForSale, listedFacilities, listingLeft, processListings } from './listings';
import { FACILITY_TILE, type Facility, placeFacility, planFacility, facilityDims } from '../../world/facilities';
import { GameMap } from '../../world/gameMap';
import { SEA_LEVEL } from '../../world/constants';
import { facilityValue } from '../economy/economy';

const flat = () => new GameMap(64, 1, new Uint8Array(64 * 64).fill(SEA_LEVEL + 20));
const build = (m: GameMap, x: number, y: number, over: Partial<Facility> = {}): Facility => {
  const plan = planFacility(m, x, y, 'hotel', () => false, facilityDims('hotel', 'M'));
  expect(plan.ok).toBe(true);
  const f = placeFacility(m, plan, 'hotel', 'city');
  f.size = 'M';
  f.design = 0;
  return Object.assign(f, over);
};

describe('不動産物件(売り出し)', () => {
  it('売り出し中の判定: 持ち主のいない民間の施設だけ。競合の施設・公共・プレイヤーの施設は対象外', () => {
    expect(isForSale({ owner: 'city', ownerId: undefined })).toBe(true);
    expect(isForSale({ owner: 'city', ownerId: 3 })).toBe(false); // 競合会社が持っている
    expect(isForSale({ owner: 'player', ownerId: undefined })).toBe(false);
    expect(isForSale({ owner: 'public', ownerId: undefined })).toBe(false);
    expect(isForSale({ owner: undefined, ownerId: undefined })).toBe(false);
  });

  it('残り日数: 売り出し日からの経過で減り、0で止まる。日付がまだなければ満期の日数。価格は評価額', () => {
    expect(listingLeft({ listedDay: 10 }, 10)).toBe(LISTING_DAYS);
    expect(listingLeft({ listedDay: 10 }, 20)).toBe(LISTING_DAYS - 10);
    expect(listingLeft({ listedDay: 10 }, 10 + LISTING_DAYS)).toBe(0);
    expect(listingLeft({ listedDay: 10 }, 999)).toBe(0);
    expect(listingLeft({}, 5)).toBe(LISTING_DAYS);
    expect(LISTING_DAYS).toBe(28);
    const m = flat();
    const f = build(m, 20, 20);
    expect(askingPrice(f)).toBe(facilityValue(f));
  });

  it('日締め: 売り出し日がつき、28日後に取り壊されて更地に戻る。それまでは残る', () => {
    const m = flat();
    const f = build(m, 20, 20);
    const g = build(m, 40, 40);
    expect(f.listedDay).toBeUndefined();
    expect(processListings(m, 100)).toEqual([]);
    expect(f.listedDay).toBe(100); // 初めての日締めで売り出し日がつく
    expect(listedFacilities(m)).toHaveLength(2);
    // 27日後(残り1日)までは残る
    expect(processListings(m, 100 + LISTING_DAYS - 1)).toEqual([]);
    expect(m.facilities).toHaveLength(2);
    // 28日後: 取り壊し
    const gone = processListings(m, 100 + LISTING_DAYS);
    expect(gone.map((x) => x.id).sort()).toEqual([f.id, g.id].sort());
    expect(m.facilities).toHaveLength(0);
    // 敷地は更地(施設のタイルが残っていない)
    for (const [x, y] of [
      [20, 20],
      [21, 21],
      [40, 40],
      [41, 41],
    ])
      expect(m.building.get(m.idx(x, y))).not.toBe(FACILITY_TILE);
  });

  it('売り出しでない施設は取り壊さない。売り出しをやめた(購入された)物件の日付は消える', () => {
    const m = flat();
    const own = build(m, 10, 10, { owner: 'player', playerId: 1 });
    const rival = build(m, 30, 30, { ownerId: 4 }); // 競合会社の施設
    const pub = build(m, 50, 50, { owner: 'public' });
    const sold = build(m, 20, 40);
    processListings(m, 100);
    expect(sold.listedDay).toBe(100);
    sold.owner = 'player'; // 購入された
    sold.playerId = 2;
    processListings(m, 100 + 500);
    expect(sold.listedDay).toBeUndefined();
    expect(m.facilities.map((f) => f.id).sort()).toEqual([own.id, rival.id, pub.id, sold.id].sort());
  });
});
