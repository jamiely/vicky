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
| `src/rules/game.ts` | Credits, shots, tickets, ladders, parties, jackpot, payouts; returns `Effect[]` | import three/Rapier, read wall-clock time |
| `src/sim/physics.ts` | Rapier world: peg board, slots, tray, rails, pusher, back scraper; ball bodies; exit classification | know payouts |
| `src/sim/disk.ts` | Pearl-in-groove dynamics on the spinning pocket disk; pocket capture | know payouts |
| `src/render/*` | Scene, camera, cabinet meshes, instanced balls, LCD canvas texture, disk texture | mutate game state |
| `src/ui/*` | DOM HUD, pointer/keyboard input, aim raycast | — |
| `src/main.ts` | Bootstrap, fixed-step loop, event routing | contain rules |

## Time and determinism

- Simulation runs on a fixed 1/120 s step with an accumulator, capped at 8 steps per frame to avoid a spiral of death.
- Rules receive simulated time (`simTime`), never `performance.now()`, so party timers pause when the tab is hidden and tests stay exact.
- Every random draw (shot jitter, drop positions, pearl entry speed) uses the seeded RNG.

## Physics model (units: cm, gravity −981 cm/s²)

- **Peg board:** two acrylic panes 4.8 cm apart confine balls to a near-2D fall. Static cylinder pegs in staggered
  rows. Seven slot bins at the bottom. A ball whose center drops below the bin line is consumed and reported as `slot(i)`.
- **Tray:** static floor, low side rails (spill is possible when crowded), open front edge.
- **Pusher:** kinematic box moving sinusoidally along z. A fixed scraper wall just above the pusher top sweeps riders off on the retract stroke.
- **Exit classification:** below the tray and past the front edge is `frontExit`; past either side is `sideExit`.
  White balls on `frontExit` return a shot. Pearls on `frontExit` go to the disk. Everything on `sideExit` is lost.
- **Disk:** not a Rapier simulation. A pearl rides a circular groove in world space while the holed disk rotates
  beneath it. The pearl's speed relative to the disk decays exponentially to a small creep floor, below the
  capture speed, so every pearl settles within one relative revolution. A pass over a hole at high speed is
  an "in and out".

## Rendering

- White balls and pearls each use one `InstancedMesh`; matrices are written from Rapier poses each frame.
- Pegs are one `InstancedMesh`. Acrylic panes are transparent standard materials; `MeshPhysicalMaterial` transmission is too expensive.
- The LCD is a `CanvasTexture` redrawn only when the rules snapshot changes or at most 10 Hz during party countdowns.

## Extension points

- Payout multipliers (the source shows values beyond the table): add to `rules` via config; the disk does not change.
- Four-player cabinet: instantiate N stations, each with its own `GameRules` and physics sub-world, sharing one jackpot.
