import RAPIER from '@dimforge/rapier3d-compat';
import { BALL_RADIUS, BOARD, GRAVITY, PEARL_RADIUS, PUSHER, SCRAPER_Z, SIM, SLOTS, TRAY } from '../config';
import type { Rng } from '../rng';

export type BodyKind = 'ball' | 'pearl';
export type SimEvent =
  | { type: 'slot'; index: number }
  | { type: 'frontExit'; kind: BodyKind }
  | { type: 'sideExit'; kind: BodyKind };

export interface Tracked {
  body: RAPIER.RigidBody;
  kind: BodyKind;
  /** True while falling through the peg board; false once on the tray. */
  inBoard: boolean;
  stillFor: number;
  /** Kicks given to free this board ball from a stall. */
  kicks: number;
}

const SLOT_WIDTH = (2 * BOARD.halfWidth) / SLOTS.length;
const PEG_AXIS_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }; // rotates Rapier's Y-axis cylinder onto Z
const DROP_INTERVAL = 0.07;
const EXIT_Y = -4;
/** Rapier groups: membership in the high 16 bits, filter in the low 16. Board balls collide with statics only. */
const BOARD_BALL_GROUPS = (0x0001 << 16) | 0x0004;

/** Rapier world for one station: peg board + slots, tray, pusher, scraper. Knows nothing about payouts. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly bodies: Tracked[] = [];
  readonly pegs: { x: number; y: number }[] = [];
  pusherFront: number = PUSHER.frontMin;
  private readonly pusher: RAPIER.RigidBody;
  private readonly dropQueue: BodyKind[] = [];
  private dropCooldown = 0;
  private time = 0;

  static async create(rng: Rng): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld(rng);
  }

  /** Releases the WASM world; the instance is unusable afterwards. */
  dispose(): void {
    this.world.free();
  }

  private constructor(private readonly rng: Rng) {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = SIM.step;
    this.world.lengthUnit = 100; // centimeters
    this.world.numSolverIterations = 6;
    // Default 0.02 × lengthUnit = 2 cm of contact prediction: a ball between two pegs sat inside both bands and the
    // solver held it in mid-air. 0.2 cm is ample for these speeds.
    this.world.integrationParameters.normalizedPredictionDistance = 0.002;

    this.buildTray();
    this.buildBoard();

    const pusherDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PUSHER.height / 2, this.pusherFront - PUSHER.depth / 2);
    this.pusher = this.world.createRigidBody(pusherDesc);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(TRAY.halfWidth - 0.05, PUSHER.height / 2, PUSHER.depth / 2).setFriction(0.5),
      this.pusher,
    );

    this.fillTray();
    // Settle the initial pile with the pusher parked (time stays 0, so its first stroke starts from here).
    for (let i = 0; i < 360; i++) {
      this.world.step();
      this.classify();
    }
  }

  queueDrop(kind: BodyKind, count = 1): void {
    for (let i = 0; i < count; i++) this.dropQueue.push(kind);
  }

  /** Launches a shot from a random entry along the top: players cannot steer shots on the source cabinet. */
  spawnShot(): void {
    const x = this.rng.range(-BOARD.halfWidth + 4, BOARD.halfWidth - 4);
    const body = this.addBody('ball', x, BOARD.launchY, BOARD.z, true);
    body.setLinvel({ x: this.rng.range(-60, 60), y: -40, z: 0 }, true);
  }

  /** Advances one fixed step and reports slot hits and tray exits. */
  step(): SimEvent[] {
    this.time += SIM.step;
    const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * this.time) / PUSHER.period);
    this.pusherFront = PUSHER.frontMin + (PUSHER.frontMax - PUSHER.frontMin) * phase;
    this.pusher.setNextKinematicTranslation({ x: 0, y: PUSHER.height / 2, z: this.pusherFront - PUSHER.depth / 2 });

    this.dropCooldown -= SIM.step;
    const next = this.dropQueue[0];
    if (next !== undefined && this.dropCooldown <= 0) {
      this.dropQueue.shift();
      this.dropCooldown = DROP_INTERVAL;
      this.addBody(next, this.rng.range(-TRAY.halfWidth + 5, TRAY.halfWidth - 5), 20, this.rng.range(-11, -2), false);
    }

    this.world.step();
    return this.classify();
  }

  private classify(): SimEvent[] {
    const events: SimEvent[] = [];
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const t = this.bodies[i]!;
      const p = t.body.translation();
      let event: SimEvent | null = null;
      if (t.inBoard) {
        if (p.y < BOARD.binFloor + BALL_RADIUS + 1.2) {
          const index = Math.min(SLOTS.length - 1, Math.max(0, Math.floor((p.x + BOARD.halfWidth) / SLOT_WIDTH)));
          event = { type: 'slot', index };
        } else {
          this.unstick(t);
        }
      } else if (p.y < EXIT_Y) {
        event = p.z > TRAY.front ? { type: 'frontExit', kind: t.kind } : { type: 'sideExit', kind: t.kind };
      }
      if (event) {
        events.push(event);
        this.world.removeRigidBody(t.body);
        this.bodies[i] = this.bodies[this.bodies.length - 1]!;
        this.bodies.pop();
      }
    }
    return events;
  }

  /**
   * Rapier occasionally cradles a board ball on a peg flank (predicted contacts with no real second support).
   * Like cabinet vibration, kick it free; if it keeps settling back, drop it straight into the bin below so every
   * shot still resolves to the slot under where it stalled.
   */
  private unstick(t: Tracked): void {
    const v = t.body.linvel();
    t.stillFor = v.x * v.x + v.y * v.y < 4 ? t.stillFor + SIM.step : 0;
    if (t.stillFor < 0.6) return;
    t.stillFor = 0;
    t.kicks++;
    if (t.kicks < 3) {
      t.body.setLinvel({ x: this.rng.sign() * 60, y: 20, z: 0 }, true);
      return;
    }
    const p = t.body.translation();
    const slot = Math.min(SLOTS.length - 1, Math.max(0, Math.floor((p.x + BOARD.halfWidth) / SLOT_WIDTH)));
    t.body.setTranslation({ x: -BOARD.halfWidth + (slot + 0.5) * SLOT_WIDTH, y: BOARD.binTop + BALL_RADIUS + 0.5, z: BOARD.z }, true);
    t.body.setLinvel({ x: 0, y: -50, z: 0 }, true);
  }

  private addBody(kind: BodyKind, x: number, y: number, z: number, inBoard: boolean): RAPIER.RigidBody {
    const pearl = kind === 'pearl';
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(inBoard ? 0.05 : 0.4)
      // No CCD for board balls. Peak speed (~3 cm/step) is below the 5.2 cm a ball needs to clear a peg, and both
      // CCD modes stall the board: hard CCD freezes touching bodies; soft CCD's predictive contacts cradle balls in mid-air.
      .setAngularDamping(0.6);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(pearl ? PEARL_RADIUS : BALL_RADIUS)
        .setDensity(pearl ? 0.35 : 0.08)
        .setFriction(0.35)
        .setRestitution(inBoard ? 0.55 : 0.25)
        // Board balls ignore each other: two-ball arches between pegs otherwise jam the board.
        .setCollisionGroups(inBoard ? BOARD_BALL_GROUPS : 0xffffffff),
      body,
    );
    this.bodies.push({ body, kind, inBoard, stillFor: 0, kicks: 0 });
    return body;
  }

  private addStaticBox(hx: number, hy: number, hz: number, x: number, y: number, z: number): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.4).setRestitution(0.2), body);
  }

  private buildTray(): void {
    const hw = TRAY.halfWidth;
    const depth = TRAY.front - TRAY.floorBack;
    const midZ = (TRAY.front + TRAY.floorBack) / 2;
    this.addStaticBox(hw, 1, depth / 2, 0, -1, midZ);
    // Tall walls beside the pusher; low rails along the tray stop short of the front corners, where balls fall off the sides.
    const tallBack = TRAY.floorBack;
    const tallFront = -2;
    const railFront = TRAY.front - TRAY.openCorner;
    for (const side of [-1, 1]) {
      this.addStaticBox(0.5, 12, (tallFront - tallBack) / 2, side * (hw + 0.5), 12, (tallFront + tallBack) / 2);
      this.addStaticBox(0.4, TRAY.railHeight / 2, (railFront - tallFront) / 2, side * (hw + 0.4), TRAY.railHeight / 2, (railFront + tallFront) / 2);
    }
    this.addStaticBox(hw, 10, 0.3, 0, PUSHER.height + 0.3 + 10, SCRAPER_Z - 0.3);
  }

  private buildBoard(): void {
    const hw = BOARD.halfWidth;
    const halfGap = BOARD.gap / 2;
    const height = BOARD.top - BOARD.binFloor;
    const midY = (BOARD.top + BOARD.binFloor) / 2;
    for (const side of [-1, 1]) {
      this.addStaticBox(hw + 1, height / 2, 0.5, 0, midY, BOARD.z + side * (halfGap + 0.5)); // acrylic panes
      this.addStaticBox(0.5, height / 2, halfGap + 1, side * (hw + 0.5), midY, BOARD.z); // side walls
    }
    this.addStaticBox(hw + 1, 0.5, halfGap + 1, 0, BOARD.top + 0.5, BOARD.z); // cap
    this.addStaticBox(hw + 1, 0.5, halfGap + 1, 0, BOARD.binFloor - 0.5, BOARD.z); // bin floor
    const binHalf = (BOARD.binTop - BOARD.binFloor) / 2;
    for (let i = 1; i < SLOTS.length; i++) {
      this.addStaticBox(0.3, binHalf, halfGap, -hw + i * SLOT_WIDTH, BOARD.binFloor + binHalf, BOARD.z);
    }
    // Rows are centered and alternate between n and n-1 pegs; the outer gap to the walls stays wider than a ball.
    const wide = Math.floor((2 * (hw - 5.2)) / BOARD.pegColSpacing) + 1;
    for (let row = 0; row < BOARD.pegRows; row++) {
      const y = BOARD.pegTopRowY - row * BOARD.pegRowSpacing;
      const count = wide - (row % 2);
      const xs = Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * BOARD.pegColSpacing);
      xs.push(-(hw - 1.2), hw - 1.2); // wall bumpers: no free lane down the sides
      for (const x of xs) {
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, BOARD.z).setRotation(PEG_AXIS_Z));
        this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfGap + 0.5, BOARD.pegRadius).setRestitution(0.5), body);
        this.pegs.push({ x, y });
      }
    }
  }

  /** Pearls sit on the floor first; white balls pack around them back-to-front so the pile starts behind the edge. */
  private fillTray(): void {
    const pearls: { x: number; z: number }[] = [];
    for (let i = 0; i < TRAY.initialPearls; i++) {
      const x = -18 + i * 12 + this.rng.range(-2, 2);
      const z = this.rng.range(PUSHER.frontMax + PEARL_RADIUS + 2, 10);
      this.addBody('pearl', x, PEARL_RADIUS + 0.05, z, false);
      pearls.push({ x, z });
    }
    const spacing = BALL_RADIUS * 2.1;
    const cols = Math.floor((2 * TRAY.halfWidth - 2) / spacing);
    const clear = PEARL_RADIUS + BALL_RADIUS + 0.2;
    let placed = 0;
    for (let layer = 0; placed < TRAY.initialBalls; layer++) {
      for (let z = PUSHER.frontMax + BALL_RADIUS + 1; z < TRAY.front - 2 && placed < TRAY.initialBalls; z += spacing) {
        for (let c = 0; c < cols && placed < TRAY.initialBalls; c++) {
          const x = -TRAY.halfWidth + 1 + spacing / 2 + c * spacing + (layer % 2) * (spacing / 2) * 0.5;
          const y = BALL_RADIUS + 0.1 + layer * spacing;
          if (layer === 0 && pearls.some((p) => Math.hypot(p.x - x, p.z - z) < clear)) continue;
          this.addBody('ball', x, y, z, false);
          placed++;
        }
      }
    }
  }
}
