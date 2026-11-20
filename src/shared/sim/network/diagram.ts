/**
 * ダイヤ(運行図表)の計算。画面(スジ図の描画・待避の提案)とテストで共有する純粋関数。
 * 時間の単位は tick(1日 = DAY_TICKS)。路線の時刻表は「各オーダーの発車時刻 departTod + 車両ごとのずれ offset」が周期 period で繰り返す。
 */
export const DAY = 30 * 60 * 10; // transit.DAY_TICKS と同値(循環importを避ける)
export const MIN = DAY / 1440; // 1分

export interface DiaStop {
  id: number;
  name: string;
  x: number;
  y: number;
  /** 番線数(待避ができるのは2以上の駅) */
  tracks: number;
}
export interface DiaOrder {
  stopId: number;
  kind: 'dwell' | 'full' | 'timed';
  departTod: number;
  dwell: number;
  /** 経由点(停車しない) */
  way?: boolean;
}
export interface DiaRoute {
  id: number;
  name: string;
  color: number;
  period: number;
  orders: DiaOrder[];
  /** オーダーごとの「次の停車駅までの走行時間」(経由点は0) */
  legs: number[];
  /** 車両(id, 発車時刻のずれ) */
  vs: [number, number][];
}

/** 1編成の1周の予定: 停車駅ごとの到着・発車(tick。周期内の絶対時刻) */
export interface RunPoint {
  order: number;
  stopId: number;
  arr: number;
  dep: number;
}
export interface Run {
  routeId: number;
  vehicleId: number;
  offset: number;
  points: RunPoint[];
  /** 1周して最初の駅へ戻る到着時刻(線を閉じる用) */
  backArr: number;
}

const mod = (a: number, p: number) => ((a % p) + p) % p;
/** s + j*P のうち min 以上で最小のもの */
const nextOcc = (s: number, min: number, P: number) => s + Math.ceil((min - s) / P - 1e-9) * P;

/** 路線の1編成(offset)の1周ぶんの予定を作る */
export function buildRun(route: DiaRoute, vehicleId: number, offset: number): Run {
  const real = route.orders.map((o, i) => (o.way ? -1 : i)).filter((i) => i >= 0);
  const P = route.period;
  const points: RunPoint[] = [];
  let prevDep = 0;
  let prevLeg = 0;
  real.forEach((idx, k) => {
    const o = route.orders[idx];
    let arr: number;
    let dep: number;
    if (k === 0) {
      dep = o.kind === 'timed' ? mod(o.departTod + offset, P) : offset + o.dwell;
      arr = dep - o.dwell;
    } else {
      arr = prevDep + prevLeg;
      dep = o.kind === 'timed' ? nextOcc(o.departTod + offset, arr + o.dwell, P) : arr + o.dwell;
    }
    points.push({ order: idx, stopId: o.stopId, arr, dep });
    prevDep = dep;
    prevLeg = route.legs[idx] ?? 0;
  });
  return { routeId: route.id, vehicleId, offset, points, backArr: prevDep + prevLeg };
}

/** 路線の全編成の予定(編成がなければ offset=0 の想定線を1本) */
export function routeRuns(route: DiaRoute): Run[] {
  return route.vs.length ? route.vs.map(([id, off]) => buildRun(route, id, off)) : [buildRun(route, 0, 0)];
}

/** 追い越し(待避)の提案 */
export interface PassSuggestion {
  /** 待避する(遅い)路線と、待たせる駅のオーダー番号 */
  routeId: number;
  orderIdx: number;
  stopName: string;
  /** 追い越す(速い)路線 */
  byRouteId: number;
  byName: string;
  /** そのオーダー以降の発車時刻を遅らせる量(tick) */
  delta: number;
  /** この駅で何分待避するか(表示用) */
  waitMin: number;
  /** 待避できる駅がない(番線が足りない)場合の説明。あれば適用できない */
  problem?: string;
}

/** ルートの停車駅の座標列に沿った距離(tick補間用) */
function cumDist(stops: Map<number, DiaStop>, ids: number[]): number[] {
  const c = [0];
  for (let i = 1; i < ids.length; i++) {
    const a = stops.get(ids[i - 1]);
    const b = stops.get(ids[i]);
    c.push(c[i - 1] + (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1));
  }
  return c;
}

/**
 * 同じ線路を走る2路線について、速い列車が遅い列車に「駅と駅の間で追いつく」箇所を見つけ、
 * 遅い列車を番線のある駅で待避させる提案を返す。
 * 速い路線の停車駅が、遅い路線の停車駅の部分列になっている(普通/快速/特急のような)場合に判定できる。
 */
export function suggestPassing(routes: DiaRoute[], stops: Map<number, DiaStop>): PassSuggestion[] {
  const out: PassSuggestion[] = [];
  const seen = new Set<string>();
  for (const A of routes) {
    const realA = A.orders.map((o, i) => (o.way ? -1 : i)).filter((i) => i >= 0);
    const La = realA.map((i) => A.orders[i].stopId);
    if (La.length < 2) continue;
    const cum = cumDist(stops, La);
    const runsA = routeRuns(A);
    for (const B of routes) {
      if (B.id === A.id) continue;
      const realB = B.orders.map((o, i) => (o.way ? -1 : i)).filter((i) => i >= 0);
      if (realB.length < 2) continue;
      // B の停車駅が A の停車駅列の中で単調増加に並ぶか(部分列)
      const posB: number[] = [];
      let from = 0;
      let ok = true;
      for (const i of realB) {
        const p = La.indexOf(B.orders[i].stopId, from);
        if (p < 0) {
          ok = false;
          break;
        }
        posB.push(p);
        from = p;
      }
      if (!ok || realB.length >= La.length) continue; // 部分列でない/停車駅が同じか多い(速くない)
      const runsB = routeRuns(B);
      for (const ra of runsA) {
        for (const rb of runsB) {
          for (let shift = -2; shift <= 2; shift++) {
            const dt = shift * B.period;
            // B の各駅の通過時刻(A の駅列の添字ごと): 停車駅は到着/発車、飛ばす駅は距離で補間
            const passB: { arr: number; dep: number }[] = new Array(La.length);
            for (let m = 0; m < rb.points.length; m++) passB[posB[m]] = { arr: rb.points[m].arr + dt, dep: rb.points[m].dep + dt };
            for (let m = 0; m + 1 < rb.points.length; m++) {
              const i1 = posB[m];
              const i2 = posB[m + 1];
              const d0 = rb.points[m].dep + dt;
              const d1 = rb.points[m + 1].arr + dt;
              const tot = cum[i2] - cum[i1] || 1;
              for (let q = i1 + 1; q < i2; q++) {
                const t = d0 + ((cum[q] - cum[i1]) / tot) * (d1 - d0);
                passB[q] = { arr: t, dep: t };
              }
            }
            // A の各区間で、B が後ろから追いつくか
            for (let k = 0; k + 1 < ra.points.length; k++) {
              const u = passB[k];
              const v = passB[k + 1];
              if (!u || !v) continue;
              const depA = ra.points[k].dep;
              const arrA = ra.points[k + 1].arr;
              if (!(u.dep > depA && v.arr < arrA)) continue; // 追い越しの条件
              // 待避駅: 追い越しの手前で、A が B より先に着き、番線が2以上の最後の駅
              let w = -1;
              for (let q = k; q >= 0; q--) {
                if (!passB[q]) continue;
                const st = stops.get(La[q]);
                if (st && st.tracks >= 2 && ra.points[q].arr <= passB[q].arr) {
                  w = q;
                  break;
                }
              }
              const key = `${A.id}:${B.id}:${w < 0 ? 'x' + k : w}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const stopName = stops.get(La[w < 0 ? k : w])?.name ?? '?';
              if (w < 0) {
                out.push({
                  routeId: A.id,
                  orderIdx: realA[k],
                  stopName,
                  byRouteId: B.id,
                  byName: B.name,
                  delta: 0,
                  waitMin: 0,
                  problem: `${A.name} を ${B.name} が追い越しますが、手前に番線が2以上の駅がないため待避できません(駅の番線を増やしてください)`,
                });
                continue;
              }
              const newDep = passB[w].dep + MIN;
              const delta = Math.ceil((newDep - ra.points[w].dep) / MIN) * MIN;
              out.push({ routeId: A.id, orderIdx: realA[w], stopName, byRouteId: B.id, byName: B.name, delta, waitMin: Math.round((passB[w].dep + MIN - ra.points[w].arr) / MIN) });
            }
          }
        }
      }
    }
  }
  return out.sort((a, b) => Number(!!a.problem) - Number(!!b.problem));
}
