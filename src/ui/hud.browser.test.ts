import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN } from '../config';
import { InitialsEntry, type HighScore } from '../rules/arcade';
import { GameRules } from '../rules/game';
import { Run } from '../rules/run';
import { clock, Hud, type ArcadeView } from './hud';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('main');
  document.body.append(host);
});
afterEach(() => {
  host.remove();
  vi.useRealTimers();
});

const stat = (label: string): string => [...host.querySelectorAll('.stat')].find((s) => s.querySelector('span')?.textContent === label)!.querySelector('strong')!.textContent!;
const overlay = (): HTMLElement => host.querySelector<HTMLElement>('.overlay')!;
const banner = (): HTMLElement => host.querySelector<HTMLElement>('.stat.banner')!;
const view = (run: Run, extra: Partial<ArcadeView> = {}): ArcadeView => ({ run, scores: [], initials: null, continueSeconds: null, attract: null, now: run.now, ...extra });

function playing(at = 0): Run {
  const run = new Run();
  run.start(at);
  return run;
}

describe('Hud', () => {
  it('formats the Last Call clock as m:ss, rounding up', () => {
    expect([clock(240), clock(59.2), clock(0)]).toEqual(['4:00', '1:00', '0:00']);
  });

  it('shows the run counters with thousands separators, and the best score', () => {
    const hud = new Hud(host);
    const rules = new GameRules();
    const run = playing();
    run.stock = 42;
    run.now = 70;
    rules.tickets = 12345;
    rules.jackpot = 1210;
    hud.update(rules, view(run, { scores: [{ initials: 'JLY', score: 9000 }] }));
    expect(stat('Balls')).toBe('42');
    expect(stat('Last call')).toBe('2:50');
    expect(stat('Score')).toBe('12,345');
    expect(stat('Hi score')).toBe('9,000');
    expect(stat('Jackpot')).toBe('1,210');
    expect(overlay().hidden).toBe(true);
  });

  it('flags low stock, sudden death, Last Call, and the final push', () => {
    const hud = new Hud(host);
    const rules = new GameRules();
    const run = playing();
    run.stock = RUN.lowStock;
    hud.update(rules, view(run));
    expect(host.querySelector('.stat.balls')!.classList.contains('low')).toBe(true);
    expect(banner().hidden).toBe(true);
    run.stock = 0;
    run.tick(1, 0, true, 0);
    hud.update(rules, view(run));
    expect(banner().hidden).toBe(false);
    expect(banner().textContent).toBe(`SUDDEN DEATH ${RUN.suddenDeathSeconds} · a ball off the front saves you`);
    run.ballOut();
    run.callLast();
    hud.update(rules, view(run));
    expect(banner().textContent).toBe('LAST CALL · 1 left · no refills');
    expect(stat('Last call')).toBe('NOW');
    run.stock = 0;
    run.tick(300, 0, true, 0);
    hud.update(rules, view(run));
    expect(banner().textContent).toBe('FINAL PUSH');
  });

  it('shows party countdowns only during a run', () => {
    const hud = new Hud(host);
    const rules = new GameRules();
    const party = host.querySelector<HTMLElement>('.stat.party')!;
    rules.now = 2;
    rules.partyEnds.ball = 33;
    rules.partyEnds.ticket = 12.5;
    hud.update(rules, view(new Run()));
    expect(party.hidden).toBe(true);
    hud.update(rules, view(playing()));
    expect(party.hidden).toBe(false);
    expect(party.textContent).toBe('BALL PARTY 31s · TICKET PARTY 11s');
  });

  it('between runs shows the title, the result with its rank and the play-again countdown, and the attract pages', () => {
    const hud = new Hud(host);
    const rules = new GameRules();
    const run = new Run();
    hud.update(rules, view(run));
    expect(overlay().hidden).toBe(false);
    expect(overlay().textContent).toContain('PRESS ● TO PLAY');
    expect(stat('Balls')).toBe(String(RUN.startStock));
    run.finalScore = 5000;
    run.phase = 'over';
    const scores: HighScore[] = [{ initials: 'AAA', score: 9000 }, { initials: 'JLY', score: 5000 }];
    hud.update(rules, view(run, { scores, continueSeconds: 7 }));
    expect(overlay().textContent).toContain('RUN OVER');
    expect(overlay().textContent).toContain('5,000');
    expect(overlay().textContent).toContain('#2 on this cabinet');
    expect(overlay().textContent).toContain('PRESS ● TO PLAY AGAIN · 7');
    expect(stat('Score')).toBe('5,000');
    hud.update(rules, view(run, { scores, attract: 'scores' }));
    expect([...host.querySelectorAll('.high-scores li')].map((li) => li.textContent)).toEqual(['AAA9,000', 'JLY5,000']);
    hud.update(rules, view(run, { attract: 'scores' }));
    expect(host.querySelector('.high-scores')!.textContent).toBe('YOUR NAME HERE');
    hud.update(rules, view(run, { attract: 'how' }));
    expect(overlay().textContent).toContain('LAST CALL');
    hud.update(rules, view(run, { attract: 'machine' }));
    expect(overlay().hidden).toBe(true);
    expect(banner().textContent).toBe('FREE PLAY · PRESS ● TO PLAY');
  });

  it('shows initials entry with the current letter, locked letters, and hold progress', () => {
    const hud = new Hud(host);
    const run = new Run();
    run.phase = 'over';
    run.finalScore = 777;
    const initials = new InitialsEntry(0);
    initials.down(0);
    initials.tick(0.7); // locks the first letter
    initials.up(0.7);
    initials.down(1);
    hud.update(new GameRules(), view(run, { initials, now: 1.3 }));
    expect(overlay().textContent).toContain('NEW HIGH SCORE');
    expect(host.querySelector('.initials')!.getAttribute('aria-label')).toBe('Initials AAA');
    const letters = [...host.querySelectorAll<HTMLElement>('.initial')];
    expect(letters.map((l) => l.className)).toEqual(['initial locked', 'initial current', 'initial ']);
    expect(letters[1]!.querySelector('i')!.style.transform).toBe('scaleX(0.5)');
  });

  it('keeps the newest five feed entries and expires them after four seconds', () => {
    vi.useFakeTimers();
    const hud = new Hud(host);
    for (let i = 0; i < 7; i++) hud.push({ text: `n${i}`, tone: i === 6 ? 'jackpot' : 'info' });
    const items = [...host.querySelectorAll('.feed li')];
    expect(items.map((li) => li.textContent)).toEqual(['n6', 'n5', 'n4', 'n3', 'n2']);
    expect(items[0]!.className).toBe('tone-jackpot');
    vi.advanceTimersByTime(4000);
    expect(host.querySelectorAll('.feed li')).toHaveLength(0);
  });

  it('labels the mute button with the current state', () => {
    const hud = new Hud(host);
    hud.setMuted(true);
    expect(hud.mute.textContent).toBe('SOUND OFF');
    expect(hud.mute.getAttribute('aria-pressed')).toBe('true');
    hud.setMuted(false);
    expect(hud.mute.textContent).toBe('SOUND ON');
  });
});
