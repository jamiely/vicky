import './style.css';
import { SIM } from './config';
import { Stage } from './render/stage';
import { Rng } from './rng';
import { GameRules } from './rules/game';
import { PocketDisk } from './sim/disk';
import { PhysicsWorld } from './sim/physics';
import { Hud } from './ui/hud';

const CREDIT_BATCH = 5;

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? Math.floor(Math.random() * 2 ** 31));
const rng = new Rng(seed);
const viewport = document.querySelector<HTMLElement>('#viewport')!;
const loading = document.querySelector<HTMLElement>('#loading')!;

let physics = await PhysicsWorld.create(rng);
let rules = new GameRules(rng);
let disk = new PocketDisk(rng);
const stage = new Stage(viewport, physics.pegs);
const hud = new Hud();
loading.remove();

let simTime = 0;
let accumulator = 0;
let firing = false;
let fireCooldown = 0;
let ready = true;

function fixedStep(): void {
  simTime += SIM.step;
  rules.tick(simTime);

  fireCooldown -= SIM.step;
  if (firing && fireCooldown <= 0) {
    if (rules.tryLaunch()) {
      physics.spawnShot();
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
  stage.sync(physics, disk, rules);
  stage.render();
}
requestAnimationFrame(frame);

// Input: press anywhere on the cabinet, the LAUNCH button, or Space; holding auto-fires.
// There is no aiming: on the source cabinet players cannot steer shots ("you don't really have much choice").
for (const target of [stage.renderer.domElement, document.querySelector<HTMLButtonElement>('#launch')!]) {
  target.addEventListener('pointerdown', () => (firing = true));
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) target.addEventListener(type, () => (firing = false));
}
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  firing = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') firing = false;
});
window.addEventListener('blur', () => (firing = false));

document.querySelector('#credit')!.addEventListener('click', () => {
  rules.addCredits(CREDIT_BATCH);
  hud.push({ text: `+${CREDIT_BATCH} credits`, tone: 'info' });
});
document.querySelector('#reset')!.addEventListener('click', async () => {
  ready = false;
  physics.dispose();
  physics = await PhysicsWorld.create(rng);
  rules = new GameRules(rng);
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
