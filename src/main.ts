import './style.css';
import { Game } from './app';

const params = new URLSearchParams(location.search);
const game = await Game.create(document.querySelector<HTMLElement>('#app')!, {
  seed: Number(params.get('seed') ?? Math.floor(Math.random() * 2 ** 31)),
  debug: params.has('debug') && params.get('debug') !== '0',
  autoStart: true,
});

if (import.meta.env.DEV) Object.assign(window, { vicky: game });
