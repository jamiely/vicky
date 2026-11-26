import { RUN } from '../config';

/**
 * One free-play run. `ready` → `playing` → (`suddenDeath` ↔ `playing`) → `lastCall` → `sweep` → `over`.
 * - Each shot spends one ball from the stock; each white ball pushed off the tray's front edge returns one, until Last Call.
 * - Out of balls with none on the board: before Last Call a short sudden-death window lets tray spills revive the run;
 *   at Last Call (or when the window closes) the pusher sweeps the tray as a finale, then the run is over.
 */
export type RunPhase = 'ready' | 'playing' | 'suddenDeath' | 'lastCall' | 'sweep' | 'over';
export type RunEvent = 'lastCall' | 'suddenDeath' | 'revive' | 'sweep' | 'over' | 'lowStock';

export class Run {
  phase: RunPhase = 'ready';
  stock = 0;
  /** Score of the finished run, kept after the machine is reset for the next one. */
  finalScore = 0;
  now = 0;
  private started = 0;
  private since = 0;
  private events: RunEvent[] = [];

  get active(): boolean {
    return this.phase === 'playing' || this.phase === 'suddenDeath' || this.phase === 'lastCall' || this.phase === 'sweep';
  }

  /** Seconds until Last Call; 0 once it has been called. */
  get clock(): number {
    return this.phase === 'playing' || this.phase === 'suddenDeath' ? Math.max(0, RUN.lastCallSeconds - (this.now - this.started)) : 0;
  }

  /** Seconds left in the sudden-death window. */
  get graceLeft(): number {
    return this.phase === 'suddenDeath' ? Math.max(0, RUN.suddenDeathSeconds - (this.now - this.since)) : 0;
  }

  /** A press can start a run: before the first one, or once the last one has been over for a moment. */
  get canStart(): boolean {
    return this.phase === 'ready' || (this.phase === 'over' && this.now - this.since >= RUN.overLockSeconds);
  }

  start(now: number): void {
    this.now = this.started = this.since = now;
    this.phase = 'playing';
    this.stock = RUN.startStock;
    this.finalScore = 0;
  }

  /** Spends a ball for one shot; false when the stock is empty or the run is not taking shots. */
  fire(): boolean {
    if (this.stock === 0 || (this.phase !== 'playing' && this.phase !== 'lastCall')) return false;
    this.stock--;
    if (this.stock === RUN.lowStock) this.events.push('lowStock');
    return true;
  }

  /** A white ball left the tray's front edge: it returns to the stock until Last Call. */
  ballOut(): void {
    if (this.phase !== 'playing' && this.phase !== 'suddenDeath') return;
    this.stock = Math.min(RUN.stockCap, this.stock + 1);
    if (this.phase === 'suddenDeath') {
      this.phase = 'playing';
      this.events.push('revive');
    }
  }

  /**
   * Advances the run to simulated time `now`. `boardBalls` counts shots still falling through the pegs; `settled` is
   * true once nothing is left to pay (no pearl in the chute or rolling on the disk).
   */
  tick(now: number, boardBalls: number, settled: boolean, score: number): void {
    this.now = now;
    if ((this.phase === 'playing' || this.phase === 'suddenDeath') && now - this.started >= RUN.lastCallSeconds) {
      this.enter('lastCall');
    }
    const empty = this.stock === 0 && boardBalls === 0;
    if (this.phase === 'playing' && empty) this.enter('suddenDeath');
    else if (this.phase === 'suddenDeath' && now - this.since >= RUN.suddenDeathSeconds) this.enter('sweep');
    else if (this.phase === 'lastCall' && empty) this.enter('sweep');
    else if (this.phase === 'sweep' && now - this.since >= RUN.sweepSeconds && (settled || now - this.since >= RUN.sweepMaxSeconds)) {
      this.finalScore = score;
      this.enter('over');
    }
  }

  /** Calls Last Call early (debug). */
  callLast(): void {
    if (this.phase === 'playing' || this.phase === 'suddenDeath') this.enter('lastCall');
  }

  drainEvents(): RunEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private enter(phase: RunPhase): void {
    this.phase = phase;
    this.since = this.now;
    this.events.push(phase as RunEvent);
  }
}
