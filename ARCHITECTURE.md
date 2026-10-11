# Architecture

Stack: TypeScript, Vite, three.js (rendering), Rapier (`@dimforge/rapier3d-compat`, rigid-body physics with WASM
embedded as base64), and Vitest (rules tests). `vite-plugin-singlefile` inlines everything into one HTML file,
so the production build runs from `file://`.

## Layers

```mermaid
flowchart LR
  Input[ui/input] -->|aim, launch, credit| Main[main loop]
  Main -->|tryLaunch / onSlot / onPocket / tick| Rules[rules/game — pure]
  Rules -->|Effect[]: dropBalls, dropPearl| Main
  Main -->|spawnShot / spawnBalls / spawnPearl| Physics[sim/physics — Rapier]
  Physics -->|SimEvent[]: slot, frontExit, sideExit| Main
  Main -->|launchPearl| Disk[sim/disk — pure]
  Disk -->|PocketEvent| Main
  Rules -->|snapshot| Render[render/* — three.js]
  Physics -->|body poses| Render
  Disk -->|pearl angles, disk angle| Render
  Rules -->|snapshot, notices| HUD[ui/hud — DOM]
```

| Module | Owns | Must not |
|--------|------|----------|
| `src/config.ts` | Every tunable: geometry (cm), payouts, ladder values, durations | — |
| `src/rng.ts` | Seeded PRNG (mulberry32) | — |
| `src/rules/game.ts` | Credits, shots, tickets, ladders, parties, jackpot, payouts; returns `Effect[]`; chance rolls via an injected `next()` | import three/Rapier, read wall-clock time |
| `src/sim/physics.ts` | Rapier world: peg board, slots, tray, rails, pusher, back scraper; ball bodies; exit classification | know payouts |
| `src/sim/disk.ts` | Pearl-in-groove dynamics on the spinning pocket disk; pocket capture | know payouts |
| `src/render/*` | Scene, camera, cabinet meshes, instanced balls, LCD canvas texture, disk texture | mutate game state |
| `src/ui/hud.ts` | DOM counters, party countdown, event feed | — |
| `src/main.ts` | Bootstrap, fixed-step loop, event routing | contain rules |

## Time and determinism

- Simulation runs on a fixed 1/120 s step with an accumulator, capped at 8 steps per frame to avoid a spiral of death.
- Rules receive simulated time (`simTime`), never `performance.now()`, so party timers pause when the tab is hidden and tests stay exact.
- Every random draw (shot entry and spread, drop positions, LUCKY rolls, pearl entry speed) uses the seeded RNG (`?seed=N`).
- Measured cost: ~0.4 ms per physics step with ~150 bodies (≈5% of a core at 120 Hz).

## Physics model (units: cm, gravity −981 cm/s²)

- **Peg board:** two acrylic panes 4.8 cm apart confine balls to a near-2D fall. Static cylinder pegs in centered,
  staggered rows plus wall bumpers on every row, so no free lane runs down the sides. Seven slot bins sit at the bottom.
  A ball whose center drops below the bin line is consumed and reported as `slot(i)`.
  - **No CCD.** Peak speed (~3 cm/step at 120 Hz) can't skip the 5.2 cm a ball needs to clear a peg. Hard CCD froze
    touching bodies (repeated zero time-of-impact); soft CCD's predictive contacts held balls in mid-air.
  - Contact prediction is cut to 0.2 cm (`normalizedPredictionDistance = 0.002`). Rapier's default scales to 2 cm at
    `lengthUnit = 100`, enough for two pegs' prediction bands to cradle a ball between them.
  - Board balls collide with statics only (collision groups). Two balls side by side otherwise arch between pegs and jam the board.
  - Stall recovery, like cabinet vibration: a ball at rest for 0.6 s is kicked; after three kicks it drops straight into
    the bin below where it stalled. `src/sim/physics.test.ts` requires every shot to reach a slot across seeded bursts.
- **Tray:** static floor. Low side rails stop 7 cm short of the front edge; balls at the open corners fall off the sides. The front edge is open.
- **Pusher:** kinematic box moving sinusoidally along z. A fixed scraper wall just above the pusher top sweeps riders off on the retract stroke.
  The initial pile settles with the pusher parked, so nothing spills before play.
- **Exit classification:** below the tray and past the front edge is `frontExit`; past either side is `sideExit`.
  White balls on `frontExit` recycle with no payout. Pearls on `frontExit` go to the disk. Everything on `sideExit` is lost.
- **Disk:** not a Rapier simulation. A pearl rides a circular groove in world space while the holed disk rotates
  beneath it. The pearl's speed relative to the disk decays exponentially to a small creep floor, below the
  capture speed, so every pearl settles within one relative revolution. A pass over a hole at high speed is
  an "in and out".

## Rendering

- White balls and pearls each use one `InstancedMesh`; matrices are written from Rapier poses each frame.
- Pegs are one `InstancedMesh`. Acrylic panes are transparent standard materials; `MeshPhysicalMaterial` transmission is too expensive.
- The LCD is a `CanvasTexture` redrawn only when `rules.version` changes, plus once per second while a party countdown runs.

## Extension points

- Payout multipliers (the source shows values beyond the table): add to `rules` via config; the disk does not change.
- Four-player cabinet: instantiate N stations, each with its own `GameRules` and physics sub-world, sharing one jackpot.
