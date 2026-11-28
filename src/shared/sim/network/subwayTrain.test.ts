import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../world/constants';
import { GameMap } from '../../world/gameMap';
import { connectRail } from '../../world/rails';
import { layNewSubway, layPortal } from '../../world/subway';
import { Transit } from './transit';

const flat = (size = 96) => new GameMap(size, 1, new Uint8Array(size * size).fill(SEA_LEVEL + 10));
const io = { afford: () => true, pay: () => true, msg: (s: string) => void s };

describe('subway trains', () => {
  it('a train runs between two underground stations and carries people', () => {
    const m = flat();
    layNewSubway(m, { x: 5, y: 20 }, { x: 60, y: 20 }, 2, 3, io);
    for (const x of [8, 9, 56, 57]) m.building.set(m.idx(x, 21), 3); // passengers
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail');
    const b = tr.addStop(58, 20, 'rail');
    expect(a && b).toBeTruthy();
    const r = tr.addRoute([a!.id, b!.id])!;
    const v = tr.addVehicle(r.id, 0);
    expect(v).not.toBeNull();
    for (let t = 1; t < 12000; t++) tr.step(t);
    expect(tr.delivered).toBeGreaterThan(0);
  });

  it('a portal joins the subway to a surface rail, and a train can run across', () => {
    const m = flat();
    for (let x = 5; x < 19; x++) connectRail(m, x, 30, 1); // surface rail 5..19 (the end tile is x=19)
    layNewSubway(m, { x: 20, y: 30 }, { x: 50, y: 30 }, 1, 1, io);
    layPortal(m, { x: 20, y: 30 }, io);
    expect(m.railAt(m.idx(19, 30)) & 2).toBe(2); // the surface end now leads east
    for (const x of [7, 8, 48, 49]) m.building.set(m.idx(x, 31), 3);
    const tr = new Transit(m);
    const a = tr.addStop(7, 30, 'rail')!; // on the surface
    const b = tr.addStop(48, 30, 'rail')!; // underground
    const r = tr.addRoute([a.id, b.id])!;
    expect(tr.addVehicle(r.id, 0)).not.toBeNull();
    for (let t = 1; t < 12000; t++) tr.step(t);
    expect(tr.delivered).toBeGreaterThan(0);
  });

  it('a surface rail cannot be laid on a subway tile, and a subway cannot be dug under a surface rail', () => {
    const m = flat();
    layNewSubway(m, { x: 5, y: 20 }, { x: 15, y: 20 }, 1, 1, io);
    expect(connectRail(m, 10, 19, 2)).toBe(false);
    connectRail(m, 30, 10, 2);
    connectRail(m, 30, 11, 2);
    const msgs: string[] = [];
    layNewSubway(m, { x: 30, y: 8 }, { x: 30, y: 14 }, 1, 1, { ...io, msg: (s) => msgs.push(s) });
    expect(msgs.length).toBe(1);
  });
});

describe('subway trains on diagonals and underground stations', () => {
  it('a train runs along a track with a diagonal part', () => {
    const m = flat();
    // East, then a diagonal run, then east again
    layNewSubway(m, { x: 5, y: 20 }, { x: 25, y: 20 }, 2, 2, io);
    layNewSubway(m, { x: 25, y: 20 }, { x: 35, y: 30 }, 2, 2, io);
    layNewSubway(m, { x: 35, y: 30 }, { x: 60, y: 30 }, 2, 2, io);
    for (const x of [8, 9, 56, 57]) m.building.set(m.idx(x, 31), 3);
    const tr = new Transit(m);
    const a = tr.addStop(7, 20, 'rail')!;
    const b = tr.addStop(58, 30, 'rail')!;
    expect(a && b).toBeTruthy();
    const r = tr.addRoute([a.id, b.id])!;
    expect(r).toBeTruthy();
    expect(tr.addVehicle(r.id, 0)).not.toBeNull();
    for (let t = 1; t < 15000; t++) tr.step(t);
    expect(tr.delivered).toBeGreaterThan(0);
  });
});
