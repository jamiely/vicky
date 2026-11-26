// All tunables. Geometry is in centimeters; time in seconds. Evidence for rule values: REQUIREMENTS.md.

export type PocketColor = 'green' | 'red' | 'yellow';
export type SlotKind = 'ball' | 'ticket' | 'lucky';

/** Rule tunables. Mutable so the debug menu can change them live (rules read these on every call). */
export const RULES = {
  jackpotBase: 1200,
  /** The jackpot grows by one every this many shots (the source counter rose ~20 in a few minutes of play). */
  jackpotShots: 10,
  // Ladder pace is tuned, not observed: 8 steps with knockback 2 at 2 shots/s yields ~15 Ball Parties/hour
  // (~13% of play), close to the ~4 seen in the 14-minute source video. Shorter ladders keep a party running >50% of the time.
  ladderSteps: 8,
  ladderKnockback: 2,
  /** Contains the contiguous run 15·20·25·?·40 visible on the source LCD. */
  ticketLadder: [8, 10, 12, 15, 20, 25, 30, 40],
  /**
   * Pearls are a fixed set that circulates (tray → disk → tower lift → reserve → LUCKY → tray), as on the source
   * cabinet where pearls ride back up the clear tower ([F 04:41], [F 10:13]). Total in play = this + TRAY.initialPearls.
   */
  pearlReserveStart: 4,
  // Each BALL hit is ~0.39 balls pushed off per dropped ball (measured, 4 seeds × 10 min). At 2 per hit a shot returns
  // ~0.8 balls: a slow drain that Ball Parties (double balls, ~1.6) push back up. At 3 no run went broke; at 5 never.
  ballsPerBallHit: 2,
  partySeconds: 31,
  pocketPay: {
    normal: { green: 40, red: 60, yellow: 120 },
    party: { green: 180, red: 300 }, // yellow during Ball Party pays the progressive jackpot
  },
};

/** Left-to-right slot row under the peg board, as printed on the cabinet. */
/**
 * Free-play run: a bankroll of balls. Measured with the real physics (8 seeds): runs last 2:10–4:50, median ~3:50;
 * 5 of 8 reached Last Call, the rest went broke earlier. A start of 60 gave a ~2:30 median.
 */
export const RUN = {
  startStock: 80,
  stockCap: 99,
  /** Front-edge refills stop here; shoot out what's left. */
  lastCallSeconds: 240,
  /** Out of balls with the board empty: tray spills in this window revive the run. */
  suddenDeathSeconds: 6,
  /** Final push after the last ball: at least this long, then until pearls on the disk have paid (capped). */
  sweepSeconds: 4,
  sweepMaxSeconds: 15,
  /** Pusher stroke rate during the sweep. */
  sweepPusherSpeed: 2.5,
  /** A press is ignored this long after a run ends, so a held launch doesn't skip the result. */
  overLockSeconds: 1.5,
  lowStock: 10,
};

export const SLOTS: readonly SlotKind[] = ['ball', 'ticket', 'ball', 'lucky', 'ticket', 'ball', 'ticket'];

export const BALL_RADIUS = 2.0; // 40 mm ping-pong ball
export const PEARL_RADIUS = 3.6;
export const GRAVITY = -981;

export const TRAY = {
  halfWidth: 30,
  front: 22, // z of the open front edge (toward the player)
  floorBack: -34,
  railHeight: 1.6, // below a ball's center: crowded balls can spill over the sides
  openCorner: 7, // rail-free length at each front corner; balls there fall off the side (a loss)
  initialBalls: 64, // roughly the steady-state pile: one layer ahead of the pusher's full stroke
  initialPearls: 4,
};

export const PUSHER = {
  height: 6,
  depth: 18,
  frontMin: -14, // retracted front-face z
  frontMax: -3, // extended front-face z
  period: 3.2,
};

/** Scraper wall above the pusher; riders are swept off when the pusher retracts. */
export const SCRAPER_Z = -14.6;

export const BOARD = {
  z: -40, // center plane of the peg board
  gap: 4.8, // inner distance between the acrylic panes
  halfWidth: 30,
  top: 82,
  binTop: 22, // top of the slot dividers; ≥ 2 ball diameters below the last peg row avoids wedging
  binFloor: 15,
  pegRadius: 0.6,
  pegRows: 8,
  pegRowSpacing: 6.2,
  pegColSpacing: 7.4,
  pegTopRowY: 74,
  launchY: 79,
};

export const DISK = {
  // Below the tray (as on the cabinet, the bowl sits lower at the front-right) so the gutter → chute runs downhill.
  center: { x: 60, y: -16, z: 18 },
  radius: 14,
  grooveRadius: 10,
  holeRadius: 2.9,
  spin: 0.9, // rad/s
  pockets: ['yellow', 'green', 'red', 'green', 'red', 'green'] as readonly PocketColor[],
  entryAngle: Math.PI, // world angle (around +y) where the chute delivers pearls: the side facing the tray
  entrySpeed: [2.5, 5.5] as const, // rad/s relative to the disk, random sign
  decay: 0.9, // 1/s exponential decay of relative angular speed
  creep: 0.35, // rad/s floor; must stay below captureSpeed so every pearl settles
  captureSpeed: 1.2,
  chuteSeconds: 0.9,
  sinkSeconds: 1.2,
  liftSeconds: 3.5,
  releaseSeconds: 1.1,
};

/**
 * Clear pearl tower beside the tray (behind the disk bowl). Pearls ride a lift up its axis and hang in a stack below
 * the top cap; LUCKY releases the bottom pearl down the axis and through a short tube onto the tray.
 */
export const TOWER = {
  x: DISK.center.x + 2,
  z: DISK.center.z - 26,
  baseY: -2,
  height: 120,
  radiusBottom: 13,
  radiusTop: 9,
  /** Height of the lowest point of the reserve stack's top cap (index-0 pearl touches it). */
  stackTopY: 112,
  /** Where released pearls leave the tube above the tray's back-right corner (over the pusher top). */
  releaseExit: { x: TRAY.halfWidth - 5, y: 14, z: -6 },
  /** Height at which the release tube branches off the tower axis toward the tray. */
  releaseTubeY: 14,
};

export const SIM = {
  step: 1 / 120,
  maxStepsPerFrame: 8,
  autoFireInterval: 0.5,
};
