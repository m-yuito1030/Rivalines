import { describe, expect, it } from 'vitest';
import { AIR, AIRPORT_DESIGNS, AIRPORT_SIZES, type AirportAxis, buildLayout, isTaxiable, sizeByStands } from './airportLayout';

/** Whether every stand and hangar can roll to a runway end, and each runway has taxiways beside it */
function check(size: (typeof AIRPORT_SIZES)[number], axis: AirportAxis, design: number): string[] {
  const L = buildLayout(size, axis, design);
  const errs: string[] = [];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= L.w || y >= L.h ? 0 : L.codes[y * L.w + x]);
  const count = (c: number) => L.codes.filter((v) => v === c).length;
  if (count(AIR.TERMINAL) !== 1) errs.push('terminal count');
  if (count(AIR.HANGAR) < 1) errs.push('no hangar');
  if (count(AIR.RUNWAY) === 0) errs.push('no runway');
  if (sizeByStands(count(AIR.STAND)) !== size) errs.push(`stands ${count(AIR.STAND)} do not match size`);
  if (count(AIR.STAND) !== L.stands) errs.push('stand count');
  // Flood fill over taxiable tiles from the first taxiway tile
  const start = [...L.codes].findIndex((v) => v === AIR.TAXIWAY);
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % L.w;
    const y = (k - x) / L.w;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
      const n = ny * L.w + nx;
      if (!seen.has(n) && isTaxiable(L.codes[n])) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  for (let k = 0; k < L.codes.length; k++) if (isTaxiable(L.codes[k]) && !seen.has(k)) errs.push('unreachable tile ' + (k % L.w) + ',' + Math.floor(k / L.w));
  // Every runway line: both ends have a taxiable side tile (where aircraft get on)
  const cell = (along: number, across: number) => (axis === 'x' ? at(along, across) : at(across, along));
  const alongLen = axis === 'x' ? L.w : L.h;
  const acrossLen = axis === 'x' ? L.h : L.w;
  for (let r = 0; r < acrossLen; r++) {
    if (cell(0, r) !== AIR.RUNWAY) continue;
    for (const end of [0, alongLen - 1]) {
      if (!isTaxiable(cell(end, r - 1)) && !isTaxiable(cell(end, r + 1))) errs.push('runway end has no access');
    }
    if (cell(0, r + 1) === AIR.RUNWAY) errs.push('adjacent runway rows');
  }
  return errs;
}

describe('airport layouts', () => {
  for (const size of AIRPORT_SIZES) {
    it(`all ${AIRPORT_DESIGNS} designs of ${size} work in both directions and differ from each other`, () => {
      const seen = new Set<string>();
      for (let d = 0; d < AIRPORT_DESIGNS; d++) {
        for (const axis of ['x', 'y'] as const) expect([...new Set(check(size, axis, d))].slice(0, 3), `${size}${d}${axis}`).toEqual([]);
        const key = [...buildLayout(size, 'x', d).codes].join('') + buildLayout(size, 'x', d).w;
        expect(seen.has(key), `${size}${d} duplicates another design`).toBe(false);
        seen.add(key);
      }
    });
  }
  it('design 0 is the original layout and a bad design number falls back to it', () => {
    expect(buildLayout('M', 'x', 99).codes).toEqual(buildLayout('M', 'x', 0).codes);
    expect(buildLayout('H', 'x').stands).toBe(60);
  });
});
