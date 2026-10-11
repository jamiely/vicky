import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CREDIT_BATCH, debugControls, Game } from './app';
import { DISK, RULES, SIM, SLOTS, TOWER, TRAY } from './config';
import { VIEW, ZOOM_RANGE } from './render/settings';

const games: Game[] = [];
const viewDefaults = structuredClone(VIEW);

async function boot(options: Partial<{ debug: boolean; autoStart: boolean; width: number; height: number }> = {}): Promise<{ game: Game; root: HTMLElement }> {
  const root = document.createElement('main');
  root.style.cssText = `position:fixed;inset:0;width:${options.width ?? 1280}px;height:${options.height ?? 800}px`;
  document.body.append(root);
  const game = await Game.create(root, { seed: 3, debug: options.debug ?? false, autoStart: options.autoStart ?? false });
  games.push(game);
  return { game, root };
}

const steps = (game: Game, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / SIM.step); i++) game.step();
};
const key = (type: 'keydown' | 'keyup', code: string): boolean => window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : code }));
const pointer = (target: EventTarget, type: string): boolean => target.dispatchEvent(new PointerEvent(type, { bubbles: true }));
const feed = (root: HTMLElement): string[] => [...root.querySelectorAll('.feed li')].map((li) => li.textContent!);

afterEach(() => {
  for (const g of games.splice(0)) g.dispose();
  document.body.innerHTML = '';
  localStorage.removeItem('vicky.muted');
  Object.assign(VIEW.camera, viewDefaults.camera);
  Object.assign(VIEW.render, viewDefaults.render);
  vi.restoreAllMocks();
});

describe('Game boot and rendering', () => {
  it('builds the cabinet canvas and HUD and keeps the HUD in sync with the rules', async () => {
    const { game, root } = await boot();
    game.rules.addCredits(3);
    game.frame(1 / 60);
    expect(root.querySelector('#viewport canvas')).not.toBeNull();
    expect(root.querySelector('.hud-top strong')!.textContent).toBe(String(RULES.startCredits + 3));
  });

  it('applies view settings live: exposure, shadows, bloom, environment', async () => {
    const { game } = await boot();
    VIEW.render.exposure = 1.7;
    VIEW.render.shadows = false;
    VIEW.render.bloom = false;
    game.frame(1 / 60);
    expect(game.stage.renderer.toneMappingExposure).toBe(1.7);
    expect(game.stage.renderer.shadowMap.enabled).toBe(false);
  });

  it('backs the camera off on portrait screens so the cabinet width still fits', async () => {
    const wide = await boot({ width: 1280, height: 800 });
    wide.game.frame(1 / 60);
    const narrow = await boot({ width: 390, height: 844 });
    narrow.game.stage.resize();
    narrow.game.frame(1 / 60);
    const dist = (g: Game): number => g.stage.camera.position.distanceTo(g.stage.orbit.target);
    expect(dist(narrow.game)).toBeGreaterThan(dist(wide.game) * 1.5);
  });

  it('hands the camera to orbit controls in orbit mode and stops canvas presses from firing', async () => {
    const { game } = await boot();
    VIEW.camera.orbit = true;
    game.frame(1 / 60);
    expect(game.stage.orbit.enabled).toBe(true);
    // Real pointer (Playwright): OrbitControls captures the pointer, which synthetic events cannot provide.
    const canvas = game.stage.renderer.domElement;
    let firingDuringPress = true;
    canvas.addEventListener('pointerdown', () => (firingDuringPress = game.firing));
    await userEvent.click(canvas);
    expect(firingDuringPress).toBe(false);
  });

  it('runs its own animation loop once started and stops on dispose', async () => {
    const { game } = await boot({ autoStart: true });
    for (let i = 0; i < 6; i++) await new Promise<number>((r) => requestAnimationFrame(r));
    expect(game.simTime).toBeGreaterThan(0);
    game.dispose();
    games.splice(games.indexOf(game), 1);
    const t = game.simTime;
    await new Promise<number>((r) => requestAnimationFrame(r));
    expect(game.simTime).toBe(t);
  });

  it('a party lights the LCD flash and expires it after a few seconds of frames', async () => {
    const { game } = await boot();
    game.startParty('ball');
    for (let i = 0; i < 5; i++) game.frame(1);
    expect(game.rules.partyEnds.ball).not.toBeNull();
  });
});

describe('zoom', () => {
  const wheel = (game: Game, deltaY: number, ctrlKey = false): boolean =>
    game.stage.renderer.domElement.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey, bubbles: true, cancelable: true }));
  const touch = (game: Game, type: string, pointerId: number, clientX: number): boolean =>
    game.stage.renderer.domElement.dispatchEvent(new PointerEvent(type, { pointerId, clientX, clientY: 300, bubbles: true }));

  it('the mouse wheel zooms in and out within limits, and moves the camera', async () => {
    const { game } = await boot();
    game.frame(0);
    const far = game.stage.camera.position.distanceTo(game.stage.orbit.target);
    expect(wheel(game, -300)).toBe(false); // handled: page does not scroll
    game.frame(0);
    expect(VIEW.camera.distance).toBeLessThan(viewDefaults.camera.distance);
    expect(game.stage.camera.position.distanceTo(game.stage.orbit.target)).toBeLessThan(far);
    for (let i = 0; i < 50; i++) wheel(game, -300);
    expect(VIEW.camera.distance).toBe(ZOOM_RANGE.min);
    for (let i = 0; i < 50; i++) wheel(game, 300);
    expect(VIEW.camera.distance).toBe(ZOOM_RANGE.max);
  });

  it('a trackpad pinch (ctrl+wheel) zooms faster than a wheel notch', async () => {
    const { game } = await boot();
    wheel(game, -20);
    const notch = viewDefaults.camera.distance - VIEW.camera.distance;
    VIEW.camera.distance = viewDefaults.camera.distance;
    wheel(game, -20, true);
    expect(viewDefaults.camera.distance - VIEW.camera.distance).toBeGreaterThan(notch * 3);
  });

  it('+ and − keys zoom in and out', async () => {
    const { game } = await boot();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    expect(VIEW.camera.distance).toBeCloseTo(viewDefaults.camera.distance / 1.15);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    expect(VIEW.camera.distance).toBeCloseTo(viewDefaults.camera.distance * 1.15);
    expect(game.firing).toBe(false);
  });

  it('a two-finger pinch zooms by the change in finger spread and cancels the launch the first finger started', async () => {
    const { game } = await boot();
    touch(game, 'pointerdown', 1, 100);
    expect(game.firing).toBe(true);
    touch(game, 'pointerdown', 2, 200);
    expect(game.firing).toBe(false);
    touch(game, 'pointermove', 2, 300); // spread 100 → 200: zoom in 2×
    expect(VIEW.camera.distance).toBeCloseTo(viewDefaults.camera.distance / 2);
    touch(game, 'pointermove', 9, 50); // unknown pointer: ignored
    touch(game, 'pointerup', 2, 300);
    touch(game, 'pointermove', 1, 400); // one finger left: no zoom
    expect(VIEW.camera.distance).toBeCloseTo(viewDefaults.camera.distance / 2);
    touch(game, 'pointerup', 1, 400);
  });

  it('leaves the wheel to orbit controls in orbit mode', async () => {
    const { game } = await boot();
    VIEW.camera.orbit = true;
    wheel(game, -300);
    expect(VIEW.camera.distance).toBe(viewDefaults.camera.distance);
  });
});

describe('time control', () => {
  it('pause freezes simulation; time scale speeds it up; long frames are capped', async () => {
    const { game } = await boot();
    game.paused = true;
    game.frame(0.05);
    expect(game.simTime).toBe(0);
    game.paused = false;
    game.timeScale = 2;
    game.frame(0.026); // ×2 = 0.052 s → 6 fixed steps
    expect(game.simTime).toBeCloseTo(6 * SIM.step, 6);
    game.timeScale = 1;
    const before = game.simTime;
    game.frame(1); // would be 120 steps; capped
    expect(game.simTime - before).toBeCloseTo(SIM.maxStepsPerFrame * SIM.step, 6);
  });
});

describe('launching', () => {
  it('holding Space fires at the auto-fire rate and releasing stops', async () => {
    const { game } = await boot();
    const launch = vi.spyOn(game.sound, 'launch');
    key('keydown', 'Space');
    steps(game, SIM.autoFireInterval * 2 + 0.05);
    key('keyup', 'Space');
    steps(game, 1);
    expect(launch).toHaveBeenCalledTimes(3);
    expect(game.rules.credits).toBe(RULES.startCredits - 1);
    expect(game.rules.shots).toBe(RULES.shotsPerCredit - 3);
  });

  it('pressing the cabinet or the LAUNCH button fires; release, leaving, or losing focus stops', async () => {
    const { game } = await boot();
    pointer(game.stage.renderer.domElement, 'pointerdown');
    expect(game.firing).toBe(true);
    pointer(game.stage.renderer.domElement, 'pointerleave');
    expect(game.firing).toBe(false);
    pointer(game.hud.launch, 'pointerdown');
    expect(game.firing).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(game.firing).toBe(false);
    key('keydown', 'KeyA'); // other keys do nothing
    expect(game.firing).toBe(false);
  });

  it('stops firing and tells the player when credits run out', async () => {
    const { game, root } = await boot();
    game.rules.credits = 0;
    game.firing = true;
    game.step();
    expect(game.firing).toBe(false);
    expect(feed(root)[0]).toBe(`Out of credits: press +${CREDIT_BATCH} CREDITS`);
  });

  it('shots fall through the pegs with peg-click sounds and resolve in slots', async () => {
    const { game } = await boot();
    const impact = vi.spyOn(game.sound, 'impact');
    const slot = vi.spyOn(game.sound, 'slot');
    game.firing = true;
    steps(game, 2);
    game.firing = false;
    steps(game, 3);
    expect(impact.mock.calls.some(([kind]) => kind === 'peg')).toBe(true);
    expect(impact.mock.calls.every(([, intensity, pan]) => intensity > 0 && intensity <= 1 && Math.abs(pan) <= 1)).toBe(true);
    expect(slot).toHaveBeenCalledTimes(RULES.shotsPerCredit - game.rules.shots);
  });
});

describe('slots, pearls, and parties', () => {
  it('BALL drops balls onto the tray', async () => {
    const { game } = await boot();
    const before = game.physics.bodies.length;
    game.applySlot(SLOTS.indexOf('ball'));
    steps(game, 1);
    expect(game.physics.bodies.length).toBe(before + RULES.ballsPerBallHit);
  });

  it('LUCKY releases a tower pearl with a flash, and only plays the miss cue when the tower is empty', async () => {
    const { game } = await boot();
    const lucky = vi.spyOn(game.sound, 'lucky');
    const flash = vi.spyOn(game.stage, 'flash');
    const pearls = (): number => game.physics.bodies.filter((b) => b.kind === 'pearl').length;
    const before = pearls();
    const total = before + game.rules.pearlReserve;
    game.applySlot(SLOTS.indexOf('lucky'));
    // The bottom tower pearl rides down the release tube (still drawn) and appears on the tray exactly at the exit.
    steps(game, DISK.releaseSeconds / 2);
    game.frame(0);
    expect(game.stage.pearlsDrawn).toBe(total);
    expect(pearls()).toBe(before);
    steps(game, DISK.releaseSeconds / 2 + SIM.step);
    expect(pearls()).toBe(before + 1);
    const spawned = game.physics.bodies.filter((b) => b.kind === 'pearl').at(-1)!.body.translation();
    expect(Math.hypot(spawned.x - TOWER.releaseExit.x, spawned.y - TOWER.releaseExit.y, spawned.z - TOWER.releaseExit.z)).toBeLessThan(2);
    expect(lucky).toHaveBeenLastCalledWith(true);
    expect(flash).toHaveBeenCalledWith('lucky', 0);
    game.rules.pearlReserve = 0;
    game.applySlot(SLOTS.indexOf('lucky'));
    expect(lucky).toHaveBeenLastCalledWith(false);
  });

  it('a pearl pushed off the front rides the disk, pays, lifts, and returns to the tower', async () => {
    const { game } = await boot();
    const pocket = vi.spyOn(game.sound, 'pocket');
    const pearl = game.physics.bodies.find((b) => b.kind === 'pearl')!;
    pearl.body.setTranslation({ x: 0, y: -10, z: TRAY.front + 3 }, true);
    const reserve = game.rules.pearlReserve;
    const tickets = game.rules.tickets;
    const total = game.physics.bodies.filter((b) => b.kind === 'pearl').length + reserve;
    steps(game, SIM.step * 2);
    expect(game.disk.pearls).toHaveLength(1);
    // Walk the pearl through every phase, rendering at each: it must stay drawn somewhere the whole way.
    const phases = new Set<string>();
    for (let t = 0; t < DISK.chuteSeconds + 12 + DISK.sinkSeconds + DISK.liftSeconds; t += 0.25) {
      steps(game, 0.25);
      game.frame(0);
      phases.add(game.disk.pearls[0]?.phase ?? 'tower');
      expect(game.stage.pearlsDrawn).toBe(total);
    }
    expect([...phases]).toEqual(expect.arrayContaining(['chute', 'rolling', 'sunk', 'lift', 'tower']));
    expect(pocket).toHaveBeenCalledTimes(1);
    expect(game.rules.tickets).toBeGreaterThan(tickets);
    expect(game.rules.pearlReserve).toBe(reserve + 1);
  });

  it('a pearl lost off a side pays nothing but still returns to the tower', async () => {
    const { game, root } = await boot();
    const pearl = game.physics.bodies.find((b) => b.kind === 'pearl')!;
    pearl.body.setTranslation({ x: TRAY.halfWidth + 6, y: -10, z: 0 }, true);
    const reserve = game.rules.pearlReserve;
    steps(game, DISK.liftSeconds + 0.1);
    game.frame(0);
    expect(game.rules.pearlReserve).toBe(reserve + 1);
    expect(feed(root)).toContain('Pearl lost down the side');
  });

  it('forcing a party starts it with a fanfare once, and its end plays the closing cue', async () => {
    const { game } = await boot();
    const start = vi.spyOn(game.sound, 'partyStart');
    const end = vi.spyOn(game.sound, 'partyEnd');
    game.startParty('ticket');
    expect(game.rules.partyEnds.ticket).not.toBeNull();
    expect(start).toHaveBeenCalledWith('ticket');
    game.startParty('ticket'); // already running: refresh without a second fanfare
    expect(start).toHaveBeenCalledTimes(1);
    game.rules.partyEnds.ticket = game.simTime + SIM.step / 2;
    game.step();
    expect(end).toHaveBeenCalledWith('ticket');
  });

  it('a party started by play triggers the fanfare from the simulation step', async () => {
    const { game } = await boot();
    const start = vi.spyOn(game.sound, 'partyStart');
    game.rules.ladder.ball = RULES.ladderSteps - 1;
    const slot = vi.spyOn(game.physics, 'step').mockReturnValueOnce([{ type: 'slot', index: SLOTS.indexOf('ball') }]);
    game.step();
    slot.mockRestore();
    expect(start).toHaveBeenCalledWith('ball');
  });

  it('yellow during Ball Party pays the jackpot with fanfare and flash; otherwise a normal payout cue', async () => {
    const { game } = await boot();
    const jackpot = vi.spyOn(game.sound, 'jackpot');
    const pocket = vi.spyOn(game.sound, 'pocket');
    const flash = vi.spyOn(game.stage, 'flash');
    game.applyPocket('yellow');
    expect(pocket).toHaveBeenCalledWith('yellow', false);
    game.startParty('ball');
    const pot = game.rules.jackpot;
    game.applyPocket('yellow');
    expect(jackpot).toHaveBeenCalledWith(pot);
    expect(flash).toHaveBeenCalledWith('jackpot', pot);
    game.applyPocket('red');
    expect(pocket).toHaveBeenLastCalledWith('red', true);
  });
});

describe('player buttons', () => {
  it('+CREDITS adds a batch with a coin sound; RESET rebuilds the machine', async () => {
    const { game, root } = await boot();
    const credit = vi.spyOn(game.sound, 'credit');
    game.hud.credit.click();
    expect(game.rules.credits).toBe(RULES.startCredits + CREDIT_BATCH);
    expect(credit).toHaveBeenCalled();
    const oldPhysics = game.physics;
    game.rules.tickets = 500;
    await game.reset();
    expect(game.physics).not.toBe(oldPhysics);
    expect(game.rules.tickets).toBe(0);
    expect(game.simTime).toBe(0);
    game.frame(0);
    expect(feed(root)[0]).toBe('Machine reset');
    game.hud.reset.click(); // button path
  });

  it('mute toggles sound, persists, and is restored on the next boot', async () => {
    const { game } = await boot();
    game.hud.mute.click();
    expect(game.sound.muted).toBe(true);
    expect(localStorage.getItem('vicky.muted')).toBe('1');
    const next = await boot();
    expect(next.game.sound.muted).toBe(true);
    expect(next.game.hud.mute.textContent).toBe('SOUND OFF');
    next.game.hud.mute.click();
    expect(next.game.sound.muted).toBe(false);
  });

  it('the first press unlocks audio', async () => {
    const { game } = await boot();
    expect(game.sound.unlocked).toBe(false);
    pointer(window, 'pointerdown');
    expect(game.sound.unlocked).toBe(true);
  });
});

describe('debug menu wiring', () => {
  it('mounts with ?debug and every tunable round-trips through its getter and setter', async () => {
    const { game } = await boot({ debug: true });
    expect(document.querySelector('.debug-menu')).not.toBeNull();
    const controls = debugControls(game);
    for (const group of controls.groups) {
      for (const param of group.params) {
        if (param.kind === 'number') {
          const old = param.get();
          param.set(param.max);
          expect(param.get()).toBe(param.max);
          param.set(old);
        } else if (param.kind === 'toggle') {
          const old = param.get();
          param.set(!old);
          expect(param.get()).toBe(!old);
          param.set(old);
        }
      }
    }
    expect(controls.stats!()).toMatch(/fps · \d+ bodies .* tower \d+/);
  });

  it('cheat actions drive the real game paths', async () => {
    const { game } = await boot();
    const controls = debugControls(game);
    const run = (label: string): void => controls.actions.find((a) => a.label === label)!.run();
    run('Pause / resume');
    expect(game.paused).toBe(true);
    run('Pause / resume');
    run('Step');
    expect(game.simTime).toBeCloseTo(SIM.step);
    run('+5 credits');
    expect(game.rules.credits).toBe(RULES.startCredits + CREDIT_BATCH);
    run('Force TICKET');
    expect(game.rules.tickets).toBe(RULES.ticketLadder[0]);
    run('Force BALL');
    run('Force LUCKY');
    expect(game.rules.pearlReserve).toBe(RULES.pearlReserveStart - 1);
    const bodies = game.physics.bodies.length;
    run('Drop 10 balls');
    run('Drop extra pearl');
    steps(game, 2);
    expect(game.physics.bodies.length).toBeGreaterThanOrEqual(bodies + 11 - 2);
    run('Ticket Party');
    expect(game.rules.partyEnds.ticket).not.toBeNull();
    run('Ball Party');
    const pot = game.rules.jackpot;
    const tickets = game.rules.tickets;
    run('Pearl → yellow');
    expect(game.rules.tickets).toBe(tickets + pot);
    run('Reset machine');
  });

  it('the light editor reads, edits, adds, and selects scene lights', async () => {
    const { game } = await boot();
    const lights = game.stage.debugLights();
    const list = lights.list();
    expect(list.map((l) => l.type)).toEqual(expect.arrayContaining(['hemisphere', 'directional', 'point']));
    const point = list.find((l) => l.type === 'point')!;
    lights.set(point.id, 'enabled', false);
    lights.set(point.id, 'color', '#ff0000');
    lights.set(point.id, 'intensity', 4);
    lights.select(point.id);
    lights.set(point.id, 'x', 12);
    expect(lights.list().find((l) => l.id === point.id)).toMatchObject({ enabled: false, color: '#ff0000', intensity: 4, x: 12 });
    lights.set('missing', 'x', 1); // unknown id: ignored
    lights.add('point');
    lights.add('spot');
    expect(lights.list().slice(-2).map((l) => l.type)).toEqual(['point', 'spot']);
    lights.select(list.find((l) => l.type === 'hemisphere')!.id);
    lights.select(null);
  });
});

describe('main entry', () => {
  it('boots the game into #app from the page URL', async () => {
    const root = document.createElement('main');
    root.id = 'app';
    document.body.append(root);
    // Dynamic on purpose: importing main.ts is the side effect under test (it boots into #app), so it must run after
    // the root exists rather than at test-module load.
    await import('./main');
    const game = 'vicky' in window ? window.vicky : null;
    expect(game).toBeInstanceOf(Game);
    if (game instanceof Game) games.push(game);
    expect(root.querySelector('canvas')).not.toBeNull();
  });
});
