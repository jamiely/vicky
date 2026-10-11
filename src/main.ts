import { Game, optionsFromUrl } from './app';

const game = await Game.create(document.querySelector<HTMLElement>('#app')!, { ...optionsFromUrl(location.search, Math.random), autoStart: true });

// Debug/test handle: always in dev, and in builds with `?test` (used by the Electron smoke check).
if (import.meta.env.DEV || new URLSearchParams(location.search).has('test')) Object.assign(window, { vicky: game });
