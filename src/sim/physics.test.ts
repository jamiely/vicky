import { describe, expect, it } from 'vitest';
import { BOARD, PEARL_RADIUS, SIM, SLOTS, TRAY } from '../config';
import { Rng } from '../rng';
import { PhysicsWorld, type SimEvent } from './physics';

function run(physics: PhysicsWorld, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds / SIM.step; i++) events.push(...physics.step());
  return events;
}

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

describe('tray exits and impacts', () => {
  it('classifies a body leaving past the front edge as frontExit and past a side as sideExit, removing it', async () => {
    const physics = await PhysicsWorld.create(new Rng(2));
    const pearls = physics.bodies.filter((b) => b.kind === 'pearl');
    pearls[0]!.body.setTranslation({ x: 0, y: -10, z: TRAY.front + 3 }, true);
    pearls[1]!.body.setTranslation({ x: TRAY.halfWidth + 5, y: -10, z: 0 }, true);
    const before = physics.bodies.length;
    const exits = run(physics, SIM.step).filter((e) => e.type === 'frontExit' || e.type === 'sideExit');
    expect(exits).toEqual([
      expect.objectContaining({ kind: 'pearl' }),
      expect.objectContaining({ kind: 'pearl' }),
    ]);
    expect(exits.map((e) => e.type).sort()).toEqual(['frontExit', 'sideExit']);
    expect(physics.bodies.length).toBe(before - 2);
    physics.dispose();
  });

  it('reports impacts as balls hit pegs and land on the tray, with intensity in (0, 1]', async () => {
    const physics = await PhysicsWorld.create(new Rng(4));
    physics.spawnShot();
    physics.queueDrop('pearl');
    physics.queueDrop('ball', 3);
    const impacts = run(physics, 2).filter((e): e is Extract<SimEvent, { type: 'impact' }> => e.type === 'impact');
    const kinds = new Set(impacts.map((e) => e.kind));
    expect(kinds).toEqual(new Set(['peg', 'tray', 'pearl']));
    expect(impacts.every((e) => e.intensity > 0 && e.intensity <= 1)).toBe(true);
    physics.dispose();
  });

  it('drops queued balls and pearls onto the tray one at a time', async () => {
    const physics = await PhysicsWorld.create(new Rng(5));
    const count = (kind: 'ball' | 'pearl'): number => physics.bodies.filter((b) => b.kind === kind && !b.inBoard).length;
    const balls = count('ball');
    const pearls = count('pearl');
    physics.queueDrop('ball', 4);
    physics.queueDrop('pearl');
    physics.step();
    expect(count('ball')).toBe(balls + 1);
    run(physics, 1);
    expect(count('ball') + count('pearl')).toBeGreaterThanOrEqual(balls + pearls + 5 - 1); // one may already have spilled
    physics.dispose();
  });
});

describe('starting tray', () => {
  it.each([1, 2, 3, 4, 5])('seed %i scatters the starting pearls: staggered depths, spread out, never in a line', async (seed) => {
    const physics = await PhysicsWorld.create(new Rng(seed));
    const pearls = physics.bodies.filter((b) => b.kind === 'pearl').map((b) => b.body.translation());
    physics.dispose();
    expect(pearls).toHaveLength(TRAY.initialPearls);
    const zs = pearls.map((p) => p.z).sort((a, b) => a - b);
    // Each pearl sits at its own depth, so they reach the front edge one at a time.
    for (let i = 1; i < zs.length; i++) expect(zs[i]! - zs[i - 1]!).toBeGreaterThan(1);
    expect(zs.at(-1)! - zs[0]!).toBeGreaterThan(6);
    // None sits anywhere near the edge yet, and none overlap.
    expect(zs.at(-1)!).toBeLessThan(TRAY.front - 6);
    for (const [i, a] of pearls.entries()) for (const b of pearls.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2 * PEARL_RADIUS);
  });
});

describe('stall recovery', () => {
  it('kicks a ball resting on the board, then drops it into the slot below where it stalled', async () => {
    const physics = await PhysicsWorld.create(new Rng(6));
    physics.spawnShot();
    const shot = physics.bodies.find((b) => b.inBoard)!;
    // Simulate a wedge: hold the ball still against gravity; recovery must still resolve it to the slot below.
    shot.body.setGravityScale(0, true);
    const x = -BOARD.halfWidth + 1.5 * ((2 * BOARD.halfWidth) / SLOTS.length); // middle of slot 1
    let slot: number | null = null;
    for (let i = 0; i < 4 / SIM.step && slot === null; i++) {
      if (shot.kicks < 3) {
        shot.body.setTranslation({ x, y: 50, z: BOARD.z }, true);
        shot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      for (const e of physics.step()) if (e.type === 'slot') slot = e.index;
    }
    expect(shot.kicks).toBe(3);
    expect(slot).toBe(1);
    physics.dispose();
  });
});
