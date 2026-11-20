import { Vehicle, dirBetween, signalPair } from './types';
import type { Transit } from './transit';

/** 信号・閉塞(鉄道の予約) */
export class SignalSystem {
  constructor(private readonly t: Transit) {}

  /** 信号の方向ビット。直線の線路でなくなっていたら信号を取り除く */
  signalMask(idx: number): number {
    const mk = this.t.signals.get(idx);
    if (!mk) return 0;
    if (!signalPair(this.t.map.rail.get(idx))) {
      this.t.signals.delete(idx);
      return 0;
    }
    return mk;
  }

  /**
   * タイルの信号を切り替える: なし → 一方向 → 逆方向 → なし(両方向の信号はなし。単線では使わず、複線で上り下りを分ける)。
   * 直線(南北/東西)の線路で、駅・橋・トンネルでないタイルのみ。戻り値は新しい方向ビット(置けなければ null)
   */
  cycleSignal(x: number, y: number): number | null {
    const m = this.t.map;
    if (!m.inBounds(x, y)) return null;
    const i = m.idx(x, y);
    const pair = signalPair(m.rail.get(i));
    if (!pair || m.span.get(i) || this.t.stopAtTile(x, y, 'rail')) return null;
    const [a, b] = pair;
    const cur = this.signalMask(i);
    const next = cur === 0 ? a : cur === a ? b : 0;
    if (next) this.t.signals.set(i, next);
    else this.t.signals.delete(i);
    this.t.touchNetwork(x, y);
    this.t.version++;
    return next;
  }

  /** 信号を指定の向きビットで置く(既存は上書き)。直線の線路で駅・橋でなければ true。向きが線路の方向でなければ false */
  setSignal(x: number, y: number, mask: number): boolean {
    const m = this.t.map;
    if (!m.inBounds(x, y)) return false;
    const i = m.idx(x, y);
    const pair = signalPair(m.rail.get(i));
    if (!pair || m.span.get(i) || this.t.stopAtTile(x, y, 'rail')) return false;
    if (mask !== pair[0] && mask !== pair[1]) return false;
    this.t.signals.set(i, mask);
    this.t.touchNetwork(x, y);
    this.t.version++;
    return true;
  }

  /** path[i] への進入が信号で制御されているか(path[i-1]→path[i] の向きの信号がある) */
  controlled(path: Uint32Array, i: number): boolean {
    if (!this.t.signals.size) return false;
    const d = dirBetween(path[i - 1], path[i], this.t.map.size);
    return d >= 0 && d < 8 && (this.signalMask(path[i]) & (1 << d)) !== 0;
  }

  /**
   * 次に予約する範囲の末尾(path の添字)。信号がなければ終点まで、
   * 信号の手前までなら信号の1つ手前まで、信号の直前なら次の信号の手前まで(= 信号の先の閉塞を確保)。
   */
  nextReserveEnd(v: Vehicle): number {
    const p = v.path;
    let m1 = -1;
    for (let i = v.resTo + 1; i < p.length; i++) {
      if (this.controlled(p, i)) {
        m1 = i;
        break;
      }
    }
    if (m1 < 0) return p.length - 1;
    if (m1 > v.resTo + 1) return m1 - 1;
    for (let i = m1 + 1; i < p.length; i++) if (this.controlled(p, i)) return i - 1;
    return p.length - 1;
  }

  /** 前方の閉塞を予約する。他編成が使っていれば何もせず false(赤信号) */
  extendReservation(v: Vehicle): boolean {
    if (v.resTo >= v.path.length - 1) return true;
    const end = this.nextReserveEnd(v);
    for (let i = v.resTo + 1; i <= end; i++) {
      const o = this.t.reserved.get(v.path[i]);
      if (o !== undefined && o !== v.id) return false;
    }
    for (let i = v.resTo + 1; i <= end; i++) this.t.reserved.set(v.path[i], v.id);
    v.resTo = end;
    return true;
  }

  /** 信号が赤か(進入先の閉塞がすでに予約されている) */
  signalIsRed(idx: number): boolean {
    return this.t.reserved.has(idx);
  }
}
