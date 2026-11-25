import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module shared with the Electron main process
import { windowLayout } from '../electron/window.mjs';

const portrait = {
  bounds: { x: 0, y: 0, width: 1080, height: 1920 },
  workArea: { x: 0, y: 0, width: 1080, height: 1872 },
};

describe('electron windowLayout', () => {
  it('fills the work area of a portrait display without the flag', () => {
    expect(windowLayout(portrait, ['Neon Reef.exe'])).toEqual({
      fullscreen: false,
      bounds: { x: 0, y: 0, width: 1080, height: 1872 },
    });
  });

  it('covers the whole display with --fullscreen', () => {
    expect(windowLayout(portrait, ['Neon Reef.exe', '--fullscreen'])).toEqual({
      fullscreen: true,
      bounds: { x: 0, y: 0, width: 1080, height: 1920 },
    });
  });
});
