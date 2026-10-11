import { DISK, type PocketColor } from '../config';
import type { Rng } from '../rng';

export interface DiskPearl {
  /** Seconds left in the chute before the pearl reaches the disk. */
  chute: number;
  /** World angle around the disk axis. */
  angle: number;
  /** Angular speed relative to the disk (rad/s, signed). */
  rel: number;
  /** Pocket index once captured. */
  pocket: number | null;
  /** Seconds since capture; the pearl is removed after it has visibly dropped. */
  sunk: number;
}

export interface PocketEvent {
  pocket: number;
  color: PocketColor;
}

const SPACING = (2 * Math.PI) / DISK.pockets.length;
/** Half-width (radians) of the angular window in which a slow pearl drops into a hole. */
const CAPTURE_HALF_ANGLE = (DISK.holeRadius * 0.6) / DISK.grooveRadius;
const SINK_SECONDS = 1.6;

/**
 * Pearl-in-groove dynamics on the spinning pocket disk. Relative speed decays exponentially to a creep floor
 * below the capture speed, so every pearl settles; fast passes over a hole are "in and out".
 */
export class PocketDisk {
  angle = 0;
  readonly pearls: DiskPearl[] = [];

  constructor(private readonly rng: Rng) {}

  launch(): void {
    const speed = this.rng.range(DISK.entrySpeed[0], DISK.entrySpeed[1]);
    this.pearls.push({ chute: DISK.chuteSeconds, angle: DISK.entryAngle, rel: this.rng.sign() * speed, pocket: null, sunk: 0 });
  }

  step(dt: number): PocketEvent[] {
    const events: PocketEvent[] = [];
    this.angle += DISK.spin * dt;
    for (let i = this.pearls.length - 1; i >= 0; i--) {
      const p = this.pearls[i]!;
      if (p.chute > 0) {
        p.chute -= dt;
        continue;
      }
      if (p.pocket !== null) {
        p.sunk += dt;
        p.angle += DISK.spin * dt;
        if (p.sunk > SINK_SECONDS) this.pearls.splice(i, 1);
        continue;
      }
      const speed = Math.max(Math.abs(p.rel) * Math.exp(-DISK.decay * dt), DISK.creep);
      p.rel = Math.sign(p.rel) * speed;
      p.angle += (DISK.spin + p.rel) * dt;
      const local = (((p.angle - this.angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const hole = Math.round(local / SPACING) % DISK.pockets.length;
      const offset = local - Math.round(local / SPACING) * SPACING;
      if (Math.abs(offset) < CAPTURE_HALF_ANGLE && speed < DISK.captureSpeed) {
        p.pocket = hole;
        p.angle = this.angle + hole * SPACING; // snap into the hole center
        events.push({ pocket: hole, color: DISK.pockets[hole]! });
      }
    }
    return events;
  }
}
