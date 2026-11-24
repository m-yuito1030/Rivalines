import type { GameMap } from '../../shared/world/gameMap';
import type { Simulation } from '../../shared/sim/simulation';
import { Company } from '../../shared/sim/economy/economy';
import { CHUNK, CHUNK_SHIFT } from '../../shared/world/tileLayer';
import type { MyVeh, PlayerInfo, ServerMsg } from '../../shared/protocol';
import type { PactState } from '../../shared/sim/economy/pacts';
import type { AuctionState } from '../../shared/sim/economy/auctions';
import type { WeeklyState } from '../../shared/sim/economy/weekly';
import type { Route, Stop, Depot, Vehicle } from '../../shared/sim/network/transit';

/** サーバーから届いた世界を、描画・UI用の GameMap / Simulation に反映する(クライアントは世界を進めない) */
export class Mirror {
  players: PlayerInfo[] = [];
  /** 自社の車両の概要(一覧用) */
  myVehicles: MyVeh[] = [];
  online: string[] = [];
  /** 提携(乗り入れ契約)と申し込み */
  pacts: PactState = { pacts: [], proposals: [], nextId: 1 };
  /** 入札(競り)と独占権 */
  auctions: AuctionState = { lots: [], rights: [], nextId: 1 };
  /** 週間ランキング */
  weekly: WeeklyState = { week: 1, base: [] };
  /** 最初の構造・経営データが届いたか */
  ready = { struct: false, misc: false, towns: false };
  onFirst: (() => void) | null = null;

  constructor(
    private map: GameMap,
    private sim: Simulation,
  ) {}

  private setTile(rec: number[]): void {
    const m = this.map;
    const [i, road, rail, span, air, building, owner, infra, h, con] = rec;
    m.road.set(i, road);
    m.rail.set(i, rail);
    m.span.set(i, span);
    m.air.set(i, air);
    m.building.set(i, building);
    m.owner.set(i, owner);
    m.infraOwner.set(i, infra);
    m.construction.set(i, con ?? 0);
    if (con && building) m.sites.set(i, 0);
    else m.sites.delete(i);
    if (h !== undefined && h >= 0) m.restoreEdit(i, h);
    const x = i % m.size;
    m.touch(x, (i - x) / m.size);
  }

  apply(msg: ServerMsg): void {
    const { map, sim } = this;
    switch (msg.type) {
      case 'chunk': {
        const x0 = msg.cx << CHUNK_SHIFT;
        const y0 = msg.cy << CHUNK_SHIFT;
        for (const layer of [map.road, map.rail, map.span, map.air, map.building, map.owner, map.infraOwner, map.construction]) layer.clearRect(x0, y0, CHUNK, CHUNK);
        for (const [l, road, rail, span, air, building, owner, infra, con] of msg.tiles) {
          const x = x0 + (l % CHUNK);
          const y = y0 + Math.floor(l / CHUNK);
          this.setTile([map.idx(x, y), road, rail, span, air, building, owner, infra, -1, con ?? 0]);
        }
        for (const [i, h] of msg.edits) map.restoreEdit(i, h);
        // 描画の更新(チャンク内の全タイル)
        for (let y = y0; y < y0 + CHUNK && y < map.size; y++) for (let x = x0; x < x0 + CHUNK && x < map.size; x++) map.touch(x, y);
        break;
      }
      case 'frame':
        sim.tick = msg.tick;
        for (const r of msg.tiles) this.setTile(r);
        sim.transit.mirrorVehicles(msg.veh as unknown as (Omit<Vehicle, 'path' | 'cargo'> & { path?: number[] })[], msg.gone);
        break;
      case 'struct':
        sim.transit.mirrorStruct({
          nextId: msg.nextId,
          routes: msg.routes as Route[],
          stops: msg.stops as Stop[],
          depots: msg.depots as Depot[],
          signals: msg.signals,
          grants: msg.grants,
        });
        this.ready.struct = true;
        break;
      case 'misc':
        sim.tick = msg.tick;
        sim.company = Company.from(msg.company as never);
        sim.rivals = msg.rivals as never;
        sim.rating = msg.rating as never;
        sim.transit.delivered = msg.delivered;
        sim.transit.transfers = msg.transfers;
        sim.transit.mirrorWaiting(msg.waiting);
        for (const [id, income, profit, carried] of msg.routeStats ?? []) {
          const r = sim.transit.routes.get(id);
          if (r) Object.assign(r, { income, profit, carried });
        }
        this.players = msg.players;
        this.myVehicles = msg.myVehicles;
        this.online = msg.online;
        this.pacts = msg.pacts ?? this.pacts;
        this.auctions = msg.auctions ?? this.auctions;
        this.weekly = msg.weekly ?? this.weekly;
        this.ready.misc = true;
        break;
      case 'towns':
        map.towns.length = 0;
        map.towns.push(...(msg.towns as never[]));
        this.ready.towns = true;
        break;
      case 'fac': {
        // 新しく建った施設と、デザインや大きさが変わった施設は、敷地のタイルを描き直す。
        // 施設の絵は、タイルの更新(frame / chunk)と施設の一覧(fac)が別々に届くので、タイルが先に届くと一覧がなくて描けない。
        // 一覧が届いたときに描き直さないと、ズームを変えて地面を作り直すまで、新しい施設が現れない
        const before = new Map(map.facilities.map((f) => [f.id, `${f.type}:${f.design}:${f.size}`]));
        map.facilities.length = 0;
        map.facilities.push(...(msg.facilities as never[]));
        map.facilityVer++;
        for (const f of map.facilities) {
          const was = before.get(f.id);
          if (was === `${f.type}:${f.design}:${f.size}`) continue;
          for (let y = f.y0; y < f.y0 + f.h; y++) for (let x = f.x0; x < f.x0 + f.w; x++) if (map.inBounds(x, y)) map.touch(x, y);
        }
        break;
      }
      default:
        break;
    }
    if (this.onFirst && this.ready.struct && this.ready.misc && this.ready.towns) {
      const f = this.onFirst;
      this.onFirst = null;
      f();
    }
  }
}
