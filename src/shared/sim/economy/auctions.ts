import type { FacilityType } from '../../world/facilities';
import { TIERS, townTier, type Town } from '../../world/town';

/** Auctions and monopoly rights: a "monopoly right" per town and facility type is put up for auction. Only the winning company may build facilities of that type in that town (within its area) */
export const AUCTION_TYPES: FacilityType[] = ['stadium', 'amusement', 'mall', 'department', 'hotel', 'arena', 'convention', 'zoo', 'ski', 'beach', 'stationmall'];
/** Days a bid is open, number of auctions open at once, interval between auctions (days), and the minimum bid step (a multiple of the current amount) */
export const LOT_DAYS = 3;
export const MAX_LOTS = 6;
export const OPEN_EVERY_DAYS = 2;
export const BID_STEP = 1.05;

export interface Lot {
  id: number;
  townId: number;
  type: FacilityType;
  /** Minimum bid */
  minBid: number;
  /** Days left until the deadline (decreases at each day close; closes at 0) */
  left: number;
  bid?: { who: number; amount: number };
}
export interface Right {
  townId: number;
  type: FacilityType;
  owner: number;
  /** Winning bid */
  paid: number;
}
export interface AuctionState {
  lots: Lot[];
  rights: Right[];
  nextId: number;
}
export interface Settled {
  lot: Lot;
  /** The company that won and could pay (none if the lot went unsold) */
  winner?: number;
  amount?: number;
  /** The winner could not pay, so the lot fell through */
  failed?: boolean;
}

export class Auctions {
  lots: Lot[] = [];
  rights: Right[] = [];
  private nextId = 1;

  /** The company holding the monopoly right for that town and type */
  holder(townId: number, type: FacilityType): number | undefined {
    return this.rights.find((r) => r.townId === townId && r.type === type)?.owner;
  }

  /** Open an auction. Not allowed for a town and type that already has a rights holder or an open auction */
  open(townId: number, type: FacilityType, minBid: number): Lot | null {
    if (this.holder(townId, type) !== undefined) return null;
    if (this.lots.some((l) => l.townId === townId && l.type === type)) return null;
    if (this.lots.length >= MAX_LOTS) return null;
    const lot: Lot = { id: this.nextId++, townId, type, minBid, left: LOT_DAYS };
    this.lots.push(lot);
    return lot;
  }

  /** Place a bid. On failure, returns the reason (checking cash is up to the caller) */
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

  /** Day close: decrease days left and settle auctions that reached the deadline. `pay` charges the winning bid if affordable; if not, the lot goes unsold */
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

/** Another company's monopoly right (within the town's area) that stops `who` from building a facility of `type` at (x,y). undefined if none */
export function blockingRight(a: Auctions, towns: Pick<Town, 'x' | 'y' | 'pop' | 'tier'>[], who: number, type: FacilityType, x: number, y: number): Right | undefined {
  for (const r of a.rights) {
    if (r.type !== type || r.owner === who) continue;
    const t = towns[r.townId - 1];
    if (t && Math.hypot(x - t.x, y - t.y) <= TIERS[townTier(t)].radius) return r;
  }
  return undefined;
}
