import { Container, Graphics, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js';
import { AIR_ALT, CAR_LEN, type Transit, WAIT_CAP } from '../sim/transit';
import { modelOf } from '../data/models';
import { LEVEL_PX } from '../world/constants';
import type { GameMap } from '../world/gameMap';
import { CONN, DX8, DY8 } from '../world/directions';
import { designParts, stationTiles } from '../world/stations';
import { FACILITY_TILE } from '../world/facilities';
import { SPRITE_H, SPRITE_W, buildingSpriteRect } from './buildingSprites';
import { hash2 } from './terrainDraw';
import type { View } from './chunkRenderer';
import { AIR_SCALE, BUS_SCALE, setVehicleSmoothing, trainFrame, vehicleFrame } from './vehicleSprites';
import { type Facility, isSpriteFacility } from '../world/facilities';

const shade = (c: number, k: number) => {
  const r = Math.min(255, ((c >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((c >> 8) & 255) * k) | 0;
  const b = Math.min(255, (c & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
};

/** 停留所・駅・車両・列車・航空機を描くレイヤー(ワールド座標、チャンクの上) */
/** 描画する向き(8方向)の単位ベクトル */
const S2 = Math.SQRT1_2;
const DIRS: [number, number][] = [[1, 0], [S2, S2], [0, 1], [-S2, S2], [-1, 0], [-S2, -S2], [0, -1], [S2, -S2]];
const dirIndex = (dx: number, dy: number) => (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) & 7;

/**
 * 停留所・駅・車両・列車・航空機を描くレイヤー(ワールド座標、チャンクの上)。
 * 駅や信号などの静的なもの(infra)は 4Hz か視点が外れたときだけ描き直し、
 * 車両は「型・色・向き」ごとに一度だけ作るテクスチャのスプライトで描く(ポリゴンを毎フレーム作らない)。
 */
export class TransitLayer {
  readonly g = new Container();
  private infra = new Graphics();
  private veh = new Container();
  private air = new Graphics();
  /** 選んだ車両の経路(矢印) */
  private routeG = new Graphics();
  /** 航空機の地面の影(車両より下に描く) */
  private shad = new Graphics();
  /** box() などの描画先(通常は infra。車両テクスチャの作成中は一時的に差し替える) */
  private gfx: Graphics = this.infra;
  private sprites: Sprite[] = [];
  private spritesUsed = 0;
  /** 駅・車両基地より手前にある街の建物(駅の上に描き直して、重なりの前後を正しくする) */
  private front = new Container();
  private frontSprites: Sprite[] = [];
  /** 駅の屋根・駅舎(車両より上に描く。列車が屋根の下に入って見えるように) */
  private roofG = new Graphics();
  private frameTex = new Map<string, Texture>();
  private texCache = new Map<string, { tex: Texture; ax: number; ay: number }>();
  private infraView: View | null = null;
  private infraAt = 0;
  /** 今回の再描画までの経過秒(人の増減アニメーション用) */
  private shownDt = 0;
  private infraVer = -1;
  private infraKey = '';
  /** 停留所ごとに、いま描いている人の数(待ち人数の増減に合わせてなめらかに増減させる) */
  private shown = new Map<number, number>();
  private shownAt = 0;

  constructor(
    private map: GameMap,
    private transit: Transit,
    private renderer: Renderer | null = null,
  ) {
    this.veh.sortableChildren = true;
    this.g.addChild(this.infra, this.shad, this.veh, this.roofG, this.front, this.air, this.routeG);
  }

  /**
   * 選んだ車両の経路を矢印でつないで描く。legs[0] は今向かっている区間(太く)、以降は予定(細く)。stops は停車駅のタイル。null で消す。
   */
  setRoute(legs: number[][] | null, color = 0xffd24a, stops: number[] = [], reserved: number[] = []): void {
    const g = this.routeG;
    g.clear();
    if (!legs) return;
    const s = this.map.size;
    const P = (i: number): [number, number] => {
      const x = i % s;
      const y = Math.floor(i / s);
      return [this.wx(x + 0.5, y + 0.5), this.wy(x + 0.5, y + 0.5, this.map.surfaceLevel(x, y), 3)];
    };
    // 予約済みの閉塞(他の編成が入れない範囲)を緑の帯で
    if (reserved.length > 1) {
      const rp: number[] = [];
      for (const i of reserved) {
        const [x, y] = P(i);
        rp.push(x, y);
      }
      g.poly(rp, false).stroke({ width: 11, color: 0x35d36a, alpha: 0.45, join: 'round', cap: 'round' });
    }
    legs.forEach((leg, li) => {
      if (leg.length < 2) return;
      const pts = leg.map(P);
      const main = li === 0;
      const poly: number[] = [];
      for (const [x, y] of pts) poly.push(x, y);
      g.poly(poly, false).stroke({ width: main ? 8 : 6, color: 0x000000, alpha: 0.35, join: 'round', cap: 'round' });
      g.poly(poly, false).stroke({ width: main ? 4.5 : 3, color, alpha: main ? 0.95 : 0.7, join: 'round', cap: 'round' });
      // 進行方向の矢じるし(数タイルおき)
      for (let i = 2; i < pts.length - 1; i += 3) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i + 1];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L;
        const uy = dy / L;
        const [cx, cy] = pts[i];
        const a = main ? 8 : 6;
        g.poly([cx + ux * a, cy + uy * a, cx - ux * a * 0.6 - uy * a * 0.8, cy - uy * a * 0.6 + ux * a * 0.8, cx - ux * a * 0.6 + uy * a * 0.8, cy - uy * a * 0.6 - ux * a * 0.8]).fill({ color, alpha: main ? 1 : 0.8 }).stroke({ width: 1.5, color: 0x000000, alpha: 0.5 });
      }
    });
    // 停車駅の目印
    stops.forEach((idx, k) => {
      const [x, y] = P(idx);
      g.circle(x, y, 7).fill({ color: 0xffffff, alpha: 0.95 }).stroke({ width: 2, color: 0x000000, alpha: 0.7 });
      void k;
    });
  }

  /** 連続タイル座標(U,V)+高さ → ワールド座標 */
  private wx = (u: number, v: number) => (u - v) * 32;
  private wy = (u: number, v: number, lvl: number, z = 0) => (u + v) * 16 - lvl * LEVEL_PX - z;

  /** 向き付きの箱。(cu,cv)=中心, (ax,ay)=長軸の単位ベクトル, len/wid=タイル比, h=高さpx, z0=底の高さ */
  private box(cu: number, cv: number, lvl: number, ax: number, ay: number, len: number, wid: number, h: number, color: number, z0 = 0, alpha = 1): void {
    const g = this.gfx;
    const bx = -ay;
    const by = ax;
    const pts = [
      [cu + (ax * len) / 2 + (bx * wid) / 2, cv + (ay * len) / 2 + (by * wid) / 2],
      [cu + (ax * len) / 2 - (bx * wid) / 2, cv + (ay * len) / 2 - (by * wid) / 2],
      [cu - (ax * len) / 2 - (bx * wid) / 2, cv - (ay * len) / 2 - (by * wid) / 2],
      [cu - (ax * len) / 2 + (bx * wid) / 2, cv - (ay * len) / 2 + (by * wid) / 2],
    ];
    for (let i = 0; i < 4; i++) {
      const [u0, v0] = pts[i];
      const [u1, v1] = pts[(i + 1) % 4];
      const mu = (u0 + u1) / 2 - cu;
      const mv = (v0 + v1) / 2 - cv;
      if (mu + mv <= 0) continue;
      g.poly([
        this.wx(u0, v0), this.wy(u0, v0, lvl, z0),
        this.wx(u1, v1), this.wy(u1, v1, lvl, z0),
        this.wx(u1, v1), this.wy(u1, v1, lvl, z0 + h),
        this.wx(u0, v0), this.wy(u0, v0, lvl, z0 + h),
      ]).fill({ color: shade(color, mu > mv ? 0.8 : 0.6), alpha });
    }
    g.poly(pts.flatMap(([u, v]) => [this.wx(u, v), this.wy(u, v, lvl, z0 + h)])).fill({ color, alpha });
  }

  /** 地面の影(車両の+u+v側へずらした平たい箱) */
  private shadow(cu: number, cv: number, lvl: number, ax: number, ay: number, len: number, wid: number): void {
    this.box(cu + 0.05, cv + 0.05, lvl, ax, ay, len + 0.04, wid + 0.06, 0.2, 0x000000, 0, 0.28);
  }

  /** 車輪(進行軸に沿って前後2組) */
  private wheels(cu: number, cv: number, lvl: number, ax: number, ay: number, len: number, wid: number): void {
    const bx = -ay;
    const by = ax;
    for (const f of [-0.32, 0.32]) {
      for (const sd of [-0.5, 0.5]) {
        this.box(cu + ax * len * f + bx * wid * sd, cv + ay * len * f + by * wid * sd, lvl, ax, ay, 0.1, 0.05, 3.2, 0x1e1f22, 0);
      }
    }
  }

  /** 待ち人数 → 描く人数の目標(待ち人数に比例。上限は設備の大きさ) */
  private crowdTarget(s: import('../sim/transit').Stop, cap: number, perPerson: number): number {
    return Math.min(cap, Math.ceil(s.waiting / perPerson));
  }

  /** いま描く人数(目標へ向けて1秒に約6人ずつ増減。人が来る/はけるのが見える) */
  private crowdShown(s: import('../sim/transit').Stop, target: number, dtSec: number): number {
    const cur = this.shown.get(s.id) ?? target;
    const step = Math.max(0.01, dtSec * 6);
    const next = cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
    this.shown.set(s.id, next);
    return Math.round(next);
  }

  /** 人1人(胴体+頭)。色は番号で決まる */
  private person(u: number, v: number, lvl: number, z: number, idx: number, salt: number): void {
    const colors = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0x34495e, 0xe67e22, 0xecf0f1];
    const c = colors[((idx * 2654435761 + salt * 40503) >>> 8) % colors.length];
    this.box(u, v, lvl, 1, 0, 0.07, 0.07, 7.5, c, z);
    this.box(u, v, lvl, 1, 0, 0.056, 0.056, 3.2, 0xf1c9a5, z + 7.5);
  }

  /** 大型施設(スタジアム・遊園地・モール・公園)を箱と図形で描く */
  private drawFacility(f: Facility, lvl: number, selected: boolean): void {
    const g = this.gfx;
    const { x0, y0, w, h } = f;
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    const sel = selected ? 0xff9a2f : 0;
    const P = (u: number, v: number, z = 0): [number, number] => [this.wx(u, v), this.wy(u, v, lvl, z)];
    if (f.type === 'stadium') {
      const team = sel || 0x2f7dd1;
      this.box(cx, cy, lvl, 1, 0, w, h, 1, 0xb9b5ab); // 広場
      // 奥の壁(北・西)→ グラウンド → 手前の壁(南・東)の順に描く
      this.box(cx, y0 + 0.3, lvl, 1, 0, w - 0.2, 0.6, 15, 0xd9d6cf);
      this.box(x0 + 0.3, cy, lvl, 0, 1, h - 1.2, 0.6, 15, 0xd9d6cf);
      this.box(cx, cy, lvl, 1, 0, w - 1.7, h - 1.7, 2, 0x45a35c, 1); // ピッチ
      this.box(cx, cy, lvl, 1, 0, w - 1.7, 0.05, 2.3, 0xf4f4f4, 1);
      this.box(cx, cy, lvl, 1, 0, 0.9, 0.9, 2.3, 0x3d9150, 1);
      this.box(cx, y0 + h - 0.3, lvl, 1, 0, w - 0.2, 0.6, 15, 0xe4e1da);
      this.box(x0 + w - 0.3, cy, lvl, 0, 1, h - 1.2, 0.6, 15, 0xe4e1da);
      this.box(cx, y0 + h - 0.3, lvl, 1, 0, w - 0.2, 0.62, 2, team, 15);
      this.box(x0 + w - 0.3, cy, lvl, 0, 1, h - 1.2, 0.62, 2, team, 15);
      for (const [u, v] of [[x0 + 0.25, y0 + 0.25], [x0 + w - 0.25, y0 + 0.25], [x0 + 0.25, y0 + h - 0.25], [x0 + w - 0.25, y0 + h - 0.25]]) {
        this.box(u, v, lvl, 1, 0, 0.1, 0.1, 34, 0x5a5f68);
        this.box(u, v, lvl, 1, 0, 0.3, 0.3, 3, 0xfff3b0, 34);
      }
    } else if (f.type === 'amusement') {
      this.box(cx, cy, lvl, 1, 0, w, h, 1, 0xe6d5c3); // 広場
      this.box(cx, y0 + 0.5, lvl, 1, 0, w - 0.4, 0.12, 1.5, 0xc9b8a6);
      // テント(奥から)
      const tents: [number, number, number][] = [[x0 + 0.9, y0 + 0.9, 0xe74c3c], [x0 + w - 1.0, y0 + 0.9, 0x3498db], [x0 + 0.9, y0 + h - 1.0, 0xf1c40f]];
      for (const [u, v, c] of tents) {
        this.box(u, v, lvl, 1, 0, 0.9, 0.9, 9, 0xf3efe6);
        this.box(u, v, lvl, 1, 0, 1.0, 1.0, 3, c, 9);
        this.box(u, v, lvl, 1, 0, 0.5, 0.5, 4, shade(c, 1.15), 12);
      }
      // メリーゴーラウンド
      this.box(x0 + w - 1.2, y0 + h - 1.2, lvl, 1, 0, 1.3, 1.3, 2, 0xd1b48c);
      this.box(x0 + w - 1.2, y0 + h - 1.2, lvl, 1, 0, 0.12, 0.12, 12, 0xf5f0e6, 2);
      this.box(x0 + w - 1.2, y0 + h - 1.2, lvl, 1, 0, 1.3, 1.3, 2, 0xe84393, 14);
      // 観覧車: 画面上の大きな輪(中心を高く)
      const [wx, wy] = P(cx, y0 + 1.7, 0);
      const R = 30;
      const hubY = wy - 40;
      g.moveTo(wx - 14, wy).lineTo(wx, hubY).lineTo(wx + 14, wy).stroke({ width: 3, color: 0x6b7280 });
      g.circle(wx, hubY, R).stroke({ width: 3, color: sel || 0xe74c3c });
      g.circle(wx, hubY, R * 0.5).stroke({ width: 1.5, color: 0xf1f5f9 });
      for (let a = 0; a < 6; a++) {
        const ang = (a * Math.PI) / 3;
        g.moveTo(wx, hubY).lineTo(wx + Math.cos(ang) * R, hubY + Math.sin(ang) * R).stroke({ width: 1.5, color: 0xf1f5f9 });
        g.circle(wx + Math.cos(ang) * R, hubY + Math.sin(ang) * R, 3.4).fill(([0xf1c40f, 0x3498db, 0xe74c3c, 0x2ecc71, 0x9b59b6, 0xe67e22] as number[])[a]);
      }
      g.circle(wx, hubY, 3.5).fill(0x374151);
    } else if (f.type === 'mall') {
      this.box(cx, cy, lvl, 1, 0, w, h, 0.8, 0x5a5d64); // 駐車場
      for (let i = 0; i < w - 0.5; i += 0.6) this.box(x0 + 0.4 + i, y0 + h - 0.55, lvl, 0, 1, 0.5, 0.03, 1, 0xe9e9e9, 0.8);
      const cars = [0xe74c3c, 0x3498db, 0xecf0f1, 0xf1c40f, 0x2ecc71];
      for (let i = 0; i < 5; i++) this.box(x0 + 0.7 + i * 0.7, y0 + h - 0.3, lvl, 1, 0, 0.4, 0.2, 3, cars[i % 5], 0.8);
      this.box(cx, y0 + 1.1, lvl, 1, 0, w - 0.4, 1.9, 22, 0xe9e1d1); // 本館
      this.box(cx, y0 + 1.1, lvl, 1, 0, w - 0.3, 2.0, 2, 0x8d8f96, 22);
      this.box(cx, y0 + 2.05, lvl, 1, 0, w - 0.5, 0.06, 6, sel || 0xd9514e, 14); // 看板の帯
      this.box(cx, y0 + 2.08, lvl, 1, 0, 1.4, 0.06, 10, 0x7fb7e6, 1); // 入口のガラス
    } else if (f.type === 'department') {
      this.box(cx, cy, lvl, 1, 0, w, h, 0.8, 0xbdb7ab); // 敷地
      this.box(cx, cy, lvl, 1, 0, w - 0.3, h - 0.3, 12, 0xe8dcc6); // 低層部(売り場)
      this.box(cx, cy, lvl, 1, 0, w - 0.2, h - 0.2, 2, 0x8d8f96, 12);
      this.box(cx, cy, lvl, 1, 0, w - 1.1, h - 1.1, 22, 0xd5c3a5, 14); // 上層
      for (const z of [18, 24, 30]) this.box(cx, cy, lvl, 1, 0, w - 1.05, h - 1.05, 2.2, 0x6a8fb5, z);
      this.box(cx, cy, lvl, 1, 0, w - 1.0, h - 1.0, 2, sel || 0xc0392b, 36); // 屋上の帯
      this.box(cx, y0 + h - 0.2, lvl, 1, 0, w - 0.8, 0.3, 3, sel || 0xc0392b, 9); // 入口のひさし
      this.box(cx, y0 + h - 0.17, lvl, 1, 0, 1.2, 0.06, 8, 0x7fb7e6, 0.8); // 入口のガラス
    } else if (f.type === 'hotel') {
      this.box(cx, cy, lvl, 1, 0, w, h, 0.8, 0x72c05c); // 庭
      this.box(cx, cy, lvl, 1, 0, w - 0.9, h - 0.9, 40, 0xcfd8e6); // 客室棟
      for (const z of [6, 12, 18, 24, 30]) this.box(cx, cy, lvl, 1, 0, w - 0.85, h - 0.85, 2.6, 0x3b5f86, z);
      this.box(cx, cy, lvl, 1, 0, w - 0.8, h - 0.8, 3, sel || 0x8e44ad, 40);
      this.box(cx, y0 + h - 0.3, lvl, 1, 0, 1.4, 0.4, 3, sel || 0x8e44ad, 8); // 車寄せ
    } else {
      this.box(cx, cy, lvl, 1, 0, w, h, 0.8, 0x72c05c); // 芝生
      this.box(cx, cy, lvl, 1, 0, w, 0.35, 1, 0xdcd2b8, 0.8); // 園路
      const [px, py] = P(x0 + w - 0.9, y0 + h - 0.9, 0);
      g.ellipse(px, py, 20, 10).fill(0x6cb6e3);
      g.ellipse(px, py, 20, 10).stroke({ width: 1.5, color: 0xdcd2b8 });
      for (const [u, v] of [[x0 + 0.5, y0 + 0.5], [x0 + 1.5, y0 + 0.4], [x0 + 0.5, y0 + 1.7], [x0 + w - 0.5, y0 + 0.6], [x0 + 1.8, y0 + h - 0.4]]) {
        const [tx, ty] = P(u, v, 0);
        this.box(u, v, lvl, 1, 0, 0.08, 0.08, 8, 0x7a5a3a);
        g.circle(tx, ty - 13, 9).fill(0x3f9a58);
        g.circle(tx - 3, ty - 16, 5).fill(0x58b36e);
      }
    }
  }

  /** 経由点: 線路脇の小さな標識(通過するだけの目印) */
  private drawWaypoint(x: number, y: number, lvl: number, col: number): void {
    this.box(x + 0.84, y + 0.16, lvl, 1, 0, 0.05, 0.05, 14, 0x3a3d44);
    this.box(x + 0.84, y + 0.16, lvl, 1, 0, 0.22, 0.22, 4, col === 0xff9a2f ? col : 0x6f8aa6, 14);
  }

  /**
   * 駅(ホーム群)。番線ごとに線路があり、番線の間は島式ホーム、両外側は側面ホーム。
   * デザイン(0..99)= 屋根5種 × 配色5種 × 駅舎4種(world/stations.ts の designParts)
   */
  private drawStation(s: import('../sim/transit').Stop, lvl: number, selected: boolean): void {
    const m = this.map;
    let info = s.station;
    if (!info) {
      const alongX = !!(m.rail.get(s.idx) & (CONN(1) | CONN(3)));
      info = { axis: alongX ? 1 : 0, len: 1, tracks: 1, design: 6, x0: s.x, y0: s.y };
    }
    const { axis, len, tracks, x0, y0 } = info;
    const { roof, palette, building } = designParts(info.design);
    const col = selected ? 0xff9a2f : palette.roof;
    const ax = axis === 1 ? 1 : 0;
    const ay = axis === 1 ? 0 : 1;
    // 長軸方向の位置 i(0..len), 幅方向の位置 w(0..tracks; 番線 t の中心は t+0.5) → タイル座標
    const U = (i: number, w: number) => (axis === 1 ? x0 + i : x0 + w);
    const V = (i: number, w: number) => (axis === 1 ? y0 + w : y0 + i);
    const slabH = roof === 0 ? 3 : 5;
    // 屋根を支える位置(外側ホームは番線中心から 0.34、島式は番線の間)
    const platW = (w: number) => (w === 0 ? 0.16 : w === tracks ? tracks - 0.16 : w);
    for (let w = 0; w <= tracks; w++) {
      const outer = w === 0 || w === tracks;
      for (let i = 0; i < len; i++) {
        this.box(U(i + 0.5, platW(w)), V(i + 0.5, platW(w)), lvl, ax, ay, 1, outer ? 0.16 : 0.5, slabH, palette.slab);
        if (roof !== 0) {
          // 線路側の縁(黄色い線)
          const es = outer ? [w === 0 ? 0.23 : tracks - 0.23] : [w - 0.2, w + 0.2];
          for (const e of es) this.box(U(i + 0.5, e), V(i + 0.5, e), lvl, ax, ay, 1, 0.025, slabH + 0.4, 0xe9c33a);
        }
      }
    }
    // ホームで待つ人: 待ち人数に応じて増減(黄金比で長さ方向に散らす)
    if (this.shownDt >= 0 && s.waiting >= 0) {
      const n = this.crowdShown(s, this.crowdTarget(s, Math.max(6, len * (tracks + 1) * 3), 6), this.shownDt);
      for (let i = 0; i < n; i++) {
        const w = i % (tracks + 1);
        const along = ((i * 0.6180339887) % 1) * Math.max(0.3, len - 0.4) + 0.2;
        const jitter = (((i * 7919 + s.id * 31) % 11) - 5) * 0.009;
        this.person(U(along, platW(w) + jitter), V(along, platW(w) + jitter), lvl, slabH, i, s.id);
      }
    }
    // ここから屋根・駅舎: 車両より上の層に描く
    const gfxBefore = this.gfx;
    this.gfx = this.roofG;
    const mid = len / 2;
    const pillar = (i: number, w: number, h: number) => this.box(U(i, platW(w)), V(i, platW(w)), lvl, ax, ay, 0.05, 0.05, h, palette.post, slabH);
    if (roof === 0) {
      // 屋根なし: 外側ホームに小さな屋根つき待合
      this.box(U(mid, 0.16), V(mid, 0.16), lvl, ax, ay, 0.7, 0.16, 3, 0x8b6f4e, slabH + 8);
      this.box(U(mid, 0.16), V(mid, 0.16), lvl, ax, ay, 0.7, 0.2, 1.2, col, slabH + 11);
    } else if (roof === 1 || roof === 2) {
      // 部分屋根(中央60%)/ 全長屋根: 各ホームに庇と支柱
      const from = roof === 1 ? Math.max(0, Math.floor(len * 0.2)) : 0;
      const to = roof === 1 ? Math.max(from + 1, Math.ceil(len * 0.8)) : len;
      for (let w = 0; w <= tracks; w++) {
        const outer = w === 0 || w === tracks;
        for (let i = from; i < to; i++) if ((i - from) % 3 === 0) pillar(i + 0.5, w, 15);
        this.box(U((from + to) / 2, platW(w)), V((from + to) / 2, platW(w)), lvl, ax, ay, to - from, outer ? 0.3 : 0.62, 1.6, col, slabH + 15);
        if (roof === 2) this.box(U((from + to) / 2, platW(w)), V((from + to) / 2, platW(w)), lvl, ax, ay, to - from, outer ? 0.34 : 0.66, 0.8, palette.post, slabH + 14.2);
      }
    } else if (roof === 3) {
      // ガラス大屋根: 全体を覆う半透明の屋根と梁
      for (let i = 0; i <= len; i += 3) for (let w = 0; w <= tracks; w++) pillar(Math.min(i + 0.5, len - 0.5), w, 20);
      this.box(U(mid, tracks / 2), V(mid, tracks / 2), lvl, ax, ay, len, tracks + 0.1, 2, 0x9ccbe6, slabH + 20, 0.5);
      this.box(U(mid, tracks / 2), V(mid, tracks / 2), lvl, ax, ay, len, 0.12, 3, col, slabH + 22);
    } else {
      // アーチ屋根: 段を重ねた丸みのある屋根が全体を覆う
      for (let i = 0; i <= len; i += 4) for (const w of [0, tracks]) pillar(Math.min(i + 0.5, len - 0.5), w, 17);
      const W = tracks + 0.1;
      this.box(U(mid, tracks / 2), V(mid, tracks / 2), lvl, ax, ay, len, W, 1.6, col, slabH + 17, 0.72);
      this.box(U(mid, tracks / 2), V(mid, tracks / 2), lvl, ax, ay, len, W * 0.75, 1.6, shade(col, 1.08), slabH + 18.6, 0.72);
      this.box(U(mid, tracks / 2), V(mid, tracks / 2), lvl, ax, ay, len, W * 0.45, 1.6, shade(col, 1.16), slabH + 20.2, 0.72);
    }
    // 駅舎(ホームの外側。端に寄せる)
    if (building > 0) {
      const bl = building === 1 ? 0.5 : building === 2 ? Math.min(2, len) : Math.min(3.2, len);
      const bw = building === 1 ? 0.22 : building === 2 ? 0.28 : 0.38;
      const bh = building === 1 ? 9 : building === 2 ? 12 : 16;
      const bi = bl / 2 + 0.05;
      this.box(U(bi, -0.15), V(bi, -0.15), lvl, ax, ay, bl, bw, bh, palette.wall, 0);
      this.box(U(bi, -0.15), V(bi, -0.15), lvl, ax, ay, bl + 0.1, bw + 0.05, 2, palette.bldRoof, bh);
      if (building === 3) this.box(U(bi, -0.15), V(bi, -0.15), lvl, ax, ay, 0.16, 0.16, 8, shade(palette.wall, 0.9), bh + 2); // 時計塔
    }
    this.gfx = gfxBefore;
  }

  draw(view: View, highlight: Set<number>): void {
    this.air.clear();
    this.shad.clear();
    setVehicleSmoothing(view.zoom);
    if (view.zoom < 0.12) {
      this.infra.clear();
      this.roofG.clear();
      this.infraView = null;
      this.hideSprites(0);
      this.hideFront(0);
      this.staticFront = [];
      this.vehTiles.length = 0;
      return;
    }
    // 静的な部分は、視点が描画済み範囲から出た・構造が変わった・選択が変わった・0.25秒経過のときだけ描き直す
    const now = performance.now();
    const key = [...highlight].join(',');
    const iv = this.infraView;
    const inside = iv && view.zoom === iv.zoom && view.left >= iv.left && view.right <= iv.right && view.top >= iv.top && view.bottom <= iv.bottom;
    if (!inside || now - this.infraAt > 250 || this.infraVer !== this.transit.version || key !== this.infraKey) {
      const w = view.right - view.left;
      const h = view.bottom - view.top;
      const wide: View = { left: view.left - w * 0.5, right: view.right + w * 0.5, top: view.top - h * 0.5, bottom: view.bottom + h * 0.5, zoom: view.zoom };
      this.shownDt = Math.min(1, (now - this.shownAt) / 1000);
      this.shownAt = now;
      this.infra.clear();
      this.roofG.clear();
      this.gfx = this.infra;
      this.drawInfra(wide, highlight);
      this.drawFront(wide);
      this.infraView = wide;
      this.infraAt = now;
      this.infraVer = this.transit.version;
      this.infraKey = key;
    }
    this.drawVehicles(view);
    this.renderFront();
  }

  private drawInfra(view: View, highlight: Set<number>): void {
    const m = this.map;
    const margin = 160;
    const inView = (wx: number, wy: number) => wx > view.left - margin && wx < view.right + margin && wy > view.top - margin * 2 && wy < view.bottom + margin;
    for (const s of this.transit.stops.values()) {
      const wx = this.wx(s.x + 0.5, s.y + 0.5);
      const wy = this.wy(s.x + 0.5, s.y + 0.5, 0);
      if (!inView(wx, wy)) continue;
      const lvl = m.surfaceLevel(s.x, s.y);
      if (s.waiting >= 1) {
        // 待ち人数バー: 緑→黄→赤
        const r = Math.min(1, s.waiting / (WAIT_CAP[s.kind] * 0.5));
        this.box(s.x + 0.14, s.y + 0.86, lvl, 1, 0, 0.1, 0.1, 4 + r * 34, r < 0.34 ? 0x4bd36a : r < 0.67 ? 0xf2c230 : 0xe5483a);
      }
      const sel = highlight.has(s.id);
      const col = sel ? 0xff9a2f : 0x2f7dd1;
      if (s.kind === 'road') {
        this.box(s.x + 0.86, s.y + 0.14, lvl, 1, 0, 0.12, 0.12, 22, col);
        this.box(s.x + 0.86, s.y + 0.14, lvl, 1, 0, 0.3, 0.3, 4, 0xffffff);
        // バス停で待つ人(歩道に並ぶ)
        const n = this.crowdShown(s, this.crowdTarget(s, 10, 4), this.shownDt);
        for (let i = 0; i < n; i++) this.person(s.x + 0.52 + (i % 5) * 0.085, s.y + 0.08 + Math.floor(i / 5) * 0.1, lvl, 0, i, s.id);
      } else if (s.kind === 'rail') {
        if (s.waypoint) this.drawWaypoint(s.x, s.y, lvl, col);
        else this.drawStation(s, lvl, sel);
      } else {
        this.box(s.x + 0.5, s.y + 0.5, lvl, 1, 0, 0.1, 0.1, 40, col, 24);
        // 空港ターミナルの前で待つ人
        const n = this.crowdShown(s, this.crowdTarget(s, 14, 12), this.shownDt);
        for (let i = 0; i < n; i++) this.person(s.x + 0.12 + (i % 7) * 0.11, s.y + 0.86 + Math.floor(i / 7) * 0.08, lvl, 0, i, s.id);
      }
    }

    // 大型施設
    // 奥のものから順に描く(手前の施設の広場・庭が、奥の施設の建物の上に重ならないように。前の角の x+y が小さい順)
    const visFacs: Facility[] = [];
    for (const f of m.facilities) {
      if (isSpriteFacility(f)) continue; // スプライト(チャンク側)で描く
      const cx = f.x0 + f.w / 2;
      const cy = f.y0 + f.h / 2;
      if (!inView(this.wx(cx, cy), this.wy(cx, cy, 0))) continue;
      visFacs.push(f);
    }
    visFacs.sort((a, b) => a.x0 + a.w + a.y0 + a.h - (b.x0 + b.w + b.y0 + b.h));
    for (const f of visFacs) this.drawFacility(f, m.levelAt(f.x0, f.y0), highlight.has(-100000 - f.id));

    // 車両基地: 道路/線路/空港のタイルの脇に車庫を描く
    for (const d of this.transit.depots.values()) {
      if (!inView(this.wx(d.x + 0.5, d.y + 0.5), this.wy(d.x + 0.5, d.y + 0.5, 0))) continue;
      const lvl = m.surfaceLevel(d.x, d.y);
      const sel = highlight.has(-d.id);
      const roof = sel ? 0xff9a2f : d.kind === 'rail' ? 0x5d7a99 : d.kind === 'air' ? 0x8896a6 : 0x6a8a6a;
      // 長軸: 道路/線路の向き(東西なら u 方向、南北なら v 方向)
      const bits = d.kind === 'road' ? m.road.get(d.idx) : m.rail.get(d.idx);
      const alongX = d.kind === 'air' ? true : !!(bits & (CONN(1) | CONN(3))) && !(bits & (CONN(0) | CONN(2)));
      const ax = alongX ? 1 : 0;
      const ay = alongX ? 0 : 1;
      const len = d.kind === 'rail' ? 1.0 : d.kind === 'air' ? 0.8 : 0.6;
      const off = d.kind === 'air' ? 0 : 0.34;
      const cu = d.x + 0.5 + (alongX ? 0 : off);
      const cv = d.y + 0.5 + (alongX ? off : 0);
      this.box(cu, cv, lvl, ax, ay, len, 0.34, d.kind === 'air' ? 14 : 11, 0xd6cfc0);
      this.box(cu, cv, lvl, ax, ay, len + 0.08, 0.4, 3, roof, d.kind === 'air' ? 14 : 11);
      // 入口(線路側の扉)
      this.box(cu - (alongX ? 0 : 0.17 * (off > 0 ? 1 : -1)) * 0, cv, lvl, ax, ay, Math.min(0.4, len * 0.5), 0.02, 7, 0x3a3d44, 0);
    }

    // 信号: 進行方向の左側(左側通行)に支柱と灯。進入先の閉塞が使用中なら赤
    if (this.transit.signals.size && view.zoom >= 0.3) {
      for (const idx of [...this.transit.signals.keys()]) {
        const mask = this.transit.signalMask(idx);
        if (!mask) continue;
        const sx0 = idx % m.size;
        const sy0 = Math.floor(idx / m.size);
        if (!inView(this.wx(sx0 + 0.5, sy0 + 0.5), this.wy(sx0 + 0.5, sy0 + 0.5, 0))) continue;
        const lvl = m.surfaceLevel(sx0, sy0);
        const red = this.transit.signalIsRed(idx);
        for (let d = 0; d < 8; d++) {
          if (!(mask & (1 << d))) continue;
          // 進行方向(斜めは単位ベクトル): 手前側の左に支柱を立てる
          const k = d < 4 ? 1 : Math.SQRT1_2;
          const fx = DX8[d] * k;
          const fy = DY8[d] * k;
          const cu = sx0 + 0.5 - fx * 0.38 + fy * 0.3;
          const cv = sy0 + 0.5 - fy * 0.38 - fx * 0.3;
          this.box(cu, cv, lvl, 1, 0, 0.05, 0.05, 15, 0x3a3d44);
          this.box(cu, cv, lvl, 1, 0, 0.09, 0.09, 4, red ? 0xff3b30 : 0x35d36a, 15);
        }
      }
    }

  }

  /** 駅・車両基地・大型施設の手前にある建物(タイルindex)。構造が変わったときだけ計算し直す */
  private staticFront: number[] = [];
  /** 今のフレームで車両を描いたタイル(重複あり) */
  private vehTiles: number[] = [];
  /** タイルごとの「手前にある建物」の一覧(車両用。数秒ごとに作り直す) */
  private nearCache = new Map<number, number[]>();
  private nearCacheAt = 0;

  /**
   * 駅・車両基地・大型施設・車両は、街の建物とは別の層で描くため、そのままだと手前の建物にも常に上から被さる。
   * これらの手前(x+y が大きい側)にある建物だけを、上に描き直して前後を正しくする。
   * ここでは駅・基地・施設の分を求める(車両の分は毎フレーム renderFront で足す)。
   */
  private drawFront(view: View): void {
    const m = this.map;
    const inView = (wx: number, wy: number) => wx > view.left - 160 && wx < view.right + 160 && wy > view.top - 320 && wy < view.bottom + 160;
    const out = new Set<number>();
    const R = 7; // 建物の高さぶん、手前〜周囲の何タイルまで調べるか
    const scan = (tiles: [number, number][]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of tiles) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      if (!inView((x0 - y0) * 32, (x0 + y0) * 16)) return;
      for (let ty = Math.max(0, y0 - 2); ty <= Math.min(m.size - 1, y1 + R); ty++) {
        for (let tx = Math.max(0, x0 - 2); tx <= Math.min(m.size - 1, x1 + R); tx++) {
          const b = m.building.get(m.idx(tx, ty));
          if (!b || b === FACILITY_TILE) continue;
          // 最も近いタイルより手前(x+y が大きい)にある建物だけ
          let best = Infinity;
          let bsum = 0;
          for (const [x, y] of tiles) {
            const d = Math.abs(tx - x) + Math.abs(ty - y);
            if (d < best) { best = d; bsum = x + y; }
          }
          if (tx + ty > bsum) out.add(m.idx(tx, ty));
        }
      }
    };
    for (const s of this.transit.stops.values()) {
      if (s.waypoint || s.kind !== 'rail') continue;
      scan(s.station ? stationTiles(s.station) : [[s.x, s.y]]);
    }
    for (const d of this.transit.depots.values()) scan([[d.x, d.y]]);
    for (const f of m.facilities) {
      if (isSpriteFacility(f)) continue; // スプライトの施設は建物と同じ層
      const tiles: [number, number][] = [];
      for (let y = f.y0; y < f.y0 + f.h; y++) for (let x = f.x0; x < f.x0 + f.w; x++) tiles.push([x, y]);
      scan(tiles);
    }
    this.staticFront = [...out];
  }

  /** 車両のいるタイルの手前にある建物(車両を建物の陰に隠す) */
  private nearFront(tx: number, ty: number): number[] {
    const m = this.map;
    const key = ty * m.size + tx;
    let l = this.nearCache.get(key);
    if (l) return l;
    l = [];
    for (let y = Math.max(0, ty - 1); y <= Math.min(m.size - 1, ty + 7); y++) {
      for (let x = Math.max(0, tx - 1); x <= Math.min(m.size - 1, tx + 7); x++) {
        if (x + y <= tx + ty) continue;
        const b = m.building.get(m.idx(x, y));
        if (b && b !== FACILITY_TILE) l.push(m.idx(x, y));
      }
    }
    this.nearCache.set(key, l);
    return l;
  }

  /** 前面に描き直す建物のスプライトを更新する(毎フレーム) */
  private renderFront(): void {
    const m = this.map;
    const now = performance.now();
    if (now - this.nearCacheAt > 3000 || this.nearCache.size > 20000) {
      this.nearCache.clear();
      this.nearCacheAt = now;
    }
    const want = new Set<number>(this.staticFront);
    const doneTiles = new Set<number>();
    for (let i = 0; i < this.vehTiles.length; i += 2) {
      const tx = this.vehTiles[i];
      const ty = this.vehTiles[i + 1];
      if (!m.inBounds(tx, ty)) continue;
      const k = ty * m.size + tx;
      if (doneTiles.has(k)) continue;
      doneTiles.add(k);
      for (const b of this.nearFront(tx, ty)) want.add(b);
    }
    this.vehTiles.length = 0;
    this.front.sortableChildren = true;
    let n = 0;
    for (const k of want) {
      if (n >= 3000) break;
      const tx = k % m.size;
      const ty = Math.floor(k / m.size);
      const b = m.building.get(k);
      if (!b) continue;
      const r = buildingSpriteRect(b, hash2(tx, ty, m.seed + 17));
      if (!r) continue;
      const lvl = m.levelAt(tx, ty);
      const px = (tx - ty) * 32;
      const py = (tx + ty) * 16 - lvl * LEVEL_PX;
      const cy = r.level === 3 ? py : py + 16;
      const fk = `${r.img.src}|${r.sx}|${r.sy}`;
      let tex = this.frameTex.get(fk);
      if (!tex) {
        tex = new Texture({ source: Texture.from(r.img).source, frame: new Rectangle(r.sx, r.sy, SPRITE_W, SPRITE_H) });
        this.frameTex.set(fk, tex);
      }
      let sp = this.frontSprites[n];
      if (!sp) {
        sp = new Sprite();
        this.front.addChild(sp);
        this.frontSprites.push(sp);
      }
      n++;
      sp.visible = true;
      sp.texture = tex;
      sp.position.set(Math.round(px - 64), Math.round(cy - 150));
      sp.zIndex = tx + ty;
    }
    this.hideFront(n);
  }

  private hideFront(from: number): void {
    for (let i = from; i < this.frontSprites.length; i++) this.frontSprites[i].visible = false;
  }

  private hideSprites(from: number): void {
    for (let i = from; i < this.sprites.length; i++) this.sprites[i].visible = false;
  }

  /** 車両のスプライトを1つ取り出す(足りなければ作る) */
  private nextSprite(): Sprite {
    let sp = this.sprites[this.spritesUsed];
    if (!sp) {
      sp = new Sprite();
      this.veh.addChild(sp);
      this.sprites.push(sp);
    }
    this.spritesUsed++;
    sp.visible = true;
    return sp;
  }

  /** 型・色・向きごとのテクスチャ(初回だけ描いて作る) */
  private texFor(key: string, draw: () => void): { tex: Texture; ax: number; ay: number } | null {
    let e = this.texCache.get(key);
    if (e) return e;
    if (!this.renderer) return null;
    if (this.texCache.size > 1500) {
      for (const t of this.texCache.values()) t.tex.destroy(true);
      this.texCache.clear();
    }
    const tmp = new Graphics();
    const prev = this.gfx;
    this.gfx = tmp;
    draw();
    this.gfx = prev;
    const b = tmp.getLocalBounds();
    const tex = this.renderer.generateTexture({ target: tmp, resolution: 2 });
    e = { tex, ax: -b.x / Math.max(1, b.width), ay: -b.y / Math.max(1, b.height) };
    tmp.destroy();
    this.texCache.set(key, e);
    return e;
  }

  /** (u,v,lvl) の位置にスプライトを置く。奥行きは u+v で並べる */
  private put(key: string, draw: () => void, u: number, v: number, lvl: number, zBias = 0, lift = 0): void {
    const e = this.texFor(key, draw);
    if (!e) return;
    this.putTex(e, u, v, lvl, zBias, lift);
  }

  /** 作成済みのテクスチャ(車両スプライトなど)を (u,v,lvl) に置く。lift は地面からの高さ(px) */
  private putTex(e: { tex: Texture; ax: number; ay: number }, u: number, v: number, lvl: number, zBias = 0, lift = 0, scale = 1): void {
    this.vehTiles.push(Math.floor(u), Math.floor(v));
    const sp = this.nextSprite();
    sp.texture = e.tex;
    sp.anchor.set(e.ax, e.ay);
    sp.scale.set(scale);
    sp.position.set(this.wx(u, v), this.wy(u, v, lvl) - lift);
    sp.zIndex = (u + v) * 64 + zBias;
  }

  private drawVehicles(view: View): void {
    const m = this.map;
    const margin = 160;
    const inView = (wx: number, wy: number) => wx > view.left - margin && wx < view.right + margin && wy > view.top - margin * 2 && wy < view.bottom + margin;
    this.spritesUsed = 0;
    this.gfx = this.air;
    for (const v of this.transit.vehicles) {
      const route = this.transit.routes.get(v.routeId);
      if (!route) continue;
      if (v.mode === 'road') this.drawBus(v, m, inView);
      else if (v.mode === 'rail') this.drawTrain(v, m, inView);
      else this.drawPlane(v, m, inView);
    }
    this.gfx = this.infra;
    this.hideSprites(this.spritesUsed);
  }

  /** バス1台を (cu,cv,lvl) に描く(テクスチャ作成用は原点)。(dx,dy)=進行方向の単位ベクトル */
  private drawBusAt(cu: number, cv: number, lvl: number, dx: number, dy: number, color: number): void {
    const L = 0.5;
    const Wd = 0.25;
    this.shadow(cu, cv, lvl, dx, dy, L, Wd);
    this.wheels(cu, cv, lvl, dx, dy, L, Wd);
    this.box(cu, cv, lvl, dx, dy, L, Wd, 6, color, 2.5); // 車体下部
    this.box(cu, cv, lvl, dx, dy, L - 0.02, Wd + 0.004, 2, 0xffffff, 6); // 帯
    this.box(cu, cv, lvl, dx, dy, L - 0.05, Wd - 0.006, 4.5, 0xbfe3ff, 8.5); // 窓
    this.box(cu, cv, lvl, dx, dy, L - 0.01, Wd, 1.6, shade(color, 1.18), 13); // 屋根
    // 前面ガラスとライト
    const fx = cu + dx * (L / 2 - 0.01);
    const fy = cv + dy * (L / 2 - 0.01);
    this.box(fx, fy, lvl, dx, dy, 0.03, Wd - 0.04, 5, 0x35506e, 8.5);
    for (const sd of [-0.5, 0.5]) this.box(fx - dy * Wd * sd * 0.8, fy + dx * Wd * sd * 0.8, lvl, dx, dy, 0.03, 0.04, 2, 0xfff3b0, 3.5);
  }

  /** 停滞中の目印(赤い小箱) */
  private putStuck(u: number, v: number, lvl: number, lift = 0): void {
    this.put('stuck', () => this.box(0, 0, 0, 1, 0, 0.14, 0.14, 6, 0xff3030, 13), u, v, lvl, 3, lift);
  }

  private drawBus(v: import('../sim/transit').Vehicle, m: GameMap, inView: (x: number, y: number) => boolean): void {
    const p = this.transit.position(v);
    if (!inView(this.wx(p.x + 0.5, p.y + 0.5), this.wy(p.x + 0.5, p.y + 0.5, 0))) return;
    const bx = Math.round(p.x);
    const by = Math.round(p.y);
    if (m.inBounds(bx, by) && m.span.get(m.idx(bx, by)) & 32) return; // トンネル内は見えない
    const lvl = m.smoothLevel(bx, by, p.x - bx + 0.5, p.y - by + 0.5);
    const route = this.transit.routes.get(v.routeId)!;
    // 左側通行: 進行方向の左に寄せる
    const off = 0.2;
    const cu = p.x + 0.5 + p.dy * off;
    const cv = p.y + 0.5 - p.dx * off;
    const di = dirIndex(p.dx, p.dy);
    const fr = vehicleFrame('bus', modelOf(v.modelId).sprite ?? 0, di);
    if (fr) {
      // 影 → 車体(スプライト) → 路線の色の目印(小さな点)
      this.put(`sh|bus|${di}`, () => this.shadow(0, 0, 0, DIRS[di][0], DIRS[di][1], BUS_SCALE * 1.05, BUS_SCALE * 0.3), cu, cv, lvl, -2);
      this.putTex(fr, cu, cv, lvl, 0, 0, BUS_SCALE);
      this.put(`pip|${route.color}`, () => this.box(0, 0, 0, 1, 0, 0.07, 0.07, 2.5, route.color, 9.5), cu, cv, lvl, 2);
    } else this.put(`b|${route.color}|${di}`, () => this.drawBusAt(0, 0, 0, DIRS[di][0], DIRS[di][1], route.color), cu, cv, lvl);
    if (v.stuck > 20) this.putStuck(cu, cv, lvl, fr ? 6 : 0); // スプライトのバスは屋根より上に出す
  }

  /** 折れ線上の頭からの距離 s の点と向き */
  private pointAt(pts: [number, number][], s: number): { x: number; y: number; dx: number; dy: number } {
    let rem = s;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len === 0) continue;
      if (rem <= len) return { x: x0 + ((x1 - x0) * rem) / len, y: y0 + ((y1 - y0) * rem) / len, dx: (x0 - x1) / len, dy: (y0 - y1) / len };
      rem -= len;
    }
    const n = pts.length;
    const [x, y] = pts[n - 1];
    const [px, py] = n > 1 ? pts[n - 2] : [x + 1, y];
    const l = Math.hypot(px - x, py - y) || 1;
    return { x, y, dx: (px - x) / l, dy: (py - y) / l };
  }

  /** 1両を (cu,cv,lvl) に描く。role: 1=先頭(前面ガラス+白ライト) 2=最後尾(赤尾灯) 4=パンタグラフ。(dx,dy)=先頭側の単位ベクトル */
  private drawCarAt(cu: number, cv: number, lvl: number, dx: number, dy: number, model: import('../data/models').VehicleModel, role: number): void {
    const L = CAR_LEN - 0.03;
    const Wd = 0.23;
    this.shadow(cu, cv, lvl, dx, dy, L, Wd);
    this.box(cu, cv, lvl, dx, dy, L - 0.06, Wd - 0.04, 1.6, 0x303236, 1); // 床下
    this.box(cu, cv, lvl, dx, dy, L, Wd, 4, model.stripe ?? 0x2f7dd1, 2.6); // 帯色の裾
    this.box(cu, cv, lvl, dx, dy, L, Wd, 6.5, model.body, 6.4); // 車体
    this.box(cu, cv, lvl, dx, dy, L - 0.05, Wd + 0.004, 3.2, 0x7fa8cf, 7.6); // 窓帯
    this.box(cu, cv, lvl, dx, dy, L - 0.04, Wd - 0.03, 1.4, shade(model.body, 0.82), 12.8); // 屋根
    if (role & 4) this.box(cu, cv, lvl, dx, dy, 0.1, 0.1, 3, 0x55585e, 14); // パンタグラフ
    // 運転台: 先頭車は進行方向の端、最後尾車は後ろの端。単行(1両)は前後の両端に付ける
    for (const front of [true, false]) {
      if (!(role & (front ? 1 : 2))) continue;
      const end = front ? 1 : -1;
      const ex = cu + dx * end * (L / 2 - 0.01);
      const ey = cv + dy * end * (L / 2 - 0.01);
      this.box(ex, ey, lvl, dx, dy, 0.035, Wd - 0.05, 6, 0x2c3e55, 7);
      const light = front ? 0xfff3b0 : 0xff4a4a;
      for (const sd of [-0.5, 0.5]) this.box(ex - dy * Wd * sd * 0.8, ey + dx * Wd * sd * 0.8, lvl, dx, dy, 0.035, 0.04, 2.2, light, 3.4);
    }
  }

  private drawTrain(v: import('../sim/transit').Vehicle, m: GameMap, inView: (x: number, y: number) => boolean): void {
    const model = modelOf(v.modelId);
    const pts = this.transit.trainPoints(v);
    if (!pts.length) return;
    if (!inView(this.wx(pts[0][0] + 0.5, pts[0][1] + 0.5), this.wy(pts[0][0] + 0.5, pts[0][1] + 0.5, 0))) return;
    const cars = v.cars ?? model.defaultCars;
    const centers: [number, number][] = pts.map(([x, y]) => [x + 0.5, y + 0.5]);
    for (let k = 0; k < cars; k++) {
      const p = this.pointAt(centers, (k + 0.5) * CAR_LEN);
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.y);
      if (m.inBounds(tx, ty) && m.span.get(m.idx(tx, ty)) & 32) continue; // トンネル内
      if (!inView(this.wx(p.x, p.y), this.wy(p.x, p.y, 0))) continue;
      const lvl = m.smoothLevel(tx, ty, p.x - tx, p.y - ty);
      const role = (k === 0 ? 1 : 0) | (k === cars - 1 ? 2 : 0) | (k % 3 === 1 ? 4 : 0);
      const di = dirIndex(p.dx, p.dy);
      // スプライト: 先頭車は進行方向、最後尾は先頭車を反対向きで、間は中間車
      const isHead = k === 0;
      const isRear = k === cars - 1 && cars > 1;
      const fr = model.sprite !== undefined ? trainFrame(model.sprite, isHead || isRear, isRear ? (di + 4) & 7 : di) : null;
      if (fr) {
        this.put(`sh|car|${di}`, () => this.shadow(0, 0, 0, DIRS[di][0], DIRS[di][1], CAR_LEN * 1.05, 0.2), p.x, p.y, lvl, -2);
        this.putTex(fr, p.x, p.y, lvl, 0, 0, fr.sc);
      } else this.put(`c|${model.id}|${role}|${di}`, () => this.drawCarAt(0, 0, 0, DIRS[di][0], DIRS[di][1], model, role), p.x, p.y, lvl);
    }
    if (v.stuck > 20) {
      const h = centers[0];
      this.putStuck(h[0], h[1], m.surfaceLevel(Math.floor(h[0]), Math.floor(h[1])));
    }
  }

  private drawPlane(v: import('../sim/transit').Vehicle, m: GameMap, inView: (x: number, y: number) => boolean): void {
    const model = modelOf(v.modelId);
    const p = this.transit.planePos(v);
    const lvl = m.levelAt(Math.floor(p.x), Math.floor(p.y));
    const wx = this.wx(p.x, p.y);
    const wy = this.wy(p.x, p.y, lvl);
    if (!inView(wx, wy - p.alt * AIR_ALT)) return;
    const g = this.air;
    const di = dirIndex(p.dx, p.dy);
    const fr = vehicleFrame('air', model.sprite ?? 0, di);
    // 地面の影(高度が上がるほど薄く小さく)
    const sw = (10 + Math.sqrt(model.cap) * 0.9) * AIR_SCALE * (1 - p.alt * 0.25);
    this.shad.ellipse(wx, wy, sw, sw * 0.5).fill({ color: 0x000000, alpha: 0.28 - p.alt * 0.1 });
    if (fr) {
      this.putTex(fr, p.x, p.y, lvl, 1_000_000, p.alt * AIR_ALT, AIR_SCALE); // 他の乗り物より常に手前
      return;
    }
    // スプライトが読めなかったときの簡易な機体
    const sdx = (p.dx - p.dy) * 32;
    const sdy = (p.dx + p.dy) * 16;
    const sl = Math.hypot(sdx, sdy) || 1;
    const fx = sdx / sl;
    const fy = sdy / sl;
    const rx = -fy;
    const ry = fx;
    const size = model.cap > 250 ? 1.5 : model.cap > 100 ? 1.2 : 1;
    const cy = wy - p.alt * AIR_ALT - 4;
    const pt = (f: number, s: number) => [wx + fx * f * size + rx * s * size, cy + fy * f * size + ry * s * size];
    g.poly([...pt(16, 0), ...pt(4, 3), ...pt(-14, 2), ...pt(-16, 0), ...pt(-14, -2), ...pt(4, -3)]).fill(model.body);
    g.poly([...pt(4, 3), ...pt(-3, 18), ...pt(-8, 18), ...pt(-4, 0), ...pt(-8, -18), ...pt(-3, -18), ...pt(4, -3)]).fill(model.body);
  }
}
