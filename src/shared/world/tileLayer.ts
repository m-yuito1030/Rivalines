/** 小さいマップはこのタイル数(一辺)まで1枚の配列で持つ。超えたらチャンクの疎配列 */
export const DENSE_MAX = 2048;
export const CHUNK_SHIFT = 6;
export const CHUNK = 1 << CHUNK_SHIFT; // 64
const MASK = CHUNK - 1;

type Arr = Uint8Array | Uint16Array;

/**
 * タイルごとの値の層。index = y*size + x(最大 65535² でも double で正確)。
 * 小さいマップは単一配列、大きいマップは 64x64 チャンクの疎配列(触ったチャンクだけメモリに持つ)。
 */
export class TileLayer<A extends Arr = Uint8Array> {
  private dense: A | null = null;
  private chunks = new Map<number, A>();
  private readonly cw: number;

  constructor(
    readonly size: number,
    private readonly make: (n: number) => A,
  ) {
    this.cw = Math.ceil(size / CHUNK);
    if (size <= DENSE_MAX) this.dense = make(size * size);
  }

  get(i: number): number {
    if (this.dense) return this.dense[i];
    const x = i % this.size;
    const y = (i - x) / this.size;
    const c = this.chunks.get((y >> CHUNK_SHIFT) * this.cw + (x >> CHUNK_SHIFT));
    return c ? c[((y & MASK) << CHUNK_SHIFT) | (x & MASK)] : 0;
  }

  set(i: number, v: number): void {
    if (this.dense) {
      this.dense[i] = v;
      return;
    }
    const x = i % this.size;
    const y = (i - x) / this.size;
    const key = (y >> CHUNK_SHIFT) * this.cw + (x >> CHUNK_SHIFT);
    let c = this.chunks.get(key);
    if (!c) {
      if (v === 0) return;
      c = this.make(CHUNK * CHUNK);
      this.chunks.set(key, c);
    }
    c[((y & MASK) << CHUNK_SHIFT) | (x & MASK)] = v;
  }

  /** 0 以外の値を持つタイルを走査する(セーブ用) */
  forEachNonZero(fn: (i: number, v: number) => void): void {
    if (this.dense) {
      const d = this.dense;
      for (let i = 0; i < d.length; i++) if (d[i]) fn(i, d[i]);
      return;
    }
    for (const [key, c] of this.chunks) {
      const cx = key % this.cw;
      const cy = (key - cx) / this.cw;
      for (let l = 0; l < c.length; l++) {
        if (!c[l]) continue;
        const x = (cx << CHUNK_SHIFT) + (l & MASK);
        const y = (cy << CHUNK_SHIFT) + (l >> CHUNK_SHIFT);
        fn(y * this.size + x, c[l]);
      }
    }
  }

  /** 矩形(チャンク単位の範囲)をすべて0にする */
  clearRect(x0: number, y0: number, w: number, h: number): void {
    if (this.dense) {
      for (let y = y0; y < y0 + h && y < this.size; y++) for (let x = x0; x < x0 + w && x < this.size; x++) this.dense[y * this.size + x] = 0;
      return;
    }
    this.chunks.delete((y0 >> CHUNK_SHIFT) * this.cw + (x0 >> CHUNK_SHIFT));
  }

  /** タイル総数 */
  get length(): number {
    return this.size * this.size;
  }

  /** 他の層の内容をそっくり写す(同じ size) */
  copyFrom(o: TileLayer<A>): void {
    this.forEachNonZero((i) => this.set(i, 0));
    o.forEachNonZero((i, v) => this.set(i, v));
  }

  /** 確保済みメモリ(バイト) */
  get bytes(): number {
    return this.dense ? this.dense.byteLength : this.chunks.size * CHUNK * CHUNK * this.make(0).BYTES_PER_ELEMENT;
  }
}

const mk8 = (n: number) => new Uint8Array(n);
const mk16 = (n: number) => new Uint16Array(n);
export const u8Layer = (size: number) => new TileLayer<Uint8Array>(size, mk8);
export const u16Layer = (size: number) => new TileLayer<Uint16Array>(size, mk16);
