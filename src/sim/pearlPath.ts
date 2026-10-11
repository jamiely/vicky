import { DISK, PEARL_RADIUS, TOWER, TRAY } from '../config';

/**
 * Geometry of a pearl's trip outside the Rapier tray, shared by the disk simulation (hand-off points) and the stage
 * (drawing). Each segment starts exactly where the previous one ends, so a pearl never jumps:
 *
 *   tray exit ─gutter→ chute ─→ disk groove ─→ pocket (sinks) ─lift→ tower stack ─release→ tray (physics)
 *   side exit ─────────────────────────────────────────────lift↗
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Depth a captured pearl sinks into its pocket hole. */
export const SINK_DEPTH = PEARL_RADIUS * 1.3;
const SINK_SPEED = 10; // cm/s
const STACK_SPACING = 2 * PEARL_RADIUS + 0.2;
/** Gutter in front of the tray's lip: pearls roll along it to the right corner, then down the chute. */
export const GUTTER = { y: -6.5, z: TRAY.front + 3.5 };
export const GUTTER_END: Readonly<Vec3> = { x: TRAY.halfWidth + 4, y: -7.5, z: GUTTER.z };
/** Hidden run inside the cabinet's pedestals, below the disk, between the disk/side exits and the tower foot. */
const UNDER_Y = -26;
/** Fraction of the lift spent dropping below the base, then crossing to the tower foot, then rising. */
const LIFT_DROP = 0.12;
const LIFT_CROSS = 0.3;
/** Fraction of the release spent descending the tower axis before the tube to the tray. */
const RELEASE_DESCENT = 0.6;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function mix(a: Vec3, b: Vec3, t: number, out: Vec3): Vec3 {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  return out;
}

/** Pearl center on the disk groove at world `angle`, sunk `sink` cm into a hole. */
export function groovePoint(angle: number, sink: number, out: Vec3): Vec3 {
  out.x = DISK.center.x + DISK.grooveRadius * Math.cos(angle);
  out.y = DISK.center.y + 1 + PEARL_RADIUS - sink;
  out.z = DISK.center.z - DISK.grooveRadius * Math.sin(angle);
  return out;
}

/** How far a pearl has sunk `t` seconds after capture. */
export function sinkDepth(t: number): number {
  return Math.min(t * SINK_SPEED, SINK_DEPTH);
}

/** Where the chute delivers pearls onto the groove (rolling starts here). */
export const DISK_ENTRY: Readonly<Vec3> = groovePoint(DISK.entryAngle, 0, { x: 0, y: 0, z: 0 });

/**
 * Chute from the point a pearl left the tray's front edge: into the gutter below, along it to the right corner, down
 * the chute to the disk. `u` in [0, 1] is progress by path length.
 */
export function chutePoint(exit: Vec3, u: number, out: Vec3): Vec3 {
  const inGutter: Vec3 = { x: exit.x, y: GUTTER.y, z: GUTTER.z };
  const legs = [exit, inGutter, GUTTER_END, DISK_ENTRY];
  return along(legs, u, out);
}

/**
 * Lift from `from` (a sunk pocket position, or where a pearl fell off a tray side): down below the base, across to the
 * tower foot, then up the tower axis. The climb stops at `stopY` (the stack slot waiting for this pearl), so a pearl
 * reaches its slot no later than the end of the lift and never passes through pearls already stacked.
 */
export function liftPoint(from: Vec3, u: number, stopY: number, out: Vec3): Vec3 {
  if (u < LIFT_DROP) return mix(from, { x: from.x, y: UNDER_Y, z: from.z }, u / LIFT_DROP, out);
  if (u < LIFT_CROSS) return mix({ x: from.x, y: UNDER_Y, z: from.z }, { x: TOWER.x, y: UNDER_Y, z: TOWER.z }, (u - LIFT_DROP) / (LIFT_CROSS - LIFT_DROP), out);
  out.x = TOWER.x;
  out.z = TOWER.z;
  out.y = Math.min(lerp(UNDER_Y, stackY(0), (u - LIFT_CROSS) / (1 - LIFT_CROSS)), stopY);
  return out;
}

/** Height of the `index`-th pearl in the tower stack; index 0 hangs at the top, later arrivals stack below it. */
export function stackY(index: number): number {
  return TOWER.stackTopY - PEARL_RADIUS - index * STACK_SPACING;
}

/** Position of the `index`-th reserve pearl. */
export function stackPoint(index: number, out: Vec3): Vec3 {
  out.x = TOWER.x;
  out.y = stackY(index);
  out.z = TOWER.z;
  return out;
}

/** Release of the stack's bottom pearl (slot `slot`): down the tower axis, then through the tube to the tray exit. */
export function releasePoint(slot: number, u: number, out: Vec3): Vec3 {
  const branch: Vec3 = { x: TOWER.x, y: TOWER.releaseTubeY, z: TOWER.z };
  if (u < RELEASE_DESCENT) return mix(stackPoint(slot, out), branch, u / RELEASE_DESCENT, out);
  return mix(branch, TOWER.releaseExit, (u - RELEASE_DESCENT) / (1 - RELEASE_DESCENT), out);
}

/** Point at fraction `u` of the total length of a polyline. */
function along(points: readonly Vec3[], u: number, out: Vec3): Vec3 {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y, p.z - points[i]!.z));
  let remaining = Math.min(1, Math.max(0, u)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!;
    if (remaining <= len || i === lengths.length - 1) return mix(points[i]!, points[i + 1]!, len === 0 ? 1 : Math.min(1, remaining / len), out);
    remaining -= len;
  }
  return out;
}
