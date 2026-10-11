// All tunables. Geometry is in centimeters; time in seconds. Evidence for rule values: REQUIREMENTS.md.

export type PocketColor = 'green' | 'red' | 'yellow';
export type SlotKind = 'ball' | 'ticket' | 'lucky';

export const RULES = {
  startCredits: 10,
  shotsPerCredit: 10,
  jackpotBase: 1200,
  jackpotPerCredit: 1,
  // Ladder pace is tuned, not observed: 8 steps with knockback 2 at 2 shots/s yields ~15 Ball Parties/hour
  // (~13% of play), close to the ~4 seen in the 14-minute source video. Shorter ladders keep a party running >50% of the time.
  ladderSteps: 8,
  ladderKnockback: 2,
  /** Contains the contiguous run 15·20·25·?·40 visible on the source LCD. */
  ticketLadder: [8, 10, 12, 15, 20, 25, 30, 40] as const,
  /** "BIG BALL LUCKY" is a chance: a guaranteed pearl would flood the tray at ~2% of shots per pearl budget. */
  luckyPearlChance: 0.15,
  ballsPerBallHit: 5,
  partySeconds: 31,
  pocketPay: {
    normal: { green: 40, red: 60, yellow: 120 },
    party: { green: 180, red: 300 }, // yellow during Ball Party pays the progressive jackpot
  },
} as const;

/** Left-to-right slot row under the peg board, as printed on the cabinet. */
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
  center: { x: 44, y: -4, z: 24 },
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
};

export const SIM = {
  step: 1 / 120,
  maxStepsPerFrame: 8,
  autoFireInterval: 0.5,
};
