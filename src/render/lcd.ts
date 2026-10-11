import { RULES } from '../config';
import type { GameRules } from '../rules/game';

export const LCD_SIZE = { w: 1024, h: 640 };

const SEGMENTS = [
  { color: '#2bd46a', key: 'green' },
  { color: '#e0334f', key: 'red' },
  { color: '#ffc21a', key: 'yellow' },
  { color: '#b0263d', key: 'red' },
] as const;

/** Paints the station LCD: ladders, pocket-value wheel, party banner, jackpot. Pure function of rules state. */
export function paintLcd(ctx: CanvasRenderingContext2D, rules: GameRules): void {
  const { w, h } = LCD_SIZE;
  const ballParty = rules.partyEnds.ball !== null;
  const ticketParty = rules.partyEnds.ticket !== null;

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#1b0b3a');
  bg.addColorStop(0.5, '#3a1270');
  bg.addColorStop(1, '#0d1747');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Pocket-value wheel: shows what each disk color pays right now.
  const cx = w / 2;
  const cy = h / 2 + 20;
  const r = 230;
  const step = (Math.PI * 2) / SEGMENTS.length;
  ctx.save();
  ctx.translate(cx, cy);
  SEGMENTS.forEach((seg, i) => {
    const a0 = i * step - Math.PI / 2 - step / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, a0, a0 + step);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#120626';
    ctx.lineWidth = 6;
    ctx.stroke();
    const value =
      seg.key === 'yellow' ? (ballParty ? 'SUPER' : String(RULES.pocketPay.normal.yellow)) : String(ballParty ? RULES.pocketPay.party[seg.key] : RULES.pocketPay.normal[seg.key]);
    ctx.save();
    ctx.rotate(a0 + step / 2);
    ctx.translate(r * 0.66, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${value === 'SUPER' ? 44 : 54}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, 0, 0);
    ctx.restore();
  });
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
  ctx.strokeStyle = ballParty ? '#ffe066' : '#5ef0ff';
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 70, 0, Math.PI * 2);
  ctx.fillStyle = '#120626';
  ctx.fill();
  ctx.fillStyle = '#9ff7ff';
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PEARL', cx, cy - 12);
  ctx.fillText('VALUES', cx, cy + 18);

  // Ladders: ball beads on the left, ticket values on the right.
  const ladderTop = 125;
  const gap = (LCD_SIZE.h - 80 - ladderTop) / (RULES.ladderSteps - 1);
  const beadR = Math.min(34, gap * 0.42);
  for (let i = 0; i < RULES.ladderSteps; i++) {
    const y = ladderTop + (RULES.ladderSteps - 1 - i) * gap;
    for (const side of ['ball', 'ticket'] as const) {
      const x = side === 'ball' ? 90 : w - 90;
      const lit = i < rules.ladder[side];
      ctx.beginPath();
      ctx.arc(x, y, beadR, 0, Math.PI * 2);
      ctx.fillStyle = lit ? (side === 'ball' ? '#5ef0ff' : '#ff6ad5') : '#2a1550';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = side === 'ball' ? '#5ef0ff' : '#ff6ad5';
      ctx.stroke();
      ctx.fillStyle = lit ? '#120626' : '#d9c8ff';
      ctx.font = `900 ${Math.round(beadR * 0.8)}px system-ui, sans-serif`;
      ctx.fillText(side === 'ball' ? 'BALL' : String(RULES.ticketLadder[i]), x, y + 1);
    }
  }

  ctx.fillStyle = '#ffe066';
  ctx.font = '900 30px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('JACKPOT', w - 30, 40);
  ctx.font = '900 54px ui-monospace, monospace';
  ctx.fillText(rules.jackpot.toLocaleString('en-US'), w - 30, 90);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9ff7ff';
  ctx.font = '800 28px system-ui, sans-serif';
  ctx.fillText(`SHOTS ${rules.shots}`, 30, 40);
  ctx.fillText(`CREDITS ${rules.credits}`, 30, 80);

  for (const [side, label, color] of [
    ['ball', 'BALL PARTY TIME', '#5ef0ff'],
    ['ticket', 'TICKET PARTY TIME', '#ff6ad5'],
  ] as const) {
    const ends = rules.partyEnds[side];
    if (ends === null) continue;
    const y = side === 'ball' ? h - 70 : h - 70 - (ballParty ? 64 : 0);
    ctx.fillStyle = 'rgba(10,4,24,0.82)';
    ctx.fillRect(150, y - 34, w - 300, 60);
    ctx.fillStyle = color;
    ctx.font = '900 42px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${label}  ${Math.ceil(ends - rules.now)}s`, w / 2, y);
  }
  if (ticketParty || ballParty) return;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Fill a ladder for PARTY TIME', w / 2, h - 36);
}
