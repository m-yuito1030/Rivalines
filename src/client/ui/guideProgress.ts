import type { Transit } from '../../shared/sim/network/transit';

/** What the company (me; 0 = the only company) has built so far: the numbers the first-steps card checks */
export function guideProgress(transit: Transit, me: number): { stops: number; depots: number; routes: number; buses: number } {
  const mine = (o?: number) => !me || o === me;
  const stops = [...transit.stops.values()].filter((s) => s.kind === 'road' && !s.waypoint && mine(s.owner)).length;
  const depots = [...transit.depots.values()].filter((d) => d.kind === 'road' && mine(d.owner)).length;
  const routes = [...transit.routes.values()].filter((r) => r.mode === 'road' && mine(r.owner));
  const ids = new Set(routes.map((r) => r.id));
  return { stops, depots, routes: routes.length, buses: transit.vehicles.filter((v) => ids.has(v.routeId)).length };
}
