import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameRules } from '../rules/game';
import { Hud } from './hud';

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

describe('Hud', () => {
  it('shows counters from the rules with thousands separators', () => {
    const hud = new Hud(host, 5);
    const rules = new GameRules();
    rules.credits = 7;
    rules.shots = 3;
    rules.tickets = 12345;
    rules.jackpot = 1210;
    rules.version++;
    hud.update(rules);
    expect(stat('Credits')).toBe('7');
    expect(stat('Shots')).toBe('3');
    expect(stat('Tickets')).toBe('12,345');
    expect(stat('Jackpot')).toBe('1,210');
    expect(host.querySelector('button')!.textContent).toBe('+5 CREDITS');
  });

  it('shows active party countdowns and hides the badge when none run', () => {
    const hud = new Hud(host, 5);
    const rules = new GameRules();
    const party = host.querySelector<HTMLElement>('.stat.party')!;
    hud.update(rules);
    expect(party.hidden).toBe(true);
    rules.now = 2;
    rules.partyEnds.ball = 33;
    rules.partyEnds.ticket = 12.5;
    rules.version++;
    hud.update(rules);
    expect(party.hidden).toBe(false);
    expect(party.textContent).toBe('BALL PARTY 31s · TICKET PARTY 11s');
  });

  it('skips DOM writes when neither the rules version nor the second changed', () => {
    const hud = new Hud(host, 5);
    const rules = new GameRules();
    hud.update(rules);
    rules.credits = 99; // mutated without a version bump
    hud.update(rules);
    expect(stat('Credits')).toBe(String(new GameRules().credits));
    rules.now = 1.5; // next second forces a refresh
    hud.update(rules);
    expect(stat('Credits')).toBe('99');
  });

  it('keeps the newest five feed entries and expires them after four seconds', () => {
    vi.useFakeTimers();
    const hud = new Hud(host, 5);
    for (let i = 0; i < 7; i++) hud.push({ text: `n${i}`, tone: i === 6 ? 'jackpot' : 'info' });
    const items = [...host.querySelectorAll('.feed li')];
    expect(items.map((li) => li.textContent)).toEqual(['n6', 'n5', 'n4', 'n3', 'n2']);
    expect(items[0]!.className).toBe('tone-jackpot');
    vi.advanceTimersByTime(4000);
    expect(host.querySelectorAll('.feed li')).toHaveLength(0);
  });

  it('labels the mute button with the current state', () => {
    const hud = new Hud(host, 5);
    hud.setMuted(true);
    expect(hud.mute.textContent).toBe('SOUND OFF');
    expect(hud.mute.getAttribute('aria-pressed')).toBe('true');
    hud.setMuted(false);
    expect(hud.mute.textContent).toBe('SOUND ON');
  });
});
