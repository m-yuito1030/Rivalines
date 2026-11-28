import kit from '../../shared/data/airportKit.json';
import { AIR } from '../../shared/world/airportLayout';
import url from '../assets/airport.png';

/**
 * Airport sprites (tools/airport-sprites/airportkit.py). One cell is 64x96; the tile's diamond is at the bottom with its top corner at (32, 64).
 * A tile is a ground piece (runway / taxiway / apron / stand, or the terminal, a hangar, which carry their own ground) plus overlays
 * (hold lines, fences along the airport's outer edge, jet bridges, a windsock). Which piece it is follows from the four neighbours.
 */
const INDEX = new Map(kit.names.map((n, i) => [n, i]));
const [CW, CH] = kit.cell;
let img: HTMLImageElement | null = null;

export function loadAirportSprites(): Promise<void> {
  if (img) return Promise.resolve();
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => {
      img = i;
      resolve();
    };
    i.onerror = () => resolve(); // on failure the older drawing stays in use
    i.src = url;
  });
}

export const airportSpritesReady = (): boolean => img !== null;

export interface AirSides {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

const draw = (ctx: CanvasRenderingContext2D, name: string, px: number, py: number): void => {
  const i = INDEX.get(name);
  if (i === undefined || !img) return;
  ctx.drawImage(img, (i % kit.cols) * CW, Math.floor(i / kit.cols) * CH, CW, CH, px - CW / 2, py - kit.groundTop, CW, CH);
};

const hash = (x: number, y: number): number => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 997;
const sides = (nb: AirSides): number[] => [nb.u0, nb.u1, nb.v0, nb.v1];
const walkable = (c: number): boolean => c === AIR.TAXIWAY || c === AIR.APRON || c === AIR.STAND || c === AIR.HANGAR;
const solid = (c: number): boolean => c === AIR.BUILDING || c === AIR.TERMINAL;

/** Draw one airport tile with the sprites. (px, py) is the top corner of the tile's diamond */
export function drawAirportSprite(ctx: CanvasRenderingContext2D, px: number, py: number, kind: number, nb: AirSides, tx: number, ty: number): void {
  const s = sides(nb);
  const h = hash(tx, ty);
  if (kind === AIR.RUNWAY) {
    const alongU = nb.u0 === AIR.RUNWAY || nb.u1 === AIR.RUNWAY || (nb.v0 !== AIR.RUNWAY && nb.v1 !== AIR.RUNWAY);
    const before = alongU ? nb.u0 : nb.v0;
    const after = alongU ? nb.u1 : nb.v1;
    const part = before !== AIR.RUNWAY ? 'start' : after !== AIR.RUNWAY ? 'end' : (tx + ty) % 3 === 0 ? 'alt' : 'mid';
    draw(ctx, `runway_${alongU ? 0 : 1}_${part}`, px, py);
  } else if (kind === AIR.TAXIWAY) {
    const mask = (walkable(nb.u0) ? 1 : 0) | (walkable(nb.u1) ? 2 : 0) | (walkable(nb.v0) ? 4 : 0) | (walkable(nb.v1) ? 8 : 0);
    draw(ctx, `taxi_${mask}`, px, py);
    s.forEach((c, i) => c === AIR.RUNWAY && draw(ctx, `hold_${i}`, px, py));
  } else if (kind === AIR.STAND) {
    let dir = s.findIndex((c) => c === AIR.TAXIWAY);
    if (dir < 0) dir = s.findIndex((c) => c === AIR.APRON);
    draw(ctx, `stand_${dir < 0 ? 3 : dir}`, px, py);
    s.forEach((c, i) => solid(c) && draw(ctx, `jet_${i}`, px, py));
  } else if (kind === AIR.BUILDING) {
    const mask = (solid(nb.u0) ? 1 : 0) | (solid(nb.u1) ? 2 : 0) | (solid(nb.v0) ? 4 : 0) | (solid(nb.v1) ? 8 : 0);
    draw(ctx, `term_${mask}_${h % 3}`, px, py);
  } else if (kind === AIR.TERMINAL) {
    draw(ctx, 'term_main', px, py);
  } else if (kind === AIR.HANGAR) {
    const open = (c: number) => c === AIR.APRON || c === AIR.TAXIWAY || c === AIR.STAND;
    draw(ctx, `hangar_${open(nb.v1) || !open(nb.u1) ? 'L' : 'R'}_${h % 2}`, px, py);
  } else {
    draw(ctx, `apron_${h % 4}`, px, py);
    if (h % 29 === 0) draw(ctx, 'windsock', px, py);
  }
  // A fence along every edge that faces the outside of the airport (only on the ground pieces that need it)
  s.forEach((c, i) => c === 0 && draw(ctx, `fence_${i}`, px, py));
}
