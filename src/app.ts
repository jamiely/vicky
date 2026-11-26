import './style.css';
import { SoundEngine } from './audio/sound';
import { BOARD, DISK, PUSHER, RULES, RUN, SIM, SLOTS, TOWER, TRAY, type PocketColor, type SlotKind } from './config';
import { Stage } from './render/stage';
import { VIEW, ZOOM_RANGE, type CameraView } from './render/settings';
import { Rng } from './rng';
import { addHighScore, AttractCycle, ButtonLatch, highScores, InitialsEntry, qualifies, type HighScore } from './rules/arcade';
import { GameRules, type Side } from './rules/game';
import { Run, type RunEvent } from './rules/run';
import { PocketDisk } from './sim/disk';
import { PhysicsWorld } from './sim/physics';
import { createDebugMenu, type DebugControls, type DebugNumber, type DebugToggle } from './ui/debugMenu';
import { Hud } from './ui/hud';

/** Seconds the PLAY AGAIN offer stays up after a run (and its high-score entry). */
export const PLAY_AGAIN_SECONDS = 10;
export const SCORES_KEY = 'vicky.scores';
export const JACKPOT_KEY = 'vicky.jackpot';

function parse(json: string | null): unknown {
  try {
    return JSON.parse(json ?? '[]');
  } catch {
    return [];
  }
}

const RUN_NOTICES: Partial<Record<RunEvent, { text: string; tone: 'info' | 'party' | 'loss' | 'win' }>> = {
  lastCall: { text: 'LAST CALL: no more refills', tone: 'party' },
  suddenDeath: { text: 'Out of balls: SUDDEN DEATH', tone: 'loss' },
  revive: { text: 'Saved! A ball came back', tone: 'win' },
  lowStock: { text: `${RUN.lowStock} balls left`, tone: 'loss' },
};

/** A released pearl rolls out of its tube toward the tray (along the tube, toward −x) at a gentle speed. */
const RELEASE_VELOCITY = (() => {
  const dx = TOWER.releaseExit.x - TOWER.x;
  const dz = TOWER.releaseExit.z - TOWER.z;
  const len = Math.hypot(dx, dz);
  return { x: (dx / len) * 40, y: 0, z: (dz / len) * 40 };
})();

export interface GameOptions {
  seed: number;
  /** Mount the debug menu (opened). */
  debug: boolean;
  /** Start the requestAnimationFrame loop; tests drive `frame()` manually instead. */
  autoStart: boolean;
}

/**
 * Page URL → options: `?seed=N` makes the machine reproducible (random otherwise); `?debug` or `?debug=1` mounts the
 * debug menu, `?debug=0` does not.
 */
export function optionsFromUrl(search: string, random: () => number): Omit<GameOptions, 'autoStart'> {
  const params = new URLSearchParams(search);
  const seed = Number(params.get('seed'));
  return {
    seed: params.has('seed') && Number.isFinite(seed) ? seed : Math.floor(random() * 2 ** 31),
    debug: params.has('debug') && params.get('debug') !== '0',
  };
}

/**
 * One playable station: owns the simulation (physics, disk, rules), the view (stage, HUD, LCD), sound, and input, and
 * routes events between them. Time advances in fixed steps; `frame(dt)` is the per-render-frame entry point.
 */
export class Game {
  physics!: PhysicsWorld;
  disk!: PocketDisk;
  rules!: GameRules;
  run = new Run();
  scores: HighScore[] = highScores(parse(localStorage.getItem(SCORES_KEY)));
  initials: InitialsEntry | null = null;
  readonly attract = new AttractCycle(0);
  /** When the PLAY AGAIN offer opened (simulated time); null when not offered. */
  private offerOpened: number | null = null;
  private readonly button = new ButtonLatch();
  private savedJackpot = 0;
  readonly stage: Stage;
  readonly hud: Hud;
  readonly sound = new SoundEngine();
  readonly rng: Rng;
  simTime = 0;
  paused = false;
  timeScale = 1;
  firing = false;
  fps = 0;
  private accumulator = 0;
  private fireCooldown = 0;
  private clock = 0;
  private rafId = 0;
  private lastFrame = 0;
  private readonly cleanups: (() => void)[] = [];

  static async create(root: HTMLElement, options: GameOptions): Promise<Game> {
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Loading physics…';
    root.append(loading);
    const rng = new Rng(options.seed);
    const physics = await PhysicsWorld.create(rng);
    loading.remove();
    const game = new Game(root, rng, physics);
    if (options.debug) {
      const menu = createDebugMenu(document.body, debugControls(game), true);
      game.cleanups.push(() => menu.dispose());
    }
    if (options.autoStart) game.start();
    return game;
  }

  private constructor(private readonly root: HTMLElement, rng: Rng, physics: PhysicsWorld) {
    this.rng = rng;
    this.physics = physics;
    this.disk = new PocketDisk(rng);
    this.rules = new GameRules();
    this.restoreJackpot();
    const viewport = document.createElement('div');
    viewport.id = 'viewport';
    viewport.setAttribute('aria-label', '3D pusher cabinet. Press and hold to launch balls.');
    root.append(viewport);
    this.stage = new Stage(viewport, physics.pegs);
    this.hud = new Hud(root);
    this.bindInput();
  }

  start(): void {
    const loop = (now: number): void => {
      this.rafId = requestAnimationFrame(loop);
      const dt = this.lastFrame === 0 ? 0 : Math.min((now - this.lastFrame) / 1000, 0.1);
      this.lastFrame = now;
      this.frame(dt);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** Advances simulated time by `dt` real seconds (scaled, fixed-step) and renders one frame. */
  frame(dt: number): void {
    if (dt > 0) this.fps = this.fps * 0.9 + (1 / dt) * 0.1;
    this.clock += dt;
    if (!this.paused) {
      this.accumulator += dt * this.timeScale;
      let steps = 0;
      while (this.accumulator >= SIM.step && steps < SIM.maxStepsPerFrame) {
        this.step();
        this.accumulator -= SIM.step;
        steps++;
      }
      if (steps === SIM.maxStepsPerFrame) this.accumulator = 0; // fell behind: drop time instead of spiraling
    }
    for (const notice of this.rules.drainNotices()) this.hud.push(notice);
    if (this.rules.jackpot !== this.savedJackpot) {
      this.savedJackpot = this.rules.jackpot;
      localStorage.setItem(JACKPOT_KEY, String(this.rules.jackpot));
    }
    this.hud.update(this.rules, {
      run: this.run,
      scores: this.scores,
      initials: this.initials,
      continueSeconds: this.continueSeconds,
      attract: this.attract.page,
      now: this.simTime,
    });
    this.sound.update({
      pusherPhase: (this.physics.pusherFront - PUSHER.frontMin) / (PUSHER.frontMax - PUSHER.frontMin),
      ballParty: this.rules.partyEnds.ball !== null,
      ticketParty: this.rules.partyEnds.ticket !== null,
      diskPearls: this.disk.pearls.filter((p) => p.phase === 'rolling').length,
    });
    const run = this.run.active ? { stock: this.run.stock, clock: this.run.clock > 0 ? this.run.clock : null } : null;
    this.stage.update(this.physics, this.disk, this.rules, this.clock, dt, run);
    this.stage.render();
  }

  /** One fixed simulation step: launch, physics, disk, rules, and the sound/LCD cues they trigger. */
  step(): void {
    const parties = { ...this.rules.partyEnds };
    this.simTime += SIM.step;
    this.rules.tick(this.simTime);

    this.fireCooldown -= SIM.step;
    if (this.firing && this.fireCooldown <= 0 && this.run.fire()) {
      this.rules.onShot();
      this.physics.spawnShot();
      this.sound.launch();
      this.fireCooldown = SIM.autoFireInterval;
    }

    for (const event of this.physics.step()) {
      switch (event.type) {
        case 'slot':
          this.applySlot(event.index);
          break;
        case 'frontExit':
          if (event.kind === 'pearl') this.disk.launch(event.at);
          else this.run.ballOut();
          break;
        case 'sideExit':
          if (event.kind === 'pearl') {
            this.rules.notePearlLost();
            this.disk.sendToLift(event.at);
          }
          break;
        case 'impact':
          this.sound.impact(event.kind, event.intensity, Math.max(-1, Math.min(1, event.x / BOARD.halfWidth)));
          break;
      }
    }
    const { pockets, returned, released } = this.disk.step(SIM.step);
    for (const pocket of pockets) this.applyPocket(pocket.color);
    for (let i = 0; i < returned; i++) this.rules.returnPearl();
    // A released pearl leaves the tube moving along it, so physics continues its motion.
    for (let i = 0; i < released; i++) this.physics.spawnPearl(TOWER.releaseExit, RELEASE_VELOCITY);

    this.stepRun();
    for (const side of ['ball', 'ticket'] as const) {
      const before = parties[side];
      const after = this.rules.partyEnds[side];
      if (after !== null && (before === null || after > before)) {
        this.sound.partyStart(side);
        this.stage.flash(side === 'ball' ? 'ballParty' : 'ticketParty', 0);
      } else if (before !== null && after === null) {
        this.sound.partyEnd(side);
      }
    }
  }

  /** Resolves a ball landing in slot `index` (from physics, or forced by the debug menu). */
  applySlot(index: number): void {
    const kind = SLOTS[index]!;
    this.sound.slot(kind);
    const effects = this.rules.onSlot(index);
    for (const effect of effects) {
      if (effect.type === 'dropBalls') this.physics.queueDrop('ball', effect.count);
      else this.disk.release(this.rules.pearlReserve); // the stack's bottom pearl, in the slot just vacated
    }
    if (kind === 'lucky') {
      const won = effects.length > 0;
      this.sound.lucky(won);
      if (won) this.stage.flash('lucky', 0);
    }
  }

  /** Pays a pearl that settled in a pocket of `color`; yellow during Ball Party is the jackpot. */
  applyPocket(color: PocketColor): void {
    const ballParty = this.rules.partyEnds.ball !== null;
    const pay = this.rules.onPocket(color);
    if (ballParty && color === 'yellow') {
      this.sound.jackpot(pay);
      this.stage.flash('jackpot', pay);
    } else {
      this.sound.pocket(color, ballParty);
    }
  }

  /** Forces a party by filling its ladder and resolving one more hit through the normal rules path. */
  startParty(side: Side): void {
    this.rules.ladder[side] = RULES.ladderSteps - 1;
    const parties = { ...this.rules.partyEnds };
    this.applySlot(SLOTS.indexOf(side));
    if (parties[side] === null) {
      this.sound.partyStart(side);
      this.stage.flash(side === 'ball' ? 'ballParty' : 'ticketParty', 0);
    }
  }

  /** Starts a free-play run on the machine as it stands: fresh stock and score, same tray, tower, and jackpot. */
  startRun(): void {
    this.rules.newRun();
    this.run.start(this.simTime);
    this.initials = null;
    this.offerOpened = null;
    this.attract.input(this.simTime);
    this.sound.credit();
    this.hud.push({ text: `Run started: ${RUN.startStock} balls`, tone: 'info' });
  }

  /** Seconds left on the PLAY AGAIN offer, or null when none is open. */
  get continueSeconds(): number | null {
    if (this.offerOpened === null) return null;
    const left = Math.ceil(PLAY_AGAIN_SECONDS - (this.simTime - this.offerOpened));
    return left > 0 ? left : null;
  }

  /** The main button (Space, the cabinet, LAUNCH): fires during a run; otherwise starts one or enters initials. */
  press(repeat = false): void {
    if (!this.button.down(repeat)) return;
    this.attract.input(this.simTime);
    if (this.initials) {
      this.initials.down(this.simTime);
      return;
    }
    if (!this.run.active && this.run.canStart) this.startRun();
    this.firing = this.run.active;
  }

  release(): void {
    this.initials?.up(this.simTime);
    this.button.up();
    this.firing = false;
  }

  /** Advances the run and the between-run flow: initials, the play-again offer, and the attract cycle. */
  private stepRun(): void {
    const boardBalls = this.physics.bodies.reduce((n, b) => n + (b.inBoard ? 1 : 0), 0);
    const settled = !this.disk.pearls.some((p) => p.phase === 'chute' || p.phase === 'rolling');
    this.run.tick(this.simTime, boardBalls, settled, this.rules.tickets);
    for (const event of this.run.drainEvents()) {
      const notice = RUN_NOTICES[event];
      if (notice) this.hud.push(notice);
      if (event === 'sweep') this.physics.pusherSpeed = RUN.sweepPusherSpeed;
      else if (event === 'over') this.finishRun();
      else this.sound.run(event);
    }
    if (this.initials) {
      this.initials.tick(this.simTime);
      if (this.initials.done) {
        this.scores = addHighScore(this.scores, { initials: this.initials.text, score: this.run.finalScore });
        localStorage.setItem(SCORES_KEY, JSON.stringify(this.scores));
        this.initials = null;
        this.offerOpened = this.simTime;
      }
    }
    if (this.offerOpened !== null && this.continueSeconds === null) this.offerOpened = null;
    this.attract.tick(this.simTime, !this.run.active && !this.initials && this.offerOpened === null);
  }

  private finishRun(): void {
    this.physics.pusherSpeed = 1;
    this.firing = false;
    this.rules.endParties();
    this.sound.run('over');
    this.hud.push({ text: `Run over: ${this.run.finalScore.toLocaleString('en-US')}`, tone: 'info' });
    // Free play banks the finished score first; playing again starts the next run at 0.
    if (qualifies(this.scores, this.run.finalScore)) this.initials = new InitialsEntry(this.simTime);
    else this.offerOpened = this.simTime;
  }

  private restoreJackpot(): void {
    const saved = Number(localStorage.getItem(JACKPOT_KEY));
    if (Number.isSafeInteger(saved) && saved >= RULES.jackpotBase) this.rules.jackpot = saved;
    this.savedJackpot = this.rules.jackpot;
  }

  async reset(): Promise<void> {
    const wasPaused = this.paused;
    this.paused = true;
    this.physics.dispose();
    this.physics = await PhysicsWorld.create(this.rng);
    this.rules = new GameRules();
    this.restoreJackpot();
    this.run = new Run();
    this.initials = null;
    this.offerOpened = null;
    this.disk = new PocketDisk(this.rng);
    this.simTime = 0;
    this.accumulator = 0;
    this.firing = false;
    this.paused = wasPaused;
    this.hud.push({ text: 'Machine reset', tone: 'info' });
  }

  /** Multiplies the current layout's zoom by `factor` (< 1 zooms in), kept within the zoom range. */
  zoom(factor: number): void {
    const view = this.stage.view;
    view.zoom = Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, view.zoom * factor));
  }

  setMuted(muted: boolean): void {
    this.sound.setMuted(muted);
    this.hud.setMuted(muted);
    localStorage.setItem('vicky.muted', muted ? '1' : '0');
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    for (const cleanup of this.cleanups) cleanup();
    this.physics.dispose();
    this.sound.close();
    this.stage.dispose();
  }

  private bindInput(): void {
    const listen = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K, handler: (e: HTMLElementEventMap[K]) => void): void => {
      target.addEventListener(type, handler as EventListener);
      this.cleanups.push(() => target.removeEventListener(type, handler as EventListener));
    };
    // Audio may only start from a user gesture.
    listen(window, 'pointerdown', () => this.sound.unlock());
    listen(window, 'keydown', () => this.sound.unlock());

    // Press anywhere on the cabinet, the LAUNCH button, or Space; holding auto-fires. No aiming: on the source
    // cabinet players cannot steer shots ("you don't really have much choice").
    // Zoom: mouse wheel / trackpad pinch (ctrl+wheel) / two-finger pinch on the cabinet / + and − keys.
    const canvas = this.stage.renderer.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchSpread = 0;
    const spread = (): number => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    listen(canvas, 'pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        this.release(); // a second finger means a pinch, not a launch
        pinchSpread = spread();
      } else if (!VIEW.orbit) this.press();
    });
    listen(canvas, 'pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = spread();
      if (pointers.size === 2 && pinchSpread > 0 && now > 0) {
        this.zoom(pinchSpread / now);
        pinchSpread = now;
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      listen(canvas, type, (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchSpread = 0;
        this.release();
      });
      listen(this.hud.launch, type, () => this.release());
    }
    listen(canvas, 'wheel', (e) => {
      if (VIEW.orbit) return; // orbit controls zoom themselves
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    });
    listen(this.hud.launch, 'pointerdown', () => this.press());
    listen(window, 'keydown', (e) => {
      if (e.key === '+' || e.key === '=') this.zoom(1 / 1.15);
      else if (e.key === '-' || e.key === '_') this.zoom(1.15);
    });
    // Free play: the cabinet's C (credit) key does nothing here; holding it to exit is handled by the cabinet.
    listen(window, 'keydown', (e) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      this.press(e.repeat);
    });
    listen(window, 'keyup', (e) => {
      if (e.code === 'Space') this.release();
    });
    listen(window, 'blur', () => this.release());
    // The layout (portrait = vertical cabinet) follows the viewport shape; the HUD restyles via `data-layout`.
    const resize = (): void => {
      this.stage.resize();
      this.root.dataset.layout = this.stage.layout;
    };
    resize();
    listen(window, 'resize', resize);

    listen(this.hud.reset, 'click', () => void this.reset());
    listen(this.hud.mute, 'click', () => this.setMuted(!this.sound.muted));
    this.setMuted(localStorage.getItem('vicky.muted') === '1');
  }
}

type NumberKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T] & string;
type BooleanKeys<T> = { [K in keyof T]: T[K] extends boolean ? K : never }[keyof T] & string;

function num<T, K extends NumberKeys<T>>(obj: T, key: K, label: string, min: number, max: number, step: number, rebuild = false): DebugNumber {
  return { kind: 'number', key, label, min, max, step, rebuild, get: () => obj[key] as number, set: (v) => (obj[key] = v as T[K]) };
}

function toggle<T, K extends BooleanKeys<T>>(obj: T, key: K, label: string): DebugToggle {
  return { kind: 'toggle', key, label, get: () => obj[key] as boolean, set: (v) => (obj[key] = v as T[K]) };
}

/** Debug menu wiring: live tunables, rebuild-on-reset tunables, cheats, and stats. */
export function debugControls(game: Game): DebugControls {
  const slot = (kind: SlotKind): number => SLOTS.indexOf(kind);
  // Camera rows edit whichever layout is showing (resize the window to tune the other one).
  const cam = (key: NumberKeys<CameraView>, label: string, min: number, max: number, step: number): DebugNumber => ({
    kind: 'number',
    key,
    label,
    min,
    max,
    step,
    get: () => game.stage.view[key],
    set: (v) => (game.stage.view[key] = v),
  });
  const r = VIEW.render;
  return {
    groups: [
      {
        title: 'Camera (current layout)',
        params: [
          cam('zoom', 'Zoom ×', ZOOM_RANGE.min, ZOOM_RANGE.max, 0.01),
          cam('pitch', 'Pitch °', -10, 80, 0.5),
          cam('yaw', 'Yaw °', -80, 80, 0.5),
          cam('targetX', 'Target X', -60, 80, 0.5),
          cam('targetY', 'Target Y', -20, 120, 0.5),
          cam('targetZ', 'Target Z', -60, 40, 0.5),
          cam('fov', 'FOV °', 15, 90, 1),
          cam('fitHalfWidth', 'Fit half width', 20, 160, 1),
          cam('fitHalfHeight', 'Fit half height', 20, 200, 1),
          toggle(VIEW, 'orbit', 'Free orbit (mouse)'),
        ],
      },
      {
        title: 'Render',
        params: [
          num(r, 'exposure', 'Exposure', 0.2, 3, 0.01),
          toggle(r, 'bloom', 'Bloom'),
          num(r, 'bloomStrength', 'Bloom strength', 0, 3, 0.01),
          num(r, 'bloomRadius', 'Bloom radius', 0, 1.5, 0.01),
          num(r, 'bloomThreshold', 'Bloom threshold', 0, 1, 0.01),
          toggle(r, 'shadows', 'Shadows'),
          num(r, 'environment', 'Reflections', 0, 3, 0.01),
          num(VIEW.leds, 'speed', 'LED chase speed', 0, 5, 0.05),
          num(VIEW.leds, 'brightness', 'LED brightness', 0, 4, 0.05),
        ],
      },
      {
        title: 'Simulation',
        params: [
          num(game, 'timeScale', 'Time scale', 0, 4, 0.05),
          toggle(game, 'paused', 'Paused'),
          num(SIM, 'autoFireInterval', 'Auto-fire interval s', 0.05, 2, 0.01),
          num(PUSHER, 'period', 'Pusher period s', 0.5, 10, 0.1),
          num(DISK, 'spin', 'Disk spin rad/s', -4, 4, 0.05),
          num(DISK, 'decay', 'Pearl roll decay', 0.05, 4, 0.05),
        ],
      },
      {
        title: 'Rules',
        params: [
          num(RULES, 'ladderSteps', 'Ladder steps', 2, 8, 1),
          num(RULES, 'ladderKnockback', 'Ladder knockback', 0, 4, 1),
          num(RULES, 'ballsPerBallHit', 'Balls per BALL hit', 0, 30, 1),
          num(RULES, 'partySeconds', 'Party seconds', 5, 120, 1),
          num(RULES, 'jackpotShots', 'Shots per jackpot +1', 1, 100, 1),
          num(RULES.pocketPay.normal, 'green', 'Green pays', 0, 1000, 5),
          num(RULES.pocketPay.normal, 'red', 'Red pays', 0, 1000, 5),
          num(RULES.pocketPay.normal, 'yellow', 'Yellow pays', 0, 2000, 5),
          num(RULES.pocketPay.party, 'green', 'Party green pays', 0, 2000, 5),
          num(RULES.pocketPay.party, 'red', 'Party red pays', 0, 2000, 5),
        ],
      },
      {
        title: 'Run',
        params: [
          num(RUN, 'startStock', 'Starting balls', 1, 99, 1),
          num(RUN, 'stockCap', 'Ball cap', 1, 999, 1),
          num(RUN, 'lastCallSeconds', 'Last Call at s', 10, 900, 5),
          num(RUN, 'suddenDeathSeconds', 'Sudden death s', 0, 30, 0.5),
        ],
      },
      {
        title: 'Machine (on reset)',
        collapsed: true,
        params: [
          num(TRAY, 'initialBalls', 'Starting balls', 0, 300, 1, true),
          num(TRAY, 'initialPearls', 'Starting tray pearls', 0, 12, 1, true),
          num(RULES, 'pearlReserveStart', 'Starting tower pearls', 0, 12, 1, true),
          num(RULES, 'jackpotBase', 'Jackpot base', 0, 9999, 1, true),
        ],
      },
    ],
    actions: [
      { label: 'Pause / resume', group: 'Time', run: () => (game.paused = !game.paused) },
      { label: 'Step', group: 'Time', run: () => game.step() },
      { label: 'Start run', group: 'Game', run: () => game.startRun() },
      { label: '+20 balls', group: 'Game', run: () => (game.run.stock = Math.min(RUN.stockCap, game.run.stock + 20)) },
      { label: 'Empty stock', group: 'Game', run: () => (game.run.stock = 0) },
      { label: 'Last Call now', group: 'Game', run: () => game.run.callLast() },
      { label: 'Reset machine', group: 'Game', run: () => void game.reset() },
      { label: 'Force BALL', group: 'Slots', run: () => game.applySlot(slot('ball')) },
      { label: 'Force TICKET', group: 'Slots', run: () => game.applySlot(slot('ticket')) },
      { label: 'Force LUCKY', group: 'Slots', run: () => game.applySlot(slot('lucky')) },
      { label: 'Drop 10 balls', group: 'Tray', run: () => game.physics.queueDrop('ball', 10) },
      // Adds a pearl outside the circulating set (for testing pushes); LUCKY releases come from the tower instead.
      { label: 'Drop extra pearl', group: 'Tray', run: () => game.physics.queueDrop('pearl') },
      { label: 'Ball Party', group: 'Party', run: () => game.startParty('ball') },
      { label: 'Ticket Party', group: 'Party', run: () => game.startParty('ticket') },
      { label: 'Pearl → yellow', group: 'Party', run: () => game.applyPocket('yellow') },
    ],
    lights: game.stage.debugLights(),
    stats: () => {
      const bodies = game.physics.bodies;
      const board = bodies.filter((b) => b.inBoard).length;
      const pearls = bodies.filter((b) => b.kind === 'pearl').length;
      return `${game.fps.toFixed(0)} fps · ${bodies.length} bodies (${board} board, ${pearls} tray pearls) · disk ${game.disk.pearls.length} · tower ${game.rules.pearlReserve} · t ${game.simTime.toFixed(1)}s`;
    },
  };
}
