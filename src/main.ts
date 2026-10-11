import { Game, optionsFromUrl } from './app';

const game = await Game.create(document.querySelector<HTMLElement>('#app')!, { ...optionsFromUrl(location.search, Math.random), autoStart: true });

if (import.meta.env.DEV) Object.assign(window, { vicky: game });
