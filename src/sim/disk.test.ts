import { describe, expect, it } from 'vitest';
import { DISK } from '../config';
import { Rng } from '../rng';
import { PocketDisk } from './disk';

describe('pocket disk', () => {
  it('settles every launched pearl in exactly one pocket and lifts every pearl back exactly once', () => {
    const disk = new PocketDisk(new Rng(11));
    const launched = 60;
    const lost = 5;
    const pockets: string[] = [];
    let returned = 0;
    for (let i = 0; i < launched; i++) disk.launch();
    for (let i = 0; i < lost; i++) disk.sendToLift();
    const horizon = DISK.chuteSeconds + 10 + DISK.sinkSeconds + DISK.liftSeconds;
    for (let t = 0; t < horizon; t += 1 / 120) {
      const step = disk.step(1 / 120);
      for (const p of step.pockets) pockets.push(p.color);
      returned += step.returned;
    }
    expect(pockets).toHaveLength(launched);
    expect(new Set(pockets).size).toBe(new Set(DISK.pockets).size);
    expect(returned).toBe(launched + lost);
    expect(disk.pearls).toHaveLength(0);
  });
});
