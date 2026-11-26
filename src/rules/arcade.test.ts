// Ported with arcade.ts from ../glowfall/src/rules/arcade.test.ts (initials and table), plus the attract cycle.
import { describe, expect, it } from 'vitest';
import { addHighScore, AttractCycle, highScores, InitialsEntry, qualifies } from './arcade';

describe('one-button initials', () => {
  it('taps to advance and holds to lock while still down, once per release', () => {
    const entry = new InitialsEntry(0);
    entry.down(0);
    entry.up(0.2);
    expect(entry.text).toBe('BAA');
    entry.down(1);
    entry.tick(1.61);
    expect(entry.index).toBe(1);
    entry.tick(2);
    expect(entry.index).toBe(1);
    entry.up(2);
    expect(entry.text).toBe('BAA');
    entry.down(3);
    entry.up(3.2);
    expect(entry.text).toBe('BBA');
    entry.up(3.3); // a release without a press does nothing
    expect(entry.text).toBe('BBA');
  });

  it.each([true, false])('ignores duplicate keydowns repeat=%s without resetting a hold', (repeat) => {
    const entry = new InitialsEntry(0);
    entry.down(1);
    entry.down(1.3, repeat);
    entry.down(1.5, repeat);
    expect(entry.progress(1.5)).toBeCloseTo(5 / 6);
    expect(entry.text).toBe('AAA');
    entry.tick(1.61);
    expect(entry.index).toBe(1);
    entry.down(1.8, repeat);
    entry.up(2);
    expect(entry.index).toBe(1);
    expect(entry.text).toBe('AAA');
  });

  it('locks remaining letters as shown after ten idle seconds, then ignores input', () => {
    const entry = new InitialsEntry(0);
    entry.step(-1, 2);
    entry.tick(11.9);
    expect(entry.done).toBe(false);
    entry.tick(12);
    expect(entry.done).toBe(true);
    expect(entry.text).toBe('ZAA');
    entry.step(1, 13);
    entry.down(13);
    entry.tick(20);
    expect(entry.text).toBe('ZAA');
    expect(entry.progress(20)).toBe(0);
  });
});

it('orders and trims the top ten; ties at the cutoff do not qualify', () => {
  let table = highScores(null);
  expect(qualifies(table, 0)).toBe(false);
  for (let score = 1; score <= 12; score++) table = addHighScore(table, { initials: 'AAA', score });
  expect(table.map((v) => v.score)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  expect(qualifies(table, 3)).toBe(false);
  expect(qualifies(table, 4)).toBe(true);
  expect(highScores([{ initials: '<b>', score: 99 }, { initials: 'AAA', score: -1 }, null])).toEqual([]);
});

describe('attract cycle', () => {
  it('starts after 30 s idle, cycles title → machine → scores → how, and any input stops it', () => {
    const attract = new AttractCycle(0);
    attract.tick(29.9, true);
    expect(attract.page).toBeNull();
    attract.tick(30, true);
    expect(attract.page).toBe('title');
    const pages: (string | null)[] = [];
    for (const t of [36, 66, 76, 86]) {
      attract.tick(t, true);
      pages.push(attract.page);
    }
    expect(pages).toEqual(['machine', 'scores', 'how', 'title']);
    attract.input(90);
    expect(attract.page).toBeNull();
    attract.tick(119, true);
    expect(attract.page).toBeNull();
  });

  it('does not run while ineligible (a run is playing), and restarts the idle clock', () => {
    const attract = new AttractCycle(0);
    attract.tick(100, false);
    expect(attract.page).toBeNull();
    attract.tick(129, true);
    expect(attract.page).toBeNull();
    attract.tick(130, true);
    expect(attract.page).toBe('title');
  });
});
