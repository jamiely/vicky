import { describe, expect, it } from 'vitest';
import { RULES, SLOTS } from '../config';
import { GameRules } from './game';

const BALL = SLOTS.indexOf('ball');
const TICKET = SLOTS.indexOf('ticket');
const LUCKY = SLOTS.indexOf('lucky');
const K = RULES.ladderKnockback;

/** Rules whose chance rolls always return `roll` (0 = every LUCKY hit drops a pearl). */
const rules = (roll = 0) => new GameRules({ next: () => roll });

describe('credits and shots', () => {
  it('converts one credit into a shot batch only when the bank is empty, growing the jackpot', () => {
    const g = rules();
    expect(g.tryLaunch()).toBe(true);
    expect(g.credits).toBe(RULES.startCredits - 1);
    expect(g.shots).toBe(RULES.shotsPerCredit - 1);
    expect(g.jackpot).toBe(RULES.jackpotBase + RULES.jackpotPerCredit);
    for (let i = 1; i < RULES.shotsPerCredit; i++) g.tryLaunch();
    expect(g.credits).toBe(RULES.startCredits - 1);
    expect(g.shots).toBe(0);
  });

  it('refuses to launch with no shots and no credits', () => {
    const g = rules();
    g.credits = 0;
    expect(g.tryLaunch()).toBe(false);
    g.addCredits(1);
    expect(g.tryLaunch()).toBe(true);
    expect(g.shots).toBe(RULES.shotsPerCredit - 1);
  });
});

describe('ladders and party time', () => {
  it('starts a timed Ball Party when the ball ladder tops and ends it exactly on time', () => {
    const g = rules();
    g.tick(10);
    for (let i = 0; i < RULES.ladderSteps - 1; i++) g.onSlot(BALL);
    expect(g.partyEnds.ball).toBeNull();
    g.onSlot(BALL);
    expect(g.partyEnds.ball).toBe(10 + RULES.partySeconds);
    expect(g.ladder.ball).toBe(0);
    g.tick(10 + RULES.partySeconds - 0.001);
    expect(g.partyEnds.ball).not.toBeNull();
    g.tick(10 + RULES.partySeconds);
    expect(g.partyEnds.ball).toBeNull();
  });

  it('knocks the opposing ladder back, never below zero', () => {
    const g = rules();
    for (let i = 0; i < 3; i++) g.onSlot(BALL);
    g.onSlot(TICKET);
    expect(g.ladder).toEqual({ ball: Math.max(0, 3 - K), ticket: 1 });
    g.onSlot(TICKET);
    g.onSlot(TICKET);
    expect(g.ladder).toEqual({ ball: 0, ticket: 3 });
    g.onSlot(BALL);
    expect(g.ladder).toEqual({ ball: 1, ticket: Math.max(0, 3 - K) });
  });

  it('pays the ticket ladder in ascending order, then the top value on every hit during Ticket Party', () => {
    const g = rules();
    const paid: number[] = [];
    for (let i = 0; i < RULES.ladderSteps + 2; i++) {
      const before = g.tickets;
      g.onSlot(TICKET);
      paid.push(g.tickets - before);
    }
    const top = RULES.ticketLadder[RULES.ticketLadder.length - 1];
    expect(paid).toEqual([...RULES.ticketLadder, top, top]);
    expect(g.partyEnds.ticket).not.toBeNull();
  });

  it('doubles balls during Ball Party', () => {
    const g = rules();
    expect(g.onSlot(BALL)).toEqual([{ type: 'dropBalls', count: RULES.ballsPerBallHit }]);
    for (let i = 1; i < RULES.ladderSteps; i++) g.onSlot(BALL);
    expect(g.onSlot(BALL)).toEqual([{ type: 'dropBalls', count: RULES.ballsPerBallHit * 2 }]);
  });

  it('refreshes an active party when its ladder tops again', () => {
    const g = rules();
    for (let i = 0; i < RULES.ladderSteps; i++) g.onSlot(BALL);
    g.tick(20);
    for (let i = 0; i < RULES.ladderSteps; i++) g.onSlot(BALL);
    expect(g.partyEnds.ball).toBe(20 + RULES.partySeconds);
  });
});

describe('lucky slot', () => {
  it('drops a pearl only when the chance roll succeeds, and never moves ladders', () => {
    const hit = rules(RULES.luckyPearlChance - 0.001);
    hit.onSlot(BALL);
    expect(hit.onSlot(LUCKY)).toEqual([{ type: 'dropPearl' }]);
    const miss = rules(RULES.luckyPearlChance);
    miss.onSlot(BALL);
    expect(miss.onSlot(LUCKY)).toEqual([]);
    expect(hit.ladder).toEqual({ ball: 1, ticket: 0 });
    expect(miss.ladder).toEqual({ ball: 1, ticket: 0 });
  });
});

describe('pearl pockets', () => {
  it('pays normal values outside Ball Party, including yellow', () => {
    const g = rules();
    expect(g.onPocket('green')).toBe(RULES.pocketPay.normal.green);
    expect(g.onPocket('red')).toBe(RULES.pocketPay.normal.red);
    expect(g.onPocket('yellow')).toBe(RULES.pocketPay.normal.yellow);
    expect(g.jackpot).toBe(RULES.jackpotBase);
  });

  it('pays the progressive jackpot on yellow during Ball Party and can pay it twice in one party', () => {
    const g = rules();
    g.tryLaunch();
    g.shots = 0;
    g.tryLaunch();
    const grown = RULES.jackpotBase + 2 * RULES.jackpotPerCredit;
    expect(g.jackpot).toBe(grown);
    for (let i = 0; i < RULES.ladderSteps; i++) g.onSlot(BALL);
    expect(g.onPocket('red')).toBe(RULES.pocketPay.party.red);
    expect(g.onPocket('yellow')).toBe(grown);
    expect(g.jackpot).toBe(RULES.jackpotBase);
    expect(g.onPocket('yellow')).toBe(RULES.jackpotBase);
  });
});
