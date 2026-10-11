import { describe, expect, it } from 'vitest';
import { DISK, TRAY } from '../config';
import { Rng } from '../rng';
import { PocketDisk } from './disk';
import { groovePoint, SINK_DEPTH } from './pearlPath';

const exit = { x: 3, y: -4.2, z: TRAY.front + 1 };

describe('pocket disk', () => {
  it('settles every launched pearl in one pocket, returns every pearl once, and releases every requested pearl', () => {
    const disk = new PocketDisk(new Rng(11));
    const launched = 60;
    const lost = 5;
    const releases = 4;
    const pockets: string[] = [];
    let returned = 0;
    let released = 0;
    for (let i = 0; i < launched; i++) disk.launch(exit);
    for (let i = 0; i < lost; i++) disk.sendToLift({ x: -TRAY.halfWidth - 3, y: -4.1, z: 10 });
    for (let i = 0; i < releases; i++) disk.release(i);
    const horizon = DISK.chuteSeconds + 10 + DISK.sinkSeconds + DISK.liftSeconds;
    for (let t = 0; t < horizon; t += 1 / 120) {
      const step = disk.step(1 / 120);
      for (const p of step.pockets) pockets.push(p.color);
      returned += step.returned;
      released += step.released;
    }
    expect(pockets).toHaveLength(launched);
    expect(new Set(pockets).size).toBe(new Set(DISK.pockets).size);
    expect(returned).toBe(launched + lost);
    expect(released).toBe(releases);
    expect(disk.pearls).toHaveLength(0);
  });

  it('starts the chute where the pearl left the tray and the lift where it sits in its pocket', () => {
    const disk = new PocketDisk(new Rng(2));
    disk.launch(exit);
    const pearl = disk.pearls[0]!;
    expect(pearl.from).toEqual(exit);
    for (let i = 0; i < 120 * 20 && pearl.phase !== 'lift'; i++) disk.step(1 / 120);
    expect(pearl.phase).toBe('lift');
    // The lift keeps the angle the pearl had in its hole on the step it left.
    expect(pearl.from).toEqual(groovePoint(pearl.angle, SINK_DEPTH, { x: 0, y: 0, z: 0 }));
  });

  it('eases a captured pearl into the hole center instead of snapping', () => {
    const disk = new PocketDisk(new Rng(5));
    disk.launch(exit);
    const pearl = disk.pearls[0]!;
    let maxJump = 0;
    let last = pearl.angle;
    for (let i = 0; i < 120 * 20 && pearl.phase !== 'lift'; i++) {
      disk.step(1 / 120);
      if (pearl.phase === 'rolling' || pearl.phase === 'sunk') maxJump = Math.max(maxJump, Math.abs(pearl.angle - last));
      last = pearl.angle;
    }
    // Max legit per-step travel: entry speed + spin at 120 Hz.
    expect(maxJump).toBeLessThan(((DISK.entrySpeed[1] + DISK.spin) / 120) * 1.01 + 1e-9);
    const holeCenter = disk.angle + pearl.pocket! * ((2 * Math.PI) / DISK.pockets.length);
    const off = pearl.angle - holeCenter;
    expect(Math.abs(off - 2 * Math.PI * Math.round(off / (2 * Math.PI)))).toBeLessThan(1e-3);
  });
});
