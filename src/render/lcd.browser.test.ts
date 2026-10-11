import { afterEach, describe, expect, it, vi } from 'vitest';
import { RULES } from '../config';
import { GameRules } from '../rules/game';
import { LCD_SIZE, paintLcd, type LcdFlash } from './lcd';
import { paintSevenSegment } from './textures';

function canvas(w = LCD_SIZE.w, h = LCD_SIZE.h): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d')!;
}

/** Paints a frame and returns every string drawn with fillText. */
function painted(rules: GameRules, flash: LcdFlash | null = null, time = 1): string[] {
  const ctx = canvas();
  const fillText = vi.spyOn(ctx, 'fillText');
  paintLcd(ctx, rules, time, flash);
  return fillText.mock.calls.map(([text]) => String(text));
}

afterEach(() => vi.restoreAllMocks());

describe('LCD', () => {
  it('shows normal pocket values, jackpot, tower count, and ticket ladder outside parties', () => {
    const rules = new GameRules();
    rules.jackpot = 1234;
    rules.pearlReserve = 3;
    const text = painted(rules);
    for (const value of Object.values(RULES.pocketPay.normal)) expect(text).toContain(String(value));
    for (const value of RULES.ticketLadder) expect(text).toContain(String(value));
    expect(text).toContain('1234');
    expect(text).toContain('LUCKY BALL');
    expect(text).toContain('3');
    expect(text.some((t) => t.includes('PARTY TIME'))).toBe(false);
  });

  it('switches the wheel to party pays and SUPER + jackpot during Ball Party, with a countdown banner', () => {
    const rules = new GameRules();
    rules.jackpot = 1500;
    rules.now = 10;
    rules.partyEnds.ball = 10 + 30.2;
    const text = painted(rules);
    expect(text).toContain('SUPER');
    expect(text).toContain(String(RULES.pocketPay.party.green));
    expect(text).toContain(String(RULES.pocketPay.party.red));
    expect(text).toContain('BALL PARTY TIME  31');
  });

  it('stacks a Ticket Party banner with its own countdown', () => {
    const rules = new GameRules();
    rules.partyEnds.ticket = 5;
    rules.partyEnds.ball = 8;
    const text = painted(rules);
    expect(text).toContain('TICKET PARTY TIME  5');
    expect(text).toContain('BALL PARTY TIME  8');
  });

  it.each([
    ['jackpot', ['SUPER BONUS!', '+1500']],
    ['ballParty', ['PARTY TIME!', 'DOUBLE BALLS · BIG PEARL PAYS']],
    ['ticketParty', ['PARTY TIME!', 'TOP TICKETS EVERY HIT']],
    ['lucky', ['LUCKY BALL!']],
  ] as const)('%s flash shows its headline while fresh and disappears when old', (kind, lines) => {
    const rules = new GameRules();
    const fresh = painted(rules, { kind, amount: 1500, age: 0.5 });
    for (const line of lines) expect(fresh).toContain(line);
    const stale = painted(rules, { kind, amount: 1500, age: 5 });
    for (const line of lines) expect(stale).not.toContain(line);
  });
});

describe('LCD ladders', () => {
  /** Count of pixels that differ between two frames, split into the left and right halves of the screen. */
  function diff(a: GameRules, b: GameRules): { left: number; right: number } {
    const [ca, cb] = [canvas(), canvas()];
    paintLcd(ca, a, 0, null);
    paintLcd(cb, b, 0, null);
    const da = ca.getImageData(0, 0, LCD_SIZE.w, LCD_SIZE.h).data;
    const db = cb.getImageData(0, 0, LCD_SIZE.w, LCD_SIZE.h).data;
    const out = { left: 0, right: 0 };
    for (let i = 0; i < da.length; i += 4) {
      if (da[i] === db[i] && da[i + 1] === db[i + 1] && da[i + 2] === db[i + 2]) continue;
      if ((i / 4) % LCD_SIZE.w < LCD_SIZE.w / 2) out.left++;
      else out.right++;
    }
    return out;
  }

  it('lights ball beads on the left arc and ticket badges on the right arc', () => {
    const dark = new GameRules();
    const ball = new GameRules();
    ball.ladder.ball = 3;
    const ticket = new GameRules();
    ticket.ladder.ticket = 5;
    const b = diff(dark, ball);
    const t = diff(dark, ticket);
    expect(b.left).toBeGreaterThan(1000);
    expect(b.right).toBe(0);
    expect(t.right).toBeGreaterThan(1000);
    expect(t.left).toBe(0);
  });
});

describe('seven-segment jackpot readout', () => {
  // Segment centers for digit cell i (see paintSevenSegment geometry), probed as lit (red) or dark.
  function litSegments(ctx: CanvasRenderingContext2D, digit: number, digits: number): boolean[] {
    const { width: W, height: H } = ctx.canvas;
    const cw = W / digits;
    const t = cw * 0.13;
    const sw = cw * 0.62;
    const sh = H * 0.36;
    const x0 = digit * cw + (cw - sw) / 2 + cw * 0.04;
    const y0 = H * 0.12;
    const centers: [number, number][] = [
      [x0 + sw / 2, y0 + t / 2],
      [x0 + sw - t / 2, y0 + sh / 2],
      [x0 + sw - t / 2, y0 + sh * 1.5],
      [x0 + sw / 2, y0 + 2 * sh + t / 2],
      [x0 + t / 2, y0 + sh * 1.5],
      [x0 + t / 2, y0 + sh / 2],
      [x0 + sw / 2, y0 + sh + t / 2],
    ];
    return centers.map(([x, y]) => ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data[0]! > 180);
  }

  it.each([
    [0, [1, 1, 1, 1, 1, 1, 0]],
    [1, [0, 1, 1, 0, 0, 0, 0]],
    [4, [0, 1, 1, 0, 0, 1, 1]],
    [7, [1, 1, 1, 0, 0, 0, 0]],
    [8, [1, 1, 1, 1, 1, 1, 1]],
  ])('lights the right segments for %i', (digit, expected) => {
    const ctx = canvas(1024, 320);
    paintSevenSegment(ctx, digit, 4);
    expect(litSegments(ctx, 3, 4).map(Number)).toEqual(expected);
  });

  it('right-aligns the value and blanks leading digits', () => {
    const ctx = canvas(1024, 320);
    paintSevenSegment(ctx, 42, 4);
    expect(litSegments(ctx, 0, 4).some(Boolean)).toBe(false);
    expect(litSegments(ctx, 2, 4).map(Number)).toEqual([0, 1, 1, 0, 0, 1, 1]);
  });
});
