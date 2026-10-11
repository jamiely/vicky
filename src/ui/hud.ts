import type { GameRules, Notice } from '../rules/game';

const FEED_LIMIT = 5;
const FEED_MS = 4000;

/** DOM overlay: counters, party countdown, and a short event feed. */
export class Hud {
  private readonly credits = must('#credits');
  private readonly shots = must('#shots');
  private readonly tickets = must('#tickets');
  private readonly jackpot = must('#jackpot');
  private readonly party = must('#party');
  private readonly feed = must('#feed');
  private version = -1;
  private second = -1;

  update(rules: GameRules): void {
    const second = Math.floor(rules.now);
    if (rules.version === this.version && second === this.second) return;
    this.version = rules.version;
    this.second = second;
    this.credits.textContent = String(rules.credits);
    this.shots.textContent = String(rules.shots);
    this.tickets.textContent = rules.tickets.toLocaleString('en-US');
    this.jackpot.textContent = rules.jackpot.toLocaleString('en-US');
    const parts: string[] = [];
    for (const side of ['ball', 'ticket'] as const) {
      const ends = rules.partyEnds[side];
      if (ends !== null) parts.push(`${side.toUpperCase()} PARTY ${Math.ceil(ends - rules.now)}s`);
    }
    this.party.hidden = parts.length === 0;
    this.party.textContent = parts.join(' · ');
  }

  push(notice: Notice): void {
    const item = document.createElement('li');
    item.className = `tone-${notice.tone}`;
    item.textContent = notice.text;
    this.feed.prepend(item);
    while (this.feed.children.length > FEED_LIMIT) this.feed.lastElementChild!.remove();
    setTimeout(() => item.remove(), FEED_MS);
  }
}

function must(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}
