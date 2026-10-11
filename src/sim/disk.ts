import { DISK, type PocketColor } from '../config';
import type { Rng } from '../rng';

/**
 * A pearl's path through the front of the machine:
 * chute (tray edge → disk) → rolling (groove) → sunk (in a pocket) → lift (up the tower) → back to the reserve.
 * Pearls lost off a tray side skip straight to the lift. Pearls are never created or destroyed here.
 */
export type DiskPhase = 'chute' | 'rolling' | 'sunk' | 'lift';

export interface DiskPearl {
  phase: DiskPhase;
  /** Seconds spent in the current phase. */
  t: number;
  /** World angle around the disk axis. */
  angle: number;
  /** Angular speed relative to the disk (rad/s, signed) while rolling. */
  rel: number;
  /** Pocket index once captured. */
  pocket: number | null;
}

export interface PocketEvent {
  pocket: number;
  color: PocketColor;
}

const SPACING = (2 * Math.PI) / DISK.pockets.length;
/** Half-width (radians) of the angular window in which a slow pearl drops into a hole. */
const CAPTURE_HALF_ANGLE = (DISK.holeRadius * 0.6) / DISK.grooveRadius;

/**
 * Pearl-in-groove dynamics on the spinning pocket disk plus the tower lift. Relative speed decays exponentially to a
 * creep floor below the capture speed, so every pearl settles; fast passes over a hole are "in and out".
 */
export class PocketDisk {
  angle = 0;
  readonly pearls: DiskPearl[] = [];

  constructor(private readonly rng: Rng) {}

  /** A pearl pushed off the tray's front edge enters the chute to the disk. */
  launch(): void {
    const speed = this.rng.range(DISK.entrySpeed[0], DISK.entrySpeed[1]);
    this.pearls.push({ phase: 'chute', t: 0, angle: DISK.entryAngle, rel: this.rng.sign() * speed, pocket: null });
  }

  /** A pearl that fell off a tray side is collected without paying and lifted back to the reserve. */
  sendToLift(): void {
    this.pearls.push({ phase: 'lift', t: 0, angle: 0, rel: 0, pocket: null });
  }

  /** Advances all pearls; reports pocket captures and how many pearls reached the tower reserve. */
  step(dt: number): { pockets: PocketEvent[]; returned: number } {
    const pockets: PocketEvent[] = [];
    let returned = 0;
    this.angle += DISK.spin * dt;
    for (let i = this.pearls.length - 1; i >= 0; i--) {
      const p = this.pearls[i]!;
      p.t += dt;
      switch (p.phase) {
        case 'chute':
          if (p.t >= DISK.chuteSeconds) {
            p.phase = 'rolling';
            p.t = 0;
          }
          break;
        case 'rolling': {
          const speed = Math.max(Math.abs(p.rel) * Math.exp(-DISK.decay * dt), DISK.creep);
          p.rel = Math.sign(p.rel) * speed;
          p.angle += (DISK.spin + p.rel) * dt;
          const local = (((p.angle - this.angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const nearest = Math.round(local / SPACING);
          if (Math.abs(local - nearest * SPACING) < CAPTURE_HALF_ANGLE && speed < DISK.captureSpeed) {
            const hole = nearest % DISK.pockets.length;
            p.pocket = hole;
            p.angle = this.angle + hole * SPACING; // snap into the hole center
            p.phase = 'sunk';
            p.t = 0;
            pockets.push({ pocket: hole, color: DISK.pockets[hole]! });
          }
          break;
        }
        case 'sunk':
          p.angle += DISK.spin * dt;
          if (p.t >= DISK.sinkSeconds) {
            p.phase = 'lift';
            p.t = 0;
          }
          break;
        case 'lift':
          if (p.t >= DISK.liftSeconds) {
            this.pearls.splice(i, 1);
            returned++;
          }
          break;
      }
    }
    return { pockets, returned };
  }
}
