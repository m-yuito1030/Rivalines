import type { FacilityType } from '../../world/facilities';
import { TIERS, townTier, type Town } from '../../world/town';

/** 入札・独占権: 街ごと・施設の種類ごとの「独占権」を競りにかける。落札した会社だけが、その街(の範囲)にその種類の施設を建てられる */
export const AUCTION_TYPES: FacilityType[] = ['stadium', 'amusement', 'mall', 'department', 'hotel', 'arena', 'convention', 'zoo', 'ski', 'beach', 'stationmall'];
/** 入札の受付日数・同時に開く競りの数・競りを開く間隔(日)・入札の最低刻み(現在額の何倍以上か) */
export const LOT_DAYS = 3;
export const MAX_LOTS = 6;
export const OPEN_EVERY_DAYS = 2;
export const BID_STEP = 1.05;

export interface Lot {
  id: number;
  townId: number;
  type: FacilityType;
  /** 最低入札額 */
  minBid: number;
  /** 締め切りまでの残り日数(日締めのたびに減る。0 で締め切り) */
  left: number;
  bid?: { who: number; amount: number };
}
export interface Right {
  townId: number;
  type: FacilityType;
  owner: number;
  /** 落札額 */
  paid: number;
}
export interface AuctionState {
  lots: Lot[];
  rights: Right[];
  nextId: number;
}
export interface Settled {
  lot: Lot;
  /** 落札して支払えた会社(いなければ流札) */
  winner?: number;
  amount?: number;
  /** 落札者が支払えず流れた */
  failed?: boolean;
}

export class Auctions {
  lots: Lot[] = [];
  rights: Right[] = [];
  private nextId = 1;

  /** その街・種類の独占権を持つ会社 */
  holder(townId: number, type: FacilityType): number | undefined {
    return this.rights.find((r) => r.townId === townId && r.type === type)?.owner;
  }

  /** 競りを開く。すでに権利者がいる・競りが開いている街と種類は不可 */
  open(townId: number, type: FacilityType, minBid: number): Lot | null {
    if (this.holder(townId, type) !== undefined) return null;
    if (this.lots.some((l) => l.townId === townId && l.type === type)) return null;
    if (this.lots.length >= MAX_LOTS) return null;
    const lot: Lot = { id: this.nextId++, townId, type, minBid, left: LOT_DAYS };
    this.lots.push(lot);
    return lot;
  }

  /** 入札する。できなければ理由(現金の確認は呼び出し側) */
  minNext(lot: Lot): number {
    return lot.bid ? Math.ceil((lot.bid.amount * BID_STEP) / 10_000) * 10_000 : lot.minBid;
  }

  bid(who: number, lotId: number, amount: number): string | null {
    const lot = this.lots.find((l) => l.id === lotId);
    if (!lot) return '競りが見つかりません';
    if (!Number.isFinite(amount)) return '金額が不正です';
    if (lot.bid?.who === who) return 'すでにあなたが最高額です';
    const min = this.minNext(lot);
    if (amount < min) return `入札額が足りません(最低 ${min.toLocaleString()}円)`;
    lot.bid = { who, amount: Math.floor(amount) };
    return null;
  }

  /** 日締め: 残り日数を減らし、締め切った競りを決着する。pay は落札額を支払えるか(支払う)。支払えなければ流札 */
  settleDay(pay: (who: number, amount: number) => boolean): Settled[] {
    const out: Settled[] = [];
    for (const lot of [...this.lots]) {
      if (--lot.left > 0) continue;
      this.lots = this.lots.filter((l) => l !== lot);
      if (!lot.bid) {
        out.push({ lot });
      } else if (pay(lot.bid.who, lot.bid.amount)) {
        this.rights.push({ townId: lot.townId, type: lot.type, owner: lot.bid.who, paid: lot.bid.amount });
        out.push({ lot, winner: lot.bid.who, amount: lot.bid.amount });
      } else out.push({ lot, failed: true });
    }
    return out;
  }

  toJSON(): AuctionState {
    return { lots: this.lots, rights: this.rights, nextId: this.nextId };
  }

  load(s: AuctionState): void {
    this.lots = s.lots ?? [];
    this.rights = s.rights ?? [];
    this.nextId = s.nextId ?? 1;
  }
}

/** (x,y) に who が type の施設を建てるのを妨げる、他社の独占権(街の範囲内)。なければ undefined */
export function blockingRight(a: Auctions, towns: Pick<Town, 'x' | 'y' | 'pop' | 'tier'>[], who: number, type: FacilityType, x: number, y: number): Right | undefined {
  for (const r of a.rights) {
    if (r.type !== type || r.owner === who) continue;
    const t = towns[r.townId - 1];
    if (t && Math.hypot(x - t.x, y - t.y) <= TIERS[townTier(t)].radius) return r;
  }
  return undefined;
}
