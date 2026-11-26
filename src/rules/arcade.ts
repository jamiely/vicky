/**
 * Cabinet helpers ported from Glowfall (`../glowfall/src/rules/arcade.ts`): one-button initials, the high-score
 * table, and the attract cycle. Time is supplied in seconds; no browser or storage dependencies.
 */
export class ButtonLatch {
  held = false;
  down(repeat = false): boolean {
    if (repeat || this.held) return false;
    this.held = true;
    return true;
  }
  up(): void {
    this.held = false;
  }
}

/** Three letters with one button: tap steps the current letter A→Z, holding 0.6 s locks it; 10 s idle locks the rest. */
export class InitialsEntry {
  letters = [0, 0, 0];
  index = 0;
  private readonly button = new ButtonLatch();
  private started = 0;
  private locked = false;
  private idle: number;

  constructor(now: number) {
    this.idle = now;
  }

  get text(): string {
    return this.letters.map((n) => String.fromCharCode(65 + n)).join('');
  }

  get done(): boolean {
    return this.index === 3;
  }

  down(now: number, repeat = false): void {
    if (this.done || !this.button.down(repeat)) return;
    this.started = now;
    this.idle = now;
    this.locked = false;
  }

  up(now: number): void {
    if (!this.button.held) return;
    this.tick(now);
    if (!this.done && !this.locked) this.step(1, now);
    this.button.up();
    this.idle = now;
  }

  step(direction: number, now: number): void {
    if (this.done) return;
    this.letters[this.index] = (this.letters[this.index]! + direction + 26) % 26;
    this.idle = now;
  }

  /** Hold progress toward locking the current letter, 0..1. */
  progress(now: number): number {
    return this.button.held && !this.locked ? Math.min(1, (now - this.started) / 0.6) : 0;
  }

  tick(now: number): void {
    if (this.done) return;
    if (this.button.held && !this.locked && now - this.started >= 0.6) {
      this.index++;
      this.locked = true;
      this.idle = now;
    }
    if (now - this.idle >= 10) this.index = 3;
  }
}

export interface HighScore {
  initials: string;
  score: number;
}

/** Parses a stored table, dropping malformed rows; best first, at most ten. */
export function highScores(value: unknown): HighScore[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is HighScore =>
        typeof v === 'object' && v !== null && typeof v.initials === 'string' && /^[A-Z]{3}$/.test(v.initials) && Number.isSafeInteger(v.score) && v.score > 0,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

export function qualifies(table: HighScore[], score: number): boolean {
  return score > 0 && (table.length < 10 || score > table[table.length - 1]!.score);
}

export function addHighScore(table: HighScore[], entry: HighScore): HighScore[] {
  return highScores([...table, entry]);
}

/** After 30 s without input between runs: title (6 s) → live machine (30 s) → scores (10 s) → how to play (10 s) → … */
export type AttractPage = 'title' | 'machine' | 'scores' | 'how';
const PAGES: AttractPage[] = ['title', 'machine', 'scores', 'how'];
const PAGE_SECONDS: Record<AttractPage, number> = { title: 6, machine: 30, scores: 10, how: 10 };

export class AttractCycle {
  page: AttractPage | null = null;
  private since: number;
  private changed = 0;

  constructor(now: number) {
    this.since = now;
  }

  input(now: number): void {
    this.page = null;
    this.since = now;
  }

  tick(now: number, eligible: boolean): void {
    if (!eligible) {
      this.input(now);
      return;
    }
    if (this.page === null) {
      if (now - this.since >= 30) {
        this.page = 'title';
        this.changed = now;
      }
    } else if (now - this.changed >= PAGE_SECONDS[this.page]) {
      this.page = PAGES[(PAGES.indexOf(this.page) + 1) % PAGES.length]!;
      this.changed = now;
    }
  }
}
