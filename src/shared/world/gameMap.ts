import { levelOf } from './constants';
import type { Town } from './town';
import type { Facility } from './facilities';
import { CHUNK, CHUNK_SHIFT, type TileLayer, u16Layer, u8Layer } from './tileLayer';

/** チャンク(64x64)の高度を返す生成関数。巨大マップの地形は必要になったチャンクだけ作る */
export type HeightChunkGen = (cx: number, cy: number) => Uint8Array;
/** 1点の高度(キャッシュなし。ミニマップなどの粗い参照用) */
export type HeightPoint = (x: number, y: number) => number;

/** 高度配列から簡易ハッシュ(FNV-1a, 間引きサンプル)。セーブ時の地形一致検査に使う */
export function heightHash(h: Uint8Array): number {
  let x = 0x811c9dc5;
  const step = Math.max(1, Math.floor(h.length / 65536) | 1);
  for (let i = 0; i < h.length; i += step) x = Math.imul(x ^ h[i], 0x01000193);
  return x >>> 0;
}

/** ゲームマップ(タイルデータ。TypedArrayで保持) */
export class GameMap {
  /** 道路: 下位4bit=接続(N,E,S,W) 上位4bit=その方向への通行可。0なら道路なし */
  readonly road: TileLayer;
  /** 線路: 下位4bit=接続(N,E,S,W)。双方向のみ。0なら線路なし */
  readonly rail: TileLayer;
  /** 橋/トンネルの中間タイル: bit4=橋 bit5=トンネル, 下位4bit=路面の段数(橋の高さ)。0なら通常 */
  readonly span: TileLayer;
  /** 空港タイル: 0=なし 1=エプロン 2=滑走路 3=ターミナル */
  readonly air: TileLayer;
  /** 建物: 0=なし, bit0-1=レベル(1..3), bit2-5=見た目バリエーション */
  readonly building: TileLayer;
  /** 建設中の建物: 1=工事中(建物は置かれているが、まだ使えない)。セーブは SimState.sites から復元する */
  readonly construction: TileLayer;
  /** サーバー: 工事中のタイル(index) → 完成する時刻(tick) */
  readonly sites = new Map<number, number>();
  /** 建物の所属する街ID(0=なし) */
  readonly owner: TileLayer<Uint16Array>;
  /** マルチプレイ: 道路・線路を敷いた会社(アカウントID)。0=なし/無所有 */
  readonly infraOwner: TileLayer<Uint16Array>;
  readonly towns: Town[] = [];
  /** 巨大マップ: 街を生成済みの区画(ry*区画数+rx) */
  readonly townRegions = new Set<number>();
  /** 大型施設(スタジアムなど)。敷地は building レイヤーに FACILITY_TILE として置く */
  readonly facilities: Facility[] = [];
  /** facilities の増減のたびに増やす(描画用の索引の作り直し判定) */
  facilityVer = 0;
  /** タイルが変化したときの通知(描画の再生成用) */
  onTouch: ((x: number, y: number) => void) | null = null;
  /** 整地で編集されたタイル(index → 高度)。地形はシードから再生成するので差分だけ保存する */
  readonly edits = new Map<number, number>();
  editVersion = 0;
  /** シード生成直後の地形ハッシュ(編集前) */
  readonly baseHash: number;

  /** 高度: 小〜中マップは全体の配列、巨大マップはチャンクを遅延生成 */
  private dense: Uint8Array | null = null;
  private hchunks = new Map<number, Uint8Array>();
  private readonly cw: number;
  /** 巨大マップの高度の1点参照(ミニマップ用) */
  readonly heightPoint: HeightPoint | null;

  constructor(
    readonly size: number,
    readonly seed: number,
    height: Uint8Array | HeightChunkGen,
    heightPoint?: HeightPoint,
  ) {
    this.cw = Math.ceil(size / CHUNK);
    this.heightPoint = heightPoint ?? null;
    if (typeof height === 'function') {
      this.gen = height;
      this.baseHash = 0;
    } else {
      this.dense = height;
      this.baseHash = heightHash(height);
    }
    this.road = u8Layer(size);
    this.rail = u8Layer(size);
    this.air = u8Layer(size);
    this.span = u8Layer(size);
    this.building = u8Layer(size);
    this.construction = u8Layer(size);
    this.owner = u16Layer(size);
    this.infraOwner = u16Layer(size);
  }

  private gen: HeightChunkGen | null = null;

  /** 巨大マップか(チャンク方式) */
  get chunked(): boolean {
    return this.dense === null;
  }

  private heightIdx(x: number, y: number): number {
    if (this.dense) return this.dense[y * this.size + x];
    const key = (y >> CHUNK_SHIFT) * this.cw + (x >> CHUNK_SHIFT);
    let c = this.hchunks.get(key);
    if (!c) {
      c = this.gen!(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT).slice();
      for (const [i, h] of this.edits) {
        const ex = i % this.size;
        const ey = (i - ex) / this.size;
        if ((ey >> CHUNK_SHIFT) * this.cw + (ex >> CHUNK_SHIFT) === key) c[((ey & (CHUNK - 1)) << CHUNK_SHIFT) | (ex & (CHUNK - 1))] = h;
      }
      this.hchunks.set(key, c);
    }
    return c[((y & (CHUNK - 1)) << CHUNK_SHIFT) | (x & (CHUNK - 1))];
  }

  /** 高度の全体配列(小〜中マップのみ。保存・キャッシュ用) */
  get height(): Uint8Array {
    if (!this.dense) throw new Error('巨大マップは高度の全体配列を持ちません');
    return this.dense;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  idx(x: number, y: number): number {
    return y * this.size + x;
  }

  /** 範囲外は最寄りタイルにクランプして高度を返す */
  heightAt(x: number, y: number): number {
    const s = this.size - 1;
    const cx = x < 0 ? 0 : x > s ? s : x;
    const cy = y < 0 ? 0 : y > s ? s : y;
    return this.heightIdx(cx, cy);
  }

  levelAt(x: number, y: number): number {
    return levelOf(this.heightAt(x, y));
  }

  /** 乗り物・路面が載る高さ(段数)。橋・トンネルの中間タイルは路面の高さ */
  surfaceLevel(x: number, y: number): number {
    const sp = this.span.get(this.idx(Math.max(0, Math.min(this.size - 1, x)), Math.max(0, Math.min(this.size - 1, y))));
    return sp ? sp & 15 : this.levelAt(x, y);
  }

  /**
   * 連続的な路面の高さ(段数)。(fx,fy) はタイル内位置(0..1)。
   * 1段高い隣タイルへ道路/線路がつながっている場合、その方向へ中心→辺で1段ぶん上る(スロープ)。
   */
  smoothLevel(x: number, y: number, fx: number, fy: number): number {
    if (!this.inBounds(x, y)) return this.levelAt(x, y);
    const i = this.idx(x, y);
    const base = this.surfaceLevel(x, y);
    if (this.span.get(i)) return base;
    const conn = this.road.get(i) | this.rail.get(i);
    if (!(conn & 15)) return base;
    let up = 0;
    const t = [(0.5 - fy) * 2, (fx - 0.5) * 2, (fy - 0.5) * 2, (0.5 - fx) * 2];
    const dxs = [0, 1, 0, -1];
    const dys = [-1, 0, 1, 0];
    for (let d = 0; d < 4; d++) {
      if (!(conn & (1 << d)) || t[d] <= 0) continue;
      const nx = x + dxs[d];
      const ny = y + dys[d];
      if (!this.inBounds(nx, ny) || this.span.get(this.idx(nx, ny))) continue;
      if (this.levelAt(nx, ny) === base + 1) up = Math.max(up, Math.min(1, t[d]));
    }
    return base + up;
  }

  touch(x: number, y: number): void {
    this.onTouch?.(x, y);
  }

  /** セーブから整地の差分を戻す(描画通知なし) */
  restoreEdit(i: number, h: number): void {
    const x = i % this.size;
    const y = (i - x) / this.size;
    if (this.dense) this.dense[i] = h;
    else {
      this.heightIdx(x, y);
      this.hchunks.get((y >> CHUNK_SHIFT) * this.cw + (x >> CHUNK_SHIFT))![((y & (CHUNK - 1)) << CHUNK_SHIFT) | (x & (CHUNK - 1))] = h;
    }
    this.edits.set(i, h);
  }

  /** 整地: 高度を変更し、壁の描画に影響する隣接タイルも再描画対象にする */
  setHeight(x: number, y: number, h: number): void {
    const i = this.idx(x, y);
    if (this.dense) this.dense[i] = h;
    else {
      this.heightIdx(x, y); // チャンクを確保
      this.hchunks.get((y >> CHUNK_SHIFT) * this.cw + (x >> CHUNK_SHIFT))![((y & (CHUNK - 1)) << CHUNK_SHIFT) | (x & (CHUNK - 1))] = h;
    }
    this.edits.set(i, h);
    this.editVersion++;
    this.touch(x, y);
    this.touch(x - 1, y);
    this.touch(x, y - 1);
  }
}
