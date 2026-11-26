import { RULES, SLOTS, type PocketColor } from '../config';

export type Side = 'ball' | 'ticket';
export type Effect = { type: 'dropBalls'; count: number } | { type: 'dropPearl' };
export interface Notice {
  text: string;
  tone: 'info' | 'win' | 'party' | 'jackpot' | 'loss';
}

/**
 * Pure game rules. Driven by simulated time (`tick`) and physics outcomes (`onSlot`, `onPocket`);
 * answers with `Effect`s the physics layer must perform. Fields are public for read-only use by HUD/LCD.
 */
export class GameRules {
  /** Tickets won this run: the score. */
  tickets = 0;
  /** Shots fired this run. */
  shots = 0;
  jackpot: number = RULES.jackpotBase;
  ladder: Record<Side, number> = { ball: 0, ticket: 0 };
  /** Simulated time at which each party ends; null when inactive. */
  partyEnds: Record<Side, number | null> = { ball: null, ticket: null };
  now = 0;
  /** Increments on every state change so views can skip redundant redraws. */
  version = 0;
  /** Pearls waiting at the top of the tower; LUCKY releases one onto the tray. */
  pearlReserve: number = RULES.pearlReserveStart;
  private notices: Notice[] = [];

  /** Counts a launched shot; every `jackpotShots` shots grow the progressive jackpot by one. */
  onShot(): void {
    this.shots++;
    if (this.shots % RULES.jackpotShots === 0) this.jackpot++;
    this.version++;
  }

  /**
   * Starts a new run's scoring. The machine carries over, as on a real cabinet: the jackpot and the tower's pearls;
   * the score, ladders, and parties start fresh.
   */
  newRun(): void {
    this.tickets = 0;
    this.shots = 0;
    this.ladder = { ball: 0, ticket: 0 };
    this.endParties();
  }

  /** Ends any running party silently (a run ended; nobody is playing it). */
  endParties(): void {
    this.partyEnds = { ball: null, ticket: null };
    this.version++;
  }

  tick(now: number): void {
    this.now = now;
    for (const side of ['ball', 'ticket'] as const) {
      const ends = this.partyEnds[side];
      if (ends !== null && now >= ends) {
        this.partyEnds[side] = null;
        this.notices.push({ text: `${side === 'ball' ? 'Ball' : 'Ticket'} Party Time over`, tone: 'info' });
        this.version++;
      }
    }
  }

  onSlot(index: number): Effect[] {
    const kind = SLOTS[index];
    if (kind === undefined) throw new RangeError(`no slot ${index}`);
    this.version++;
    switch (kind) {
      case 'ball': {
        const count = RULES.ballsPerBallHit * (this.partyEnds.ball !== null ? 2 : 1);
        this.ladder.ticket = Math.max(0, this.ladder.ticket - RULES.ladderKnockback);
        this.notices.push({ text: `BALL: +${count} balls`, tone: 'win' });
        this.advance('ball');
        return [{ type: 'dropBalls', count }];
      }
      case 'ticket': {
        const top = RULES.ticketLadder[RULES.ticketLadder.length - 1]!;
        const pay = this.partyEnds.ticket !== null ? top : RULES.ticketLadder[this.ladder.ticket]!;
        this.tickets += pay;
        this.ladder.ball = Math.max(0, this.ladder.ball - RULES.ladderKnockback);
        this.notices.push({ text: `TICKET: +${pay}`, tone: 'win' });
        this.advance('ticket');
        return [];
      }
      case 'lucky':
        if (this.pearlReserve === 0) {
          this.notices.push({ text: 'BIG BALL LUCKY: tower is empty', tone: 'info' });
          return [];
        }
        this.pearlReserve--;
        this.notices.push({ text: `BIG BALL LUCKY: pearl released (${this.pearlReserve} left in tower)`, tone: 'win' });
        return [{ type: 'dropPearl' }];
    }
  }

  /** Pays a pearl that settled in a disk pocket; returns tickets paid. */
  onPocket(color: PocketColor): number {
    const ballParty = this.partyEnds.ball !== null;
    let pay: number;
    if (ballParty && color === 'yellow') {
      pay = this.jackpot;
      this.jackpot = RULES.jackpotBase;
      this.notices.push({ text: `SUPER JACKPOT! +${pay}`, tone: 'jackpot' });
    } else {
      pay = ballParty && color !== 'yellow' ? RULES.pocketPay.party[color] : RULES.pocketPay.normal[color];
      this.notices.push({ text: `Pearl in ${color}: +${pay}`, tone: 'win' });
    }
    this.tickets += pay;
    this.version++;
    return pay;
  }

  /** A pearl fell off a tray side instead of reaching the disk (it still rides the lift back). */
  notePearlLost(): void {
    this.notices.push({ text: 'Pearl lost down the side', tone: 'loss' });
    this.version++;
  }

  /** A pearl reached the top of the tower lift. */
  returnPearl(): void {
    this.pearlReserve++;
    this.version++;
  }

  drainNotices(): Notice[] {
    const out = this.notices;
    this.notices = [];
    return out;
  }

  private advance(side: Side): void {
    this.ladder[side]++;
    if (this.ladder[side] < RULES.ladderSteps) return;
    this.ladder[side] = 0;
    this.partyEnds[side] = this.now + RULES.partySeconds;
    this.notices.push({ text: `${side === 'ball' ? 'BALL' : 'TICKET'} PARTY TIME! ${RULES.partySeconds}s`, tone: 'party' });
  }
}
