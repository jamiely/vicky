import { describe, expect, it } from 'vitest';
import { SIM } from '../config';
import { Rng } from '../rng';
import { PhysicsWorld } from './physics';

describe('peg board', () => {
  // Regression guard for board stalls seen during tuning: wall-lane traps, two-ball arches between pegs,
  // hard-CCD freezes, and balls hanging asleep on a peg's flank. Every shot must reach a slot.
  it('drains every shot into a slot under rapid fire', async () => {
    for (const seed of [1, 3, 7]) {
      const physics = await PhysicsWorld.create(new Rng(seed));
      const shots = 120;
      let fired = 0;
      let landed = 0;
      for (let step = 0; step < 45 / SIM.step; step++) {
        if (fired < shots && step % 30 === 0) {
          physics.spawnShot();
          fired++;
        }
        for (const event of physics.step()) if (event.type === 'slot') landed++;
      }
      expect({ seed, landed, stillOnBoard: physics.bodies.filter((b) => b.inBoard).length }).toEqual({ seed, landed: shots, stillOnBoard: 0 });
      physics.dispose();
    }
  }, 120_000);
});
