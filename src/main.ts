import './style.css';
import { BALL_RADIUS, BOARD, SIM } from './config';
import { Stage } from './render/stage';
import { Rng } from './rng';
import { GameRules } from './rules/game';
import { PocketDisk } from './sim/disk';
import { PhysicsWorld } from './sim/physics';
import { Hud } from './ui/hud';

const CREDIT_BATCH = 5;
const AIM_LIMIT = BOARD.halfWidth - BALL_RADIUS - 0.5;
const KEY_AIM_SPEED = 30; // cm/s

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? Math.floor(Math.random() * 2 ** 31));
const rng = new Rng(seed);
const viewport = document.querySelector<HTMLElement>('#viewport')!;
const loading = document.querySelector<HTMLElement>('#loading')!;

let physics = await PhysicsWorld.create(rng);
let rules = new GameRules();
let disk = new PocketDisk(rng);
const stage = new Stage(viewport, physics.pegs);
const hud = new Hud();
loading.remove();

let simTime = 0;
let accumulator = 0;
let aimX = 0;
let firing = false;
let fireCooldown = 0;
let ready = true;
const keys = new Set<string>();

function fixedStep(): void {
  simTime += SIM.step;
  rules.tick(simTime);

  aimX += ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * KEY_AIM_SPEED * SIM.step;
  aimX = Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, aimX));
  fireCooldown -= SIM.step;
  if (firing && fireCooldown <= 0) {
    if (rules.tryLaunch()) {
      physics.spawnShot(aimX);
      fireCooldown = SIM.autoFireInterval;
    } else {
      firing = false;
      hud.push({ text: `Out of credits: press +${CREDIT_BATCH} CREDITS`, tone: 'loss' });
    }
  }

  for (const event of physics.step()) {
    if (event.type === 'slot') {
      for (const effect of rules.onSlot(event.index)) {
        if (effect.type === 'dropBalls') physics.queueDrop('ball', effect.count);
        else physics.queueDrop('pearl');
      }
    } else if (event.kind === 'pearl') {
      if (event.type === 'frontExit') disk.launch();
      else rules.notePearlLost();
    }
  }
  for (const pocket of disk.step(SIM.step)) rules.onPocket(pocket.color);
}

let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!ready) return;
  accumulator += dt;
  let steps = 0;
  while (accumulator >= SIM.step && steps < SIM.maxStepsPerFrame) {
    fixedStep();
    accumulator -= SIM.step;
    steps++;
  }
  if (steps === SIM.maxStepsPerFrame) accumulator = 0; // fell behind: drop time instead of spiraling
  for (const notice of rules.drainNotices()) hud.push(notice);
  hud.update(rules);
  stage.sync(physics, disk, rules, aimX);
  stage.render();
}
requestAnimationFrame(frame);

// Input: pointer aims on the board plane; press (or Space) launches and auto-fires while held.
const canvas = stage.renderer.domElement;
canvas.addEventListener('pointermove', (e) => {
  const x = stage.aimFromPointer(e.clientX, e.clientY);
  if (x !== null) aimX = Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, x));
});
canvas.addEventListener('pointerdown', (e) => {
  const x = stage.aimFromPointer(e.clientX, e.clientY);
  if (x !== null) aimX = Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, x));
  firing = true;
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) canvas.addEventListener(type, () => (firing = false));

const launch = document.querySelector<HTMLButtonElement>('#launch')!;
launch.addEventListener('pointerdown', () => (firing = true));
for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) launch.addEventListener(type, () => (firing = false));

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    firing = true;
  }
  keys.add(e.key);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') firing = false;
  keys.delete(e.key);
});
window.addEventListener('blur', () => {
  firing = false;
  keys.clear();
});

document.querySelector('#credit')!.addEventListener('click', () => {
  rules.addCredits(CREDIT_BATCH);
  hud.push({ text: `+${CREDIT_BATCH} credits`, tone: 'info' });
});
document.querySelector('#reset')!.addEventListener('click', async () => {
  ready = false;
  physics.dispose();
  physics = await PhysicsWorld.create(rng);
  rules = new GameRules();
  disk = new PocketDisk(rng);
  simTime = 0;
  accumulator = 0;
  ready = true;
  hud.push({ text: 'Machine reset', tone: 'info' });
});

window.addEventListener('resize', () => stage.resize());

if (import.meta.env.DEV) {
  // Read-only handle for manual debugging in the console.
  Object.assign(window, { vicky: { seed, get rules() { return rules; }, get physics() { return physics; }, get disk() { return disk; } } });
}
