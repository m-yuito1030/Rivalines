import { Vehicle, dirBetween, signalPair } from './types';
import type { Transit } from './transit';

/** Signals and blocks (rail reservations) */
export class SignalSystem {
  constructor(private readonly t: Transit) {}

  /** A signal's direction bits. If the tile is no longer a straight track, remove the signal */
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
   * Cycle a tile's signal: none -> one direction -> opposite direction -> none (a two-way signal is the same as none; do not use it on single track, use it on double track to separate up and down).
   * Only on straight (north-south / east-west) track that is not a station, bridge, or tunnel. Returns the new direction bits (null if it cannot be placed)
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

  /** Place a signal with the given direction bits (overwrites an existing one). True if it is straight track that is not a station or bridge. False if the direction does not match the track */
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

  /** Whether entering path[i] is controlled by a signal (a signal in the direction path[i-1] -> path[i] exists) */
  controlled(path: Uint32Array, i: number): boolean {
    if (!this.t.signals.size) return false;
    const d = dirBetween(path[i - 1], path[i], this.t.map.size);
    return d >= 0 && d < 8 && (this.signalMask(path[i]) & (1 << d)) !== 0;
  }

  /**
   * The end of the next range to reserve (an index into path). With no signals, up to the end;
   * if before a signal, up to just before that signal; if right before a signal, up to just before the next signal (= secure the block beyond the signal).
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

  /** Reserve the block ahead. If another train uses it, do nothing and return false (red signal) */
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

  /** Whether the signal is red (the block being entered is already reserved) */
  signalIsRed(idx: number): boolean {
    return this.t.reserved.has(idx);
  }
}
