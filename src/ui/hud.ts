import { RUN } from '../config';
import type { AttractPage, HighScore, InitialsEntry } from '../rules/arcade';
import type { GameRules, Notice } from '../rules/game';
import type { Run } from '../rules/run';

const FEED_LIMIT = 5;
const FEED_MS = 4000;

/** Between-run state the overlay shows; null fields are inactive. */
export interface ArcadeView {
  run: Run;
  scores: HighScore[];
  initials: InitialsEntry | null;
  /** Seconds left to play again with the same machine; null when not offered. */
  continueSeconds: number | null;
  attract: AttractPage | null;
  now: number;
}

const fmt = (n: number): string => n.toLocaleString('en-US');
/** Writes text only when it changed (update runs every frame). */
const set = (el: HTMLElement, text: string): void => {
  if (el.textContent !== text) el.textContent = text;
};
export const clock = (seconds: number): string => {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** DOM overlay: counters, run banners, the between-run card, event feed, and the player's buttons. */
export class Hud {
  readonly launch: HTMLButtonElement;
  readonly reset: HTMLButtonElement;
  readonly mute: HTMLButtonElement;
  private readonly counters: Record<'balls' | 'time' | 'score' | 'high' | 'jackpot', HTMLElement>;
  private readonly party: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly feed: HTMLOListElement;
  private html = '';

  constructor(host: HTMLElement) {
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
    this.counters = {
      balls: stat('Balls', 'balls'),
      time: stat('Last call'),
      score: stat('Score'),
      high: stat('Hi score'),
      jackpot: stat('Jackpot', 'jackpot'),
    };
    // Run banners and party countdowns: under the counters in landscape, in the band below the tray in portrait.
    const alerts = document.createElement('div');
    alerts.className = 'hud-alerts';
    const badge = (className: string): HTMLElement => {
      const el = document.createElement('div');
      el.className = `stat ${className}`;
      el.setAttribute('role', 'status');
      el.hidden = true;
      alerts.append(el);
      return el;
    };
    this.banner = badge('banner');
    this.party = badge('party');

    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    this.overlay.hidden = true;

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
    this.launch = button('LAUNCH <small>hold · Space</small>', 'launch');
    this.reset = button('RESET');
    this.mute = button('SOUND ON', 'mute');
    host.append(top, alerts, this.overlay, this.feed, bottom);
  }

  setMuted(muted: boolean): void {
    this.mute.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    this.mute.setAttribute('aria-pressed', String(muted));
  }

  update(rules: GameRules, view: ArcadeView): void {
    const { run } = view;
    const playing = run.active;
    set(this.counters.balls, String(playing ? run.stock : RUN.startStock));
    this.counters.balls.parentElement!.classList.toggle('low', playing && run.stock <= RUN.lowStock);
    set(this.counters.time, run.phase === 'playing' || run.phase === 'suddenDeath' ? clock(run.clock) : playing ? 'NOW' : clock(RUN.lastCallSeconds));
    set(this.counters.score, fmt(playing ? rules.tickets : run.finalScore));
    set(this.counters.high, fmt(view.scores[0]?.score ?? 0));
    set(this.counters.jackpot, fmt(rules.jackpot));

    const parts: string[] = [];
    for (const side of ['ball', 'ticket'] as const) {
      const ends = rules.partyEnds[side];
      if (ends !== null && playing) parts.push(`${side.toUpperCase()} PARTY ${Math.ceil(ends - rules.now)}s`);
    }
    this.party.hidden = parts.length === 0;
    set(this.party, parts.join(' · '));

    const banner =
      run.phase === 'suddenDeath'
        ? `SUDDEN DEATH ${Math.ceil(run.graceLeft)} · a ball off the front saves you`
        : run.phase === 'lastCall'
          ? `LAST CALL · ${run.stock} left · no refills`
          : run.phase === 'sweep'
            ? 'FINAL PUSH'
            : view.attract === 'machine'
              ? 'FREE PLAY · PRESS ● TO PLAY'
              : '';
    this.banner.hidden = banner === '';
    set(this.banner, banner);
    this.banner.dataset.kind = run.phase;

    const html = playing || view.attract === 'machine' ? '' : this.card(view);
    this.overlay.hidden = html === '';
    if (html !== this.html) {
      this.html = html;
      this.overlay.innerHTML = html;
    }
  }

  /** The between-run card: title, result, initials entry, high scores, or how to play. */
  private card(view: ArcadeView): string {
    const { run, initials, attract } = view;
    const action = (text: string): string => `<div class="overlay-action">${text}</div>`;
    if (initials) {
      const letters = [...initials.text]
        .map((letter, i) => {
          const state = i < initials.index ? 'locked' : i === initials.index ? 'current' : '';
          const fill = i < initials.index ? 1 : i === initials.index ? initials.progress(view.now) : 0;
          return `<div class="initial ${state}">${letter}<i style="transform:scaleX(${fill.toFixed(2)})"></i></div>`;
        })
        .join('');
      return `<div class="eyebrow">NEW HIGH SCORE</div><h1>${fmt(run.finalScore)}</h1><div class="initials" aria-label="Initials ${initials.text}">${letters}</div>${action('TAP · NEXT LETTER &nbsp; HOLD · LOCK')}`;
    }
    if (attract === 'scores') return `<div class="eyebrow">THIS CABINET</div><h1>HIGH SCORES</h1>${this.table(view.scores)}${action('PRESS ● TO PLAY')}`;
    if (attract === 'how') {
      return `<div class="eyebrow">HOW TO PLAY</div><h1>KEEP THE BALLS COMING</h1><ol class="how">
        <li>Hold ● to fire. Each shot costs one ball.</li>
        <li>Every ball the pusher shoves off the front comes back to you.</li>
        <li>Pearls pushed off the front spin the disk for big scores.</li>
        <li>At ${clock(RUN.lastCallSeconds)} it's LAST CALL: no refills. Out of balls, it's over.</li></ol>${action('PRESS ● TO PLAY')}`;
    }
    if (view.continueSeconds !== null) {
      const rank = view.scores.findIndex((s) => s.score === run.finalScore);
      const placed = rank >= 0 ? `<p>#${rank + 1} on this cabinet</p>` : '';
      return `<div class="eyebrow">RUN OVER</div><h1>${fmt(run.finalScore)}</h1>${placed}${action(`PRESS ● TO PLAY AGAIN · ${view.continueSeconds}`)}`;
    }
    return `<div class="eyebrow">FREE PLAY</div><h1>NEON <span>REEF</span></h1><p>Start with ${RUN.startStock} balls. Every ball pushed off the front comes back.<br>Go broke, and the run is over.</p>${action('PRESS ● TO PLAY')}`;
  }

  private table(scores: HighScore[]): string {
    if (scores.length === 0) return '<ol class="high-scores"><li class="empty">YOUR NAME HERE</li></ol>';
    return `<ol class="high-scores">${scores.map((s) => `<li><span>${s.initials}</span><strong>${fmt(s.score)}</strong></li>`).join('')}</ol>`;
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
