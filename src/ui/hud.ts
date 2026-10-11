import type { GameRules, Notice } from '../rules/game';

const FEED_LIMIT = 5;
const FEED_MS = 4000;

/** DOM overlay: counters, party countdown, event feed, and the player's buttons. Builds its own markup. */
export class Hud {
  readonly credit: HTMLButtonElement;
  readonly launch: HTMLButtonElement;
  readonly reset: HTMLButtonElement;
  readonly mute: HTMLButtonElement;
  private readonly counters: Record<'credits' | 'shots' | 'tickets' | 'jackpot', HTMLElement>;
  private readonly party: HTMLElement;
  private readonly feed: HTMLOListElement;
  private version = -1;
  private second = -1;

  constructor(host: HTMLElement, creditBatch: number) {
    const top = document.createElement('header');
    top.className = 'hud-top';
    const stat = (label: string, extra = ''): HTMLElement => {
      const box = document.createElement('div');
      box.className = `stat ${extra}`.trim();
      const name = document.createElement('span');
      name.textContent = label;
      const value = document.createElement('strong');
      value.textContent = '0';
      box.append(name, value);
      top.append(box);
      return value;
    };
    this.counters = { credits: stat('Credits'), shots: stat('Shots'), tickets: stat('Tickets'), jackpot: stat('Jackpot', 'jackpot') };
    this.party = document.createElement('div');
    this.party.className = 'stat party';
    this.party.setAttribute('role', 'status');
    this.party.hidden = true;
    top.append(this.party);

    this.feed = document.createElement('ol');
    this.feed.className = 'feed';
    this.feed.setAttribute('aria-live', 'polite');

    const bottom = document.createElement('footer');
    bottom.className = 'hud-bottom';
    const button = (label: string, className = ''): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = className;
      b.innerHTML = label;
      bottom.append(b);
      return b;
    };
    this.credit = button(`+${creditBatch} CREDITS`);
    this.launch = button('LAUNCH <small>hold · Space</small>', 'launch');
    this.reset = button('RESET');
    this.mute = button('SOUND ON', 'mute');
    host.append(top, this.feed, bottom);
  }

  setMuted(muted: boolean): void {
    this.mute.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    this.mute.setAttribute('aria-pressed', String(muted));
  }

  update(rules: GameRules): void {
    const second = Math.floor(rules.now);
    if (rules.version === this.version && second === this.second) return;
    this.version = rules.version;
    this.second = second;
    this.counters.credits.textContent = String(rules.credits);
    this.counters.shots.textContent = String(rules.shots);
    this.counters.tickets.textContent = rules.tickets.toLocaleString('en-US');
    this.counters.jackpot.textContent = rules.jackpot.toLocaleString('en-US');
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
