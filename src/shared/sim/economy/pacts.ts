/** 提携(乗り入れ契約): 2社が合意すると、互いの線路・道路を通るときの通行料が割り引かれる(双方向) */
export const PACT_DISCOUNTS = [0.25, 0.5, 0.75, 1] as const;
/** 1社が同時に出せる申し込みの上限 */
export const MAX_PROPOSALS = 5;

export interface Pact {
  id: number;
  a: number;
  b: number;
  /** 通行料の割引率(1=無料) */
  discount: number;
}
export interface PactProposal {
  id: number;
  from: number;
  to: number;
  discount: number;
}
export interface PactState {
  pacts: Pact[];
  proposals: PactProposal[];
  nextId: number;
}

export class Pacts {
  pacts: Pact[] = [];
  proposals: PactProposal[] = [];
  private nextId = 1;

  private linked(x: number, y: number): boolean {
    return this.pacts.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x)) || this.proposals.some((p) => (p.from === x && p.to === y) || (p.from === y && p.to === x));
  }

  /** 2社の間の通行料の割引率(提携がなければ 0) */
  discountBetween(x: number, y: number): number {
    if (x === y) return 0;
    return this.pacts.find((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x))?.discount ?? 0;
  }

  /** 申し込む。できなければ理由 */
  propose(from: number, to: number, discount: number): string | null {
    if (from === to) return '自社とは提携できません';
    if (!(PACT_DISCOUNTS as readonly number[]).includes(discount)) return '割引率が不正です';
    if (this.linked(from, to)) return 'すでに提携中、または申し込み中です';
    if (this.proposals.filter((p) => p.from === from).length >= MAX_PROPOSALS) return `同時に出せる申し込みは${MAX_PROPOSALS}件までです`;
    this.proposals.push({ id: this.nextId++, from, to, discount });
    return null;
  }

  /** 申し込みへの返事(受け取った会社だけ)。承諾すると提携が成立する */
  respond(who: number, id: number, accept: boolean): string | null {
    const i = this.proposals.findIndex((p) => p.id === id);
    if (i < 0 || this.proposals[i].to !== who) return '申し込みが見つかりません';
    const [p] = this.proposals.splice(i, 1);
    if (accept) this.pacts.push({ id: this.nextId++, a: p.from, b: p.to, discount: p.discount });
    return null;
  }

  /** 提携の解消(当事者のどちらでも)、または申し込みの取り下げ(申し込んだ側) */
  cancel(who: number, id: number): string | null {
    const i = this.pacts.findIndex((p) => p.id === id && (p.a === who || p.b === who));
    if (i >= 0) {
      this.pacts.splice(i, 1);
      return null;
    }
    const j = this.proposals.findIndex((p) => p.id === id && p.from === who);
    if (j >= 0) {
      this.proposals.splice(j, 1);
      return null;
    }
    return '見つかりません';
  }

  toJSON(): PactState {
    return { pacts: this.pacts, proposals: this.proposals, nextId: this.nextId };
  }

  load(s: PactState): void {
    this.pacts = s.pacts ?? [];
    this.proposals = s.proposals ?? [];
    this.nextId = s.nextId ?? 1;
  }
}
