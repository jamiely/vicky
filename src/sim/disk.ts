import { DISK, type PocketColor } from '../config';
import type { Rng } from '../rng';
import { groovePoint, SINK_DEPTH, type Vec3 } from './pearlPath';

/**
 * A pearl's trip outside the tray (geometry in `pearlPath.ts`):
 * chute (front edge → disk) → rolling (groove) → sunk (pocket) → lift (up the tower) → stacked in the reserve;
 * side losses go straight to the lift; `release` carries the stack's bottom pearl back down to the tray.
 * Pearls are never created or destroyed here.
 */
export type DiskPhase = 'chute' | 'rolling' | 'sunk' | 'lift' | 'release';

export interface DiskPearl {
  phase: DiskPhase;
  /** Seconds spent in the current phase. */
  t: number;
  /** Start of the current path (tray exit for the chute, pocket or side exit for the lift). */
  from: Vec3;
  /** World angle around the disk axis. */
  angle: number;
  /** Angular speed relative to the disk (rad/s, signed) while rolling. */
  rel: number;
  /** Pocket index once captured. */
  pocket: number | null;
  /** Stack slot a released pearl leaves from. */
  slot: number;
}

export interface PocketEvent {
  pocket: number;
  color: PocketColor;
}

export interface DiskStep {
  pockets: PocketEvent[];
  /** Pearls that reached the tower stack. */
  returned: number;
  /** Pearls that left the release tube; the caller spawns them on the tray at `TOWER.releaseExit`. */
  released: number;
}

const SPACING = (2 * Math.PI) / DISK.pockets.length;
/** Half-width (radians) of the angular window in which a slow pearl drops into a hole. */
const CAPTURE_HALF_ANGLE = (DISK.holeRadius * 0.6) / DISK.grooveRadius;
const PHASE_SECONDS: Record<Exclude<DiskPhase, 'rolling'>, () => number> = {
  chute: () => DISK.chuteSeconds,
  sunk: () => DISK.sinkSeconds,
  lift: () => DISK.liftSeconds,
  release: () => DISK.releaseSeconds,
};

/**
 * Pearl-in-groove dynamics on the spinning pocket disk plus the tower lift and release. Relative speed decays
 * exponentially to a creep floor below the capture speed, so every pearl settles; fast passes over a hole are
 * "in and out".
 */
export class PocketDisk {
  angle = 0;
  readonly pearls: DiskPearl[] = [];

  constructor(private readonly rng: Rng) {}

  /** A pearl left the tray's front edge at `exit`; it rolls down the gutter and chute to the disk. */
  launch(exit: Vec3): void {
    const speed = this.rng.range(DISK.entrySpeed[0], DISK.entrySpeed[1]);
    this.pearls.push({ phase: 'chute', t: 0, from: { ...exit }, angle: DISK.entryAngle, rel: this.rng.sign() * speed, pocket: null, slot: 0 });
  }

  /** A pearl fell off a tray side at `exit`; it pays nothing and rides the lift back to the tower. */
  sendToLift(exit: Vec3): void {
    this.pearls.push({ phase: 'lift', t: 0, from: { ...exit }, angle: 0, rel: 0, pocket: null, slot: 0 });
  }

  /** The stack's bottom pearl (in `slot`) drops down the tower and out of the release tube. */
  release(slot: number): void {
    this.pearls.push({ phase: 'release', t: 0, from: { x: 0, y: 0, z: 0 }, angle: 0, rel: 0, pocket: null, slot });
  }

  step(dt: number): DiskStep {
    const out: DiskStep = { pockets: [], returned: 0, released: 0 };
    this.angle += DISK.spin * dt;
    for (let i = this.pearls.length - 1; i >= 0; i--) {
      const p = this.pearls[i]!;
      p.t += dt;
      if (p.phase === 'rolling') {
        this.roll(p, dt, out);
        continue;
      }
      if (p.phase === 'sunk') {
        // Rides the spinning disk while easing into the hole center (no snap on capture).
        p.angle += DISK.spin * dt;
        const off = p.angle - (this.angle + p.pocket! * SPACING);
        const wrapped = off - 2 * Math.PI * Math.round(off / (2 * Math.PI));
        p.angle -= wrapped * Math.min(1, 10 * dt);
      }
      if (p.t < PHASE_SECONDS[p.phase]()) continue;
      switch (p.phase) {
        case 'chute':
          p.phase = 'rolling';
          break;
        case 'sunk':
          // The lift starts exactly where the pearl sits in its hole.
          p.from = groovePoint(p.angle, SINK_DEPTH, { x: 0, y: 0, z: 0 });
          p.phase = 'lift';
          break;
        case 'lift':
          this.pearls.splice(i, 1);
          out.returned++;
          continue;
        case 'release':
          this.pearls.splice(i, 1);
          out.released++;
          continue;
      }
      p.t = 0;
    }
    return out;
  }

  private roll(p: DiskPearl, dt: number, out: DiskStep): void {
    const speed = Math.max(Math.abs(p.rel) * Math.exp(-DISK.decay * dt), DISK.creep);
    p.rel = Math.sign(p.rel) * speed;
    p.angle += (DISK.spin + p.rel) * dt;
    const local = (((p.angle - this.angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const nearest = Math.round(local / SPACING);
    if (Math.abs(local - nearest * SPACING) >= CAPTURE_HALF_ANGLE || speed >= DISK.captureSpeed) return;
    const hole = nearest % DISK.pockets.length;
    p.pocket = hole;
    p.phase = 'sunk';
    p.t = 0;
    out.pockets.push({ pocket: hole, color: DISK.pockets[hole]! });
  }
}
