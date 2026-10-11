// All tunables. Geometry is in centimeters; time in seconds. Evidence for rule values: REQUIREMENTS.md.

export type PocketColor = 'green' | 'red' | 'yellow';
export type SlotKind = 'ball' | 'ticket' | 'lucky';

export const RULES = {
  startCredits: 10,
  shotsPerCredit: 10,
  jackpotBase: 1200,
  jackpotPerCredit: 1,
  ladderSteps: 5,
  ticketLadder: [15, 20, 25, 30, 40] as const,
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
  initialBalls: 110, // about one layer; more spills during settling
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
  center: { x: 46, y: -8, z: 32 },
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
  autoFireInterval: 0.22,
};
