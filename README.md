# Neon Reef — Pearl Pusher

A 3D browser ball-pusher that recreates the gameplay of the *Victoria Coin Island* arcade cabinet, a "Pearl Fishery"-style machine.
three.js renders the cabinet; Rapier simulates every ball. Branding and art are original.

## Run

```sh
npm install
npm run dev          # http://localhost:5173  (add ?seed=123 for a reproducible machine)
npm run build        # dist/index.html: one self-contained file
open dist/index.html # works from file://
```

Opening the repository's root `index.html` directly does not work. It is the Vite source entry; use `npm run dev` or the built `dist/index.html`.

`npm test` runs the rules tests; `npm run typecheck` runs the type checker.

## Play

- **Hold** LAUNCH, Space, or the cabinet itself to fire balls into the peg board (2/s). Shots cannot be aimed.
- Balls land in `BALL · TICKET · BALL · BIG BALL LUCKY · TICKET · BALL · TICKET`.
  - **BALL** drops white balls onto the pusher tray and climbs the ball ladder.
  - **TICKET** pays the ticket-ladder value and climbs the ticket ladder.
  - **LUCKY** sometimes drops a big orange pearl.
  - Each hit knocks the other ladder back.
- Topping a ladder starts a 31 s **Party Time**. In **Ball Party**, BALL drops double balls, pearls pay 180/300, and yellow pays the progressive **jackpot**.
- Pearls pushed off the front roll onto the spinning disk and pay by pocket color. Anything falling off the sides is lost.

## Docs

- [REQUIREMENTS.md](REQUIREMENTS.md): rules, each tagged with evidence from the reference videos (frame or transcript timestamps) or marked as inference/tuning.
- [ARCHITECTURE.md](ARCHITECTURE.md): module boundaries, data flow, physics model, determinism.

The reference footage in `media/` and the root `*.webm` files are gitignored.
