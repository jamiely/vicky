const canvas = document.querySelector('#game-canvas');
const ctx = canvas.getContext('2d');
const machine = document.querySelector('#machine');
const dropMarker = document.querySelector('#drop-marker');
const dropArrow = document.querySelector('.drop-arrow');
const dropButton = document.querySelector('#drop-button');
const addCreditButton = document.querySelector('#add-credit');
const resetButton = document.querySelector('#reset-button');
const creditsEl = document.querySelector('#credits');
const ticketsEl = document.querySelector('#tickets');
const jackpotEl = document.querySelector('#jackpot');
const comboEl = document.querySelector('#combo');
const modeLabel = document.querySelector('#mode-label');
const directionEl = document.querySelector('#pusher-direction');
const eventMessage = document.querySelector('#event-message');
const wheel = document.querySelector('#wheel');

const W = canvas.width;
const H = canvas.height;
const shelf = { left: 70, right: 830, top: 540, bottom: 710 };
const frontEdge = 702;
const colors = { cyan: '#5eeeff', blue: '#2689f2', purple: '#9c5cff', pink: '#ff62d3', gold: '#ffc857', lime: '#8effa1', ink: '#06111b', white: '#effcff', muted: '#5e8294' };

let state;
let lastTime = performance.now();
let accumulator = 0;
let dropX = W / 2;
let idCounter = 1;
let nextOrbAt = 3;

function newState() {
  const coins = [];
  for (let i = 0; i < 48; i += 1) {
    const row = Math.floor(i / 12);
    coins.push({ id: idCounter++, kind: 'coin', x: 170 + (i % 12) * 51 + (row % 2) * 11, y: 588 + row * 23, r: 16, vx: 0, vy: 0, phase: Math.random() * Math.PI * 2 });
  }
  for (let i = 0; i < 5; i += 1) {
    coins.push({ id: idCounter++, kind: 'orb', x: 250 + i * 120, y: 584 + (i % 2) * 36, r: 21, vx: 0, vy: 0, phase: Math.random() * Math.PI * 2 });
  }
  return { credits: 20, tickets: 0, jackpot: 1200, combo: 1, coins, drops: [], particles: [], pusher: 0, pusherVelocity: 0.75, partyUntil: 0, flashUntil: 0, lastTime: performance.now(), wheelRotation: 0, collected: 0 };
}
state = newState();

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function format(value) { return Math.round(value).toLocaleString('en-US'); }
function announce(message, tone = 'cyan') {
  eventMessage.textContent = message;
  eventMessage.style.color = colors[tone] || colors.cyan;
}
function isParty(now = performance.now()) { return state.partyUntil > now; }
function syncUI(now = performance.now()) {
  creditsEl.textContent = format(state.credits);
  ticketsEl.textContent = format(state.tickets);
  jackpotEl.textContent = format(state.jackpot);
  comboEl.textContent = `x${state.combo}`;
  modeLabel.textContent = isParty(now) ? `PARTY ${Math.ceil((state.partyUntil - now) / 1000)}s` : 'READY';
  modeLabel.style.color = isParty(now) ? colors.gold : colors.lime;
  directionEl.textContent = state.pusherVelocity >= 0 ? '→' : '←';
  dropButton.disabled = state.credits < 1;
}

function setDropPosition(clientX) {
  const rect = canvas.getBoundingClientRect();
  dropX = clamp((clientX - rect.left) * (W / rect.width), 100, W - 100);
  const ratio = dropX / W * 100;
  dropMarker.style.left = `${ratio}%`;
  dropArrow.style.left = `calc(${ratio}% - 7px)`;
}

function addParticle(x, y, color, count = 8) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 35 + Math.random() * 100;
    state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 50, life: .5 + Math.random() * .5, maxLife: 1, color, r: 2 + Math.random() * 3 });
  }
}

function dropCoin() {
  if (state.credits < 1) {
    announce('Add a credit to keep playing.', 'danger');
    return;
  }
  state.credits -= 1;
  state.drops.push({ id: idCounter++, x: dropX + (Math.random() - .5) * 9, y: 104, r: 14, vy: 70 + Math.random() * 22, life: 0 });
  announce(isParty() ? 'Party drop! Orbs are worth double.' : 'Coin in play — watch the edge.');
  syncUI();
}

function resolveDrop(drop, dt, now) {
  drop.life += dt;
  drop.vy += 220 * dt;
  drop.y += drop.vy * dt;
  if (drop.y >= shelf.top - 14) {
    const nudge = drop.x < W / 2 ? -1 : 1;
    state.coins.push({ id: drop.id, kind: 'coin', x: drop.x, y: shelf.top - 18, r: 15, vx: nudge * 7, vy: 0, phase: Math.random() * Math.PI * 2 });
    addParticle(drop.x, shelf.top - 18, colors.cyan, 5);
    return false;
  }
  return true;
}

function advanceCoins(dt, now) {
  const push = Math.sin(state.pusher) * 2.1;
  for (const item of state.coins) {
    item.x += (item.vx + push) * dt;
    item.vx *= Math.pow(.05, dt);
    item.y += item.vy * dt;
    item.vy *= Math.pow(.04, dt);
    item.x = clamp(item.x, shelf.left + item.r, shelf.right - item.r);
    item.y = clamp(item.y, shelf.top + item.r, shelf.bottom - item.r);
  }

  // A compact deterministic settling pass keeps the shelf readable without a physics dependency.
  for (let i = 0; i < state.coins.length; i += 1) {
    const a = state.coins[i];
    for (let j = i + 1; j < state.coins.length; j += 1) {
      const b = state.coins[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDistance = a.r + b.r - 2;
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < minDistance) {
        const amount = (minDistance - distance) / distance * .45;
        a.x -= dx * amount; a.y -= dy * amount;
        b.x += dx * amount; b.y += dy * amount;
      }
    }
    if (a.y > frontEdge - 105 && a.x > shelf.left + 8 && a.x < shelf.right - 8 && Math.sin(state.pusher) > .58) {
      const chance = (Math.sin(state.pusher) - .58) * dt * (a.kind === 'orb' ? 1.6 : .8);
      if (Math.random() < chance) collectItem(a, now);
    }
  }
}

function collectItem(item, now) {
  const index = state.coins.indexOf(item);
  if (index === -1) return;
  state.coins.splice(index, 1);
  const orb = item.kind === 'orb';
  const reward = orb ? (isParty(now) ? 180 : 90) : 5;
  const earned = reward * state.combo;
  state.tickets += earned;
  state.collected += 1;
  state.combo = Math.min(8, state.combo + (orb ? 1 : 0));
  addParticle(item.x, item.y, orb ? colors.gold : colors.cyan, orb ? 18 : 7);
  announce(orb ? `Orb collected: +${format(earned)} tickets` : `Coin collected: +${format(earned)} tickets`, orb ? 'gold' : 'cyan');
  if (orb) triggerWheel(now);
}

function triggerWheel(now) {
  const outcome = Math.random();
  let target;
  if (outcome < .12) {
    target = 'JACKPOT';
    const payout = state.jackpot;
    state.tickets += payout;
    state.jackpot = 1200;
    announce(`JACKPOT! +${format(payout)} tickets`, 'pink');
  } else if (outcome < .42) {
    target = 'PARTY';
    state.partyUntil = now + 31000;
    state.tickets += 300;
    announce('PARTY TIME: 31 seconds of double orb rewards.', 'gold');
  } else if (outcome < .70) {
    target = '120';
    state.tickets += 120;
    announce('Wheel bonus: +120 tickets.', 'lime');
  } else {
    target = '60';
    state.tickets += 60;
    announce('Wheel bonus: +60 tickets.', 'lime');
  }
  const rotations = 3 + Math.floor(Math.random() * 3);
  const degrees = { '60': 45, '120': 135, PARTY: 225, JACKPOT: 315 }[target];
  state.wheelRotation += rotations * 360 + degrees;
  wheel.style.transform = `rotate(${state.wheelRotation}deg)`;
  state.flashUntil = now + 700;
}

function update(dt, now) {
  state.pusher += state.pusherVelocity * dt;
  if (Math.abs(Math.sin(state.pusher)) > .995) state.pusherVelocity *= -1;
  state.drops = state.drops.filter(drop => resolveDrop(drop, dt, now));
  advanceCoins(dt, now);
  state.particles = state.particles.filter(p => {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 150 * dt;
    return p.life > 0;
  });
  if (state.combo > 1 && state.collected > 0 && Math.sin(state.pusher) < -.95) state.combo = Math.max(1, state.combo - 1);
  if (now > nextOrbAt * 1000 + state.lastTime && state.coins.filter(i => i.kind === 'orb').length < 6) {
    state.coins.push({ id: idCounter++, kind: 'orb', x: 170 + Math.random() * 560, y: 590, r: 21, vx: 0, vy: 0, phase: Math.random() * Math.PI * 2 });
    nextOrbAt += 5;
  }
  syncUI(now);
}

function roundedRect(x, y, w, h, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}
function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, '#071827'); gradient.addColorStop(.55, '#0a2437'); gradient.addColorStop(1, '#102f3a');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = .22;
  for (let i = 0; i < 24; i += 1) {
    const x = (i * 83 + 22) % W;
    const y = 68 + ((i * 127) % 390);
    ctx.fillStyle = i % 2 ? colors.cyan : colors.purple;
    ctx.beginPath(); ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawBoard() {
  ctx.fillStyle = '#06111b';
  roundedRect(52, 82, 796, 650, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(94,238,255,.28)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = 'rgba(38,137,242,.11)';
  ctx.fillRect(76, 118, 748, 385);
  ctx.strokeStyle = 'rgba(138,205,232,.16)'; ctx.lineWidth = 1;
  for (let x = 100; x < 820; x += 55) { ctx.beginPath(); ctx.moveTo(x, 120); ctx.lineTo(x, 495); ctx.stroke(); }
  for (let y = 150; y < 500; y += 45) { ctx.beginPath(); ctx.moveTo(78, y); ctx.lineTo(822, y); ctx.stroke(); }
  ctx.fillStyle = '#0d3344'; ctx.fillRect(shelf.left, shelf.top, shelf.right - shelf.left, shelf.bottom - shelf.top);
  ctx.fillStyle = '#174e5b'; ctx.fillRect(shelf.left, shelf.top, shelf.right - shelf.left, 16);
  ctx.fillStyle = 'rgba(94,238,255,.18)'; ctx.fillRect(shelf.left, frontEdge, shelf.right - shelf.left, shelf.bottom - frontEdge);
  ctx.strokeStyle = colors.gold; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(shelf.left, frontEdge); ctx.lineTo(shelf.right, frontEdge); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = colors.muted; ctx.font = '700 13px Inter, sans-serif'; ctx.letterSpacing = '2px'; ctx.fillText('COLLECTION EDGE', 72, 754);
  ctx.fillStyle = '#07131c'; ctx.fillRect(70, 756, 760, 18);
  ctx.fillStyle = 'rgba(255,200,87,.7)'; ctx.fillRect(70, 756, 760 * .32, 18);
}
function drawPegboard() {
  ctx.fillStyle = 'rgba(94,238,255,.55)';
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 13; col += 1) {
      const x = 112 + col * 58 + (row % 2) * 29;
      const y = 157 + row * 55;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function drawCoin(item, now) {
  const wobble = Math.sin(now / 320 + item.phase) * .9;
  ctx.save(); ctx.translate(item.x, item.y + wobble);
  if (item.kind === 'orb') {
    const orb = ctx.createRadialGradient(-6, -8, 3, 0, 0, item.r);
    orb.addColorStop(0, '#fff2a6'); orb.addColorStop(.35, colors.gold); orb.addColorStop(1, '#d66a20');
    ctx.fillStyle = orb; ctx.beginPath(); ctx.arc(0, 0, item.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff0a1'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(-7, -8, 4, 0, Math.PI * 2); ctx.fill();
  } else {
    const coin = ctx.createLinearGradient(-item.r, -item.r, item.r, item.r);
    coin.addColorStop(0, '#efffff'); coin.addColorStop(.42, '#bfe8e9'); coin.addColorStop(1, '#5e9ea7');
    ctx.fillStyle = coin; ctx.beginPath(); ctx.arc(0, 0, item.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(6,17,27,.5)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(38,137,242,.4)'; ctx.beginPath(); ctx.arc(0, 0, item.r * .5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function drawPusher(now) {
  const offset = Math.sin(state.pusher) * 22;
  ctx.fillStyle = '#233e4d';
  roundedRect(86 + offset, 510, 728, 32, 8); ctx.fill();
  ctx.fillStyle = colors.cyan; ctx.globalAlpha = .55;
  ctx.fillRect(100 + offset, 512, 700, 3); ctx.globalAlpha = 1;
  ctx.fillStyle = colors.white; ctx.font = '800 12px Inter, sans-serif'; ctx.fillText('PUSHER SHELF', 106 + offset, 532);
}
function drawDrop(drop) {
  ctx.save(); ctx.translate(drop.x, drop.y); ctx.fillStyle = colors.cyan; ctx.shadowColor = colors.cyan; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(0, 0, drop.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = colors.ink; ctx.beginPath(); ctx.arc(-4, -5, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function drawParticles() {
  for (const p of state.particles) { ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
}
function render(now) {
  drawBackground(); drawBoard(); drawPegboard();
  for (const item of state.coins) drawCoin(item, now);
  drawPusher(now);
  for (const drop of state.drops) drawDrop(drop);
  drawParticles();
  if (state.flashUntil > now) {
    ctx.fillStyle = `rgba(255,255,255,${(state.flashUntil - now) / 350})`; ctx.fillRect(0, 0, W, H);
  }
}
function frame(now) {
  const dt = Math.min(.04, (now - lastTime) / 1000);
  lastTime = now;
  update(dt, now);
  render(now);
  requestAnimationFrame(frame);
}

canvas.addEventListener('pointermove', (event) => setDropPosition(event.clientX));
canvas.addEventListener('pointerdown', (event) => { setDropPosition(event.clientX); dropCoin(); });
dropButton.addEventListener('click', dropCoin);
addCreditButton.addEventListener('click', () => { state.credits += 10; announce('+10 credits loaded.', 'lime'); syncUI(); });
resetButton.addEventListener('click', () => { state = newState(); dropX = W / 2; wheel.style.transform = 'rotate(0deg)'; setDropPosition(canvas.getBoundingClientRect().left + canvas.getBoundingClientRect().width / 2); announce('Run reset. Build the edge.'); syncUI(); });

setDropPosition(canvas.getBoundingClientRect().left + canvas.getBoundingClientRect().width / 2);
syncUI();
requestAnimationFrame(frame);
