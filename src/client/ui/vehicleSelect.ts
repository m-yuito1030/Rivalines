import type { Transit, Vehicle } from '../../shared/sim/network/transit';

/** Find the vehicle on screen tile (x,y) (a train counts if any part of the body is on it; otherwise up to the neighbouring tile). null if none */
export function findVehicle(transit: Transit, size: number, x: number, y: number, tol = 1): Vehicle | null {
  let best: { v: Vehicle; d: number } | null = null;
  const consider = (v: Vehicle, tx: number, ty: number) => {
    const d = Math.max(Math.abs(tx - x), Math.abs(ty - y));
    if (d <= tol && (!best || d < best.d)) best = { v, d };
  };
  for (const v of transit.vehicles) {
    if (v.mode === 'rail') {
      for (const i of v.trail) consider(v, i % size, Math.floor(i / size));
    } else if (v.mode === 'air') {
      const p = transit.planePos(v);
      consider(v, Math.floor(p.x), Math.floor(p.y));
    } else if (v.path.length) {
      const p = transit.position(v);
      consider(v, Math.floor(p.x), Math.floor(p.y));
    }
  }
  return best ? (best as { v: Vehicle }).v : null;
}
