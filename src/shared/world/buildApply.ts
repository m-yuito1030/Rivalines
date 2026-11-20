import type { GameMap } from './gameMap';
import { bulldoze, canConnect, connect, lineTiles, makeTwoWay } from './roads';
import { autoRailPath, canConnectRail, connectRail, railLineTiles } from './rails';
import { CONN, DX8, DY8 } from './directions';
import { PRICES, yen } from '../sim/economy/economy';
import { buildSpan, planSpan } from './spans';
import { MAX_TERRAFORM_AREA, lower, raise, setLevel } from './terraform';

export type DragTool = 'road' | 'oneway' | 'twoway' | 'bulldoze' | 'rail' | 'railauto' | 'raise' | 'lower' | 'level' | 'roadspan' | 'railspan';
export const DRAG_TOOLS: readonly string[] = ['road', 'oneway', 'twoway', 'bulldoze', 'rail', 'railauto', 'raise', 'lower', 'level', 'roadspan', 'railspan'];
export const RECT_TOOLS: readonly string[] = ['raise', 'lower', 'level'];
type Tile = { x: number; y: number };

/** 建設の入出力: 資金の確認・支払い、メッセージ、(マルチ)インフラの所有者 */
export interface BuildIO {
  afford: (cost: number) => boolean;
  pay: (cost: number) => boolean;
  msg: (m: string) => void;
  /** マルチプレイ: 敷設したタイルの所有者(会社)。撤去は自社(または無所有)のタイルだけ */
  owner?: number;
  /** 線路・道路を変更したタイルを知らせる(経路の探し直しの対象を絞るため) */
  touched?: (x: number, y: number) => void;
}

/** 矩形ドラッグ範囲(上限あり) */
export function dragRect(a: Tile, b: Tile): Tile[] {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.min(Math.max(a.x, b.x), x0 + MAX_TERRAFORM_AREA - 1);
  const y1 = Math.min(Math.max(a.y, b.y), y0 + MAX_TERRAFORM_AREA - 1);
  const out: Tile[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

const claim = (map: GameMap, x: number, y: number, owner: number | undefined) => {
  if (!owner || !map.inBounds(x, y)) return;
  const i = map.idx(x, y);
  if (!map.infraOwner.get(i)) map.infraOwner.set(i, owner);
};

/** ドラッグ操作(道路・線路・撤去・整地・橋/トンネル)を実行する。ツールバーのドラッグと、サーバーのコマンドで共通 */
export function applyBuild(map: GameMap, tool: DragTool, a: Tile, b: Tile, io: BuildIO): void {
  if (!map.inBounds(a.x, a.y) || !map.inBounds(b.x, b.y)) return;
  if (RECT_TOOLS.includes(tool)) {
    const target = map.levelAt(a.x, a.y);
    for (const t of dragRect(a, b)) {
      if (!io.afford(PRICES.terraform)) return void io.msg(`資金が足りません(整地は1タイル ${yen(PRICES.terraform)})`);
      const changed = tool === 'raise' ? raise(map, t.x, t.y) : tool === 'lower' ? lower(map, t.x, t.y) : setLevel(map, t.x, t.y, target);
      if (changed) io.pay(PRICES.terraform);
    }
    return;
  }
  if (tool === 'roadspan' || tool === 'railspan') {
    const mode = tool === 'roadspan' ? 'road' : 'rail';
    const pre = planSpan(map, a.x, a.y, b.x, b.y, mode);
    const cost = pre.ok ? (pre.tiles.length - 2) * (pre.kind === 'bridge' ? PRICES.bridge : PRICES.tunnel) * (mode === 'rail' ? 1.3 : 1) : 0;
    if (pre.ok && !io.afford(cost)) return void io.msg(`資金が足りません(${pre.kind === 'bridge' ? '橋' : 'トンネル'} ${yen(cost)})`);
    const plan = buildSpan(map, a.x, a.y, b.x, b.y, mode);
    if (plan.ok) {
      io.pay(cost);
      for (const k of plan.tiles) {
        claim(map, k % map.size, Math.floor(k / map.size), io.owner);
        io.touched?.(k % map.size, Math.floor(k / map.size));
      }
    }
    io.msg(plan.ok ? `${plan.kind === 'bridge' ? '橋を架けました' : 'トンネルを掘りました'}(${yen(cost)})` : `架設できません: ${plan.reason}`);
    return;
  }
  let tiles: { x: number; y: number; d: number }[];
  if (tool === 'railauto') {
    // 自動敷設: 始点から終点まで、既存の線路を優先し、高低差・建物・交差を避けて最短でつなぐ
    const path = autoRailPath(map, a, b);
    if (!path) return void io.msg('自動で敷設できる経路が見つかりません(水域・建物・高低差などで遮られています。橋・整地を使うか、途中に目印を置いてください)');
    tiles = path;
  } else tiles = tool === 'rail' || tool === 'bulldoze' ? railLineTiles(a.x, a.y, b.x, b.y) : lineTiles(a.x, a.y, b.x, b.y); // 撤去も斜めのドラッグは斜めの線に沿う
  if (tool === 'bulldoze') {
    for (const t of tiles) {
      const i = map.idx(t.x, t.y);
      const own = map.infraOwner.get(i);
      if (io.owner && own && own !== io.owner) continue; // 他社の施設は撤去できない
      bulldoze(map, t.x, t.y);
      io.touched?.(t.x, t.y);
      if (map.road.get(i) === 0 && map.rail.get(i) === 0) map.infraOwner.set(i, 0);
    }
    return;
  }
  let spent = 0;
  for (let i = 0; i < tiles.length - 1; i++) {
    const t = tiles[i];
    if (tool === 'twoway') {
      makeTwoWay(map, t.x, t.y, t.d);
      io.touched?.(t.x, t.y);
      continue;
    }
    // 新しく敷く辺だけ費用がかかる(既存の辺の上書きは無料)
    const isRail = tool === 'rail' || tool === 'railauto';
    if (!(isRail ? canConnectRail(map, t.x, t.y, t.d, true) : canConnect(map, t.x, t.y, t.d, true))) continue;
    const k = map.idx(t.x, t.y);
    const isNew = !((isRail ? map.rail.get(k) : map.road.get(k)) & CONN(t.d));
    const price = isRail ? PRICES.rail : PRICES.road;
    if (isNew && !io.afford(price)) {
      io.msg(`資金が足りません(1タイル ${yen(price)})。ここまでで ${yen(spent)}`);
      return;
    }
    if (isRail) connectRail(map, t.x, t.y, t.d, true);
    else connect(map, t.x, t.y, t.d, tool === 'oneway', true);
    io.touched?.(t.x, t.y);
    io.touched?.(t.x + DX8[t.d], t.y + DY8[t.d]);
    if (isNew) {
      io.pay(price);
      spent += price;
      claim(map, t.x, t.y, io.owner);
      claim(map, t.x + DX8[t.d], t.y + DY8[t.d], io.owner); // 斜めの線の終端のタイルも自社のものにする
    }
  }
  if (spent > 0) io.msg(`建設費 ${yen(spent)}`);
}
