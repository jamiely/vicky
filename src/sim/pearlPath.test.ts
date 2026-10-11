import { describe, expect, it } from 'vitest';
import { DISK, PEARL_RADIUS, TOWER, TRAY } from '../config';
import { chutePoint, DISK_ENTRY, groovePoint, liftPoint, releasePoint, sinkDepth, SINK_DEPTH, stackPoint, stackY, type Vec3 } from './pearlPath';

const v = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Largest move between consecutive samples of `path` over u ∈ [0, 1]: a jump shows up as a spike. */
function maxStep(path: (u: number, out: Vec3) => Vec3, samples = 400): number {
  let prev = path(0, v());
  let worst = 0;
  for (let i = 1; i <= samples; i++) {
    const p = path(i / samples, v());
    worst = Math.max(worst, dist(p, prev));
    prev = p;
  }
  return worst;
}

const frontExits: Vec3[] = [
  { x: -TRAY.halfWidth + 2, y: -4.2, z: TRAY.front + 1 },
  { x: 0, y: -4.5, z: TRAY.front + 2 },
  { x: TRAY.halfWidth - 2, y: -4.1, z: TRAY.front + 0.5 },
];
const sideExit: Vec3 = { x: -TRAY.halfWidth - 3, y: -4.3, z: 12 };

describe('pearl path hand-offs (no jumps)', () => {
  it.each(frontExits)('the chute starts where the pearl left the tray (%o) and ends where rolling starts', (exit) => {
    expect(dist(chutePoint(exit, 0, v()), exit)).toBe(0);
    expect(dist(chutePoint(exit, 1, v()), DISK_ENTRY)).toBeLessThan(1e-9);
    expect(dist(DISK_ENTRY, groovePoint(DISK.entryAngle, 0, v()))).toBe(0);
    expect(maxStep((u, out) => chutePoint(exit, u, out))).toBeLessThan(1);
  });

  it('a captured pearl sinks smoothly and the lift starts from its sunk position', () => {
    expect(sinkDepth(0)).toBe(0);
    expect(sinkDepth(DISK.sinkSeconds)).toBe(SINK_DEPTH);
    const pocket = groovePoint(1.3, SINK_DEPTH, v());
    expect(dist(liftPoint(pocket, 0, stackY(2), v()), pocket)).toBe(0);
  });

  it.each([0, 1, 4])('the lift ends exactly in stack slot %i and climbs without jumps', (slot) => {
    const pocket = groovePoint(0.4, SINK_DEPTH, v());
    for (const from of [pocket, sideExit]) {
      expect(dist(liftPoint(from, 1, stackY(slot), v()), stackPoint(slot, v()))).toBeLessThan(1e-9);
      expect(maxStep((u, out) => liftPoint(from, u, stackY(slot), out))).toBeLessThan(1.5);
    }
  });

  it('a rising pearl stops below pearls already stacked instead of passing through them', () => {
    const from = groovePoint(0, SINK_DEPTH, v());
    for (let u = 0; u <= 1; u += 0.01) expect(liftPoint(from, u, stackY(3), v()).y).toBeLessThanOrEqual(stackY(3) + 1e-9);
    expect(stackY(3)).toBeLessThan(stackY(2) - 2 * PEARL_RADIUS);
  });

  it.each([0, 3])('a released pearl leaves from its stack slot %i and ends at the tray exit where physics takes over', (slot) => {
    expect(dist(releasePoint(slot, 0, v()), stackPoint(slot, v()))).toBeLessThan(1e-9);
    expect(dist(releasePoint(slot, 1, v()), TOWER.releaseExit)).toBeLessThan(1e-9);
    expect(maxStep((u, out) => releasePoint(slot, u, out))).toBeLessThan(1);
  });

  it('the stack hangs from the top of the tower and fits inside it', () => {
    expect(stackY(0) + PEARL_RADIUS).toBe(TOWER.stackTopY);
    expect(TOWER.stackTopY).toBeLessThan(TOWER.baseY + TOWER.height);
    expect(stackY(7) - PEARL_RADIUS).toBeGreaterThan(TOWER.releaseTubeY);
  });
});
