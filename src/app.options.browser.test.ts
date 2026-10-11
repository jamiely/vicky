import { describe, expect, it } from 'vitest';
import { optionsFromUrl } from './app';

describe('optionsFromUrl', () => {
  it.each([
    ['', { seed: 2 ** 30, debug: false }],
    ['?seed=42', { seed: 42, debug: false }],
    ['?seed=abc', { seed: 2 ** 30, debug: false }],
    ['?debug', { seed: 2 ** 30, debug: true }],
    ['?debug=1&seed=7', { seed: 7, debug: true }],
    ['?debug=0', { seed: 2 ** 30, debug: false }],
  ])('%s → %o', (search, expected) => {
    expect(optionsFromUrl(search, () => 0.5)).toEqual(expected);
  });
});
