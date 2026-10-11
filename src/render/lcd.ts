import { RULES } from '../config';
import type { GameRules } from '../rules/game';

/**
 * Station LCD, modeled on the cabinet screen (reference: /tmp frames of the demo video at 0:20, 0:33, 0:47): a purple
 * galaxy background, a neon-rimmed value wheel in the middle with a "LUCKY BALL" hub, a curved column of pink beads on
 * the left (ball ladder) and ticket-value badges on the right, and the SUPERBONUS jackpot in the top-right corner.
 * Layout, palette, and motion only; no artwork from the original.
 */

export const LCD_SIZE = { w: 1280, h: 720 };

export interface LcdFlash {
  kind: 'jackpot' | 'ballParty' | 'ticketParty' | 'lucky';
  amount: number;
  /** Seconds since the event. */
  age: number;
}

const CX = 640;
const CY = 390;
const WHEEL_R = 235;
const LADDER_R = 330;
/** Angular span of each ladder arc (radians). */
const LADDER_SPREAD = Math.PI * 0.62;
const RIM_LEDS = 56;
const SEGMENTS = [
  { color: '#18c98a', key: 'green' },
  { color: '#d9265f', key: 'red' },
  { color: '#f2a516', key: 'yellow' },
  { color: '#a51c4c', key: 'red' },
] as const;
const FLASH_SECONDS = 3;

let background: HTMLCanvasElement | null = null;

/** Galaxy backdrop: drawn once and reused (stars, nebula clouds, vignette). */
function backdrop(): HTMLCanvasElement {
  if (background) return background;
  const canvas = document.createElement('canvas');
  canvas.width = LCD_SIZE.w;
  canvas.height = LCD_SIZE.h;
  const ctx = canvas.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, LCD_SIZE.w, LCD_SIZE.h);
  bg.addColorStop(0, '#1a0638');
  bg.addColorStop(0.5, '#3b0f6e');
  bg.addColorStop(1, '#120a3f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, LCD_SIZE.w, LCD_SIZE.h);
  let seed = 3;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [x, y, r, color] of [[220, 160, 260, '#ff3fb4'], [1080, 560, 300, '#3a6bff'], [900, 120, 200, '#b04dff']] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `${color}66`);
    g.addColorStop(1, `${color}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LCD_SIZE.w, LCD_SIZE.h);
  }
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.7})`;
    const s = rand() < 0.1 ? 2.5 : 1.2;
    ctx.fillRect(rand() * LCD_SIZE.w, rand() * LCD_SIZE.h, s, s);
  }
  const vignette = ctx.createRadialGradient(CX, CY, 300, CX, CY, 800);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, LCD_SIZE.w, LCD_SIZE.h);
  background = canvas;
  return canvas;
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', stroke = '#12052a'): void {
  ctx.font = `900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, size * 0.14);
  ctx.strokeStyle = stroke;
  ctx.strokeText(value, x, y);
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

/** Paints one frame. `time` is monotonic seconds for animation; `flash` drives celebration overlays. */
export function paintLcd(ctx: CanvasRenderingContext2D, rules: GameRules, time: number, flash: LcdFlash | null): void {
  const ballParty = rules.partyEnds.ball !== null;
  const ticketParty = rules.partyEnds.ticket !== null;
  const party = ballParty || ticketParty;
  ctx.drawImage(backdrop(), 0, 0);
  if (party) {
    ctx.fillStyle = `rgba(${ballParty ? '255,60,200' : '60,200,255'},${0.08 + 0.06 * Math.sin(time * 6)})`;
    ctx.fillRect(0, 0, LCD_SIZE.w, LCD_SIZE.h);
  }

  // Value wheel: what each disk pocket color pays right now (party values during Ball Party).
  const step = (Math.PI * 2) / SEGMENTS.length;
  const spin = time * (party ? 0.9 : 0.18);
  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate(spin);
  SEGMENTS.forEach((seg, i) => {
    const a0 = i * step - Math.PI / 2 - step / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, WHEEL_R, a0, a0 + step);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#14062c';
    ctx.stroke();
    const value =
      seg.key === 'yellow' ? (ballParty ? 'SUPER' : String(RULES.pocketPay.normal.yellow)) : String(ballParty ? RULES.pocketPay.party[seg.key] : RULES.pocketPay.normal[seg.key]);
    ctx.save();
    ctx.rotate(a0 + step / 2);
    ctx.translate(WHEEL_R * 0.66, 0);
    ctx.rotate(Math.PI / 2);
    text(ctx, value, 0, 0, value === 'SUPER' ? 54 : 64, '#ffffff');
    if (seg.key === 'yellow' && ballParty) text(ctx, String(rules.jackpot), 0, 52, 34, '#fff3a0');
    else text(ctx, 'TICKET', 0, 48, 26, 'rgba(255,255,255,0.85)');
    ctx.restore();
  });
  ctx.restore();

  // Neon rim with chasing LED dots (green → magenta like the reference ring).
  ctx.lineWidth = 14;
  ctx.strokeStyle = ballParty ? '#ffe066' : '#2df58f';
  ctx.beginPath();
  ctx.arc(CX, CY, WHEEL_R + 14, Math.PI * 0.9, Math.PI * 2.1);
  ctx.stroke();
  ctx.strokeStyle = ballParty ? '#ff9a3c' : '#ff3fc8';
  ctx.beginPath();
  ctx.arc(CX, CY, WHEEL_R + 14, Math.PI * 0.1, Math.PI * 0.9);
  ctx.stroke();
  const chase = time * (party ? 22 : 7);
  for (let i = 0; i < RIM_LEDS; i++) {
    const a = (i / RIM_LEDS) * Math.PI * 2;
    const lit = ((i - chase) % 8 + 8) % 8 < 2;
    ctx.fillStyle = lit ? '#ffffff' : 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(CX + Math.cos(a) * (WHEEL_R + 32), CY + Math.sin(a) * (WHEEL_R + 32), lit ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hub: LUCKY BALL with the number of pearls waiting in the tower.
  ctx.beginPath();
  ctx.arc(CX, CY, 92, 0, Math.PI * 2);
  ctx.fillStyle = '#0b1a5c';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#4fd8ff';
  ctx.stroke();
  text(ctx, 'LUCKY BALL', CX, CY - 46, 24, '#ffe7ff');
  text(ctx, String(rules.pearlReserve), CX, CY + 14, 82, '#ffffff');

  // Ladders follow the wheel's curve: ball beads on the left arc, ticket badges on the right arc.
  const steps = RULES.ladderSteps;
  for (let i = 0; i < steps; i++) {
    const f = steps === 1 ? 0.5 : i / (steps - 1);
    // Canvas angle (y down): the first bead sits bottom-left, the last top-left; ticket badges mirror on the right.
    const a = Math.PI - LADDER_SPREAD / 2 + f * LADDER_SPREAD;
    const ballLit = i < rules.ladder.ball;
    const ticketLit = i < rules.ladder.ticket;
    const lx = CX + Math.cos(a) * LADDER_R;
    const ly = CY + Math.sin(a) * LADDER_R;
    const rx = 2 * CX - lx;
    const r = 26;
    const bead = ctx.createRadialGradient(lx - 8, ly - 8, 3, lx, ly, r);
    bead.addColorStop(0, ballLit ? '#ffffff' : '#c58bd8');
    bead.addColorStop(0.35, ballLit ? '#ff6ad5' : '#5a2a78');
    bead.addColorStop(1, ballLit ? '#b0127e' : '#2a1046');
    ctx.fillStyle = bead;
    ctx.beginPath();
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rx, ly, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = ticketLit ? '#ff4fa0' : '#3a1458';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = ticketLit ? '#ffffff' : '#a46cff';
    ctx.stroke();
    text(ctx, String(RULES.ticketLadder[i] ?? ''), rx, ly + 1, 24, '#ffffff');
  }
  // Ladder captions sit above the arcs' top ends (top bead at y ≈ 116).
  text(ctx, 'BALL PARTY', CX - LADDER_R, 36, 28, '#ff8ae0');
  text(ctx, 'TICKET PARTY', CX + LADDER_R, 36, 28, '#8ad8ff');

  // Corners: jackpot top-right, credits/shots top-left, tickets bottom-right.
  text(ctx, 'SUPERBONUS', LCD_SIZE.w - 30, 34, 26, '#ffd34d', 'right');
  text(ctx, String(rules.jackpot), LCD_SIZE.w - 30, 82, 58, '#fff2a0', 'right');
  text(ctx, `CREDITS ${rules.credits}`, 30, 34, 26, '#bfefff', 'left');
  text(ctx, `SHOTS ${rules.shots}`, 30, 70, 26, '#bfefff', 'left');
  text(ctx, `TICKETS ${rules.tickets}`, LCD_SIZE.w - 30, LCD_SIZE.h - 32, 28, '#ffffff', 'right');

  // Party banners with countdown.
  const banners: [string, number | null, string][] = [
    ['BALL PARTY TIME', rules.partyEnds.ball, '#ff6ad5'],
    ['TICKET PARTY TIME', rules.partyEnds.ticket, '#5ee0ff'],
  ];
  let row = 0;
  for (const [label, ends, color] of banners) {
    if (ends === null) continue;
    const y = LCD_SIZE.h - 96 - row * 70;
    const pulse = 1 + 0.06 * Math.sin(time * 10);
    ctx.fillStyle = 'rgba(10,4,24,0.78)';
    ctx.fillRect(250, y - 32, LCD_SIZE.w - 500, 64);
    text(ctx, `${label}  ${Math.max(0, Math.ceil(ends - rules.now))}`, CX, y, 46 * pulse, color);
    row++;
  }

  if (flash && flash.age < FLASH_SECONDS) paintFlash(ctx, flash, time);
}

function paintFlash(ctx: CanvasRenderingContext2D, flash: LcdFlash, time: number): void {
  const fade = Math.min(1, (FLASH_SECONDS - flash.age) / 0.6) * Math.min(1, flash.age / 0.12);
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  if (flash.kind === 'lucky') {
    text(ctx, 'LUCKY BALL!', CX, 150, 70 + 10 * Math.sin(time * 12), '#ffe25a');
    ctx.restore();
    return;
  }
  ctx.fillStyle = 'rgba(8,2,20,0.7)';
  ctx.fillRect(0, 0, LCD_SIZE.w, LCD_SIZE.h);
  // Burst rays behind the headline.
  ctx.translate(CX, CY);
  ctx.rotate(time * 0.8);
  for (let i = 0; i < 16; i++) {
    ctx.rotate((Math.PI * 2) / 16);
    ctx.fillStyle = i % 2 ? 'rgba(255,214,77,0.35)' : 'rgba(255,90,200,0.3)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(900, -70);
    ctx.lineTo(900, 70);
    ctx.closePath();
    ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const scale = 1 + 0.08 * Math.sin(time * 9);
  if (flash.kind === 'jackpot') {
    text(ctx, 'SUPER BONUS!', CX, CY - 70, 110 * scale, '#ffe25a');
    text(ctx, `+${flash.amount}`, CX, CY + 70, 130 * scale, '#ffffff');
  } else {
    text(ctx, 'PARTY TIME!', CX, CY - 40, 130 * scale, flash.kind === 'ballParty' ? '#ff6ad5' : '#5ee0ff');
    text(ctx, flash.kind === 'ballParty' ? 'DOUBLE BALLS · BIG PEARL PAYS' : 'TOP TICKETS EVERY HIT', CX, CY + 80, 44, '#ffffff');
  }
  ctx.restore();
}
