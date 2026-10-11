# Requirements — 3D ball-pusher modeled on Victoria Coin Island

A virtual, single-station recreation of the *gameplay* of Victoria Coin Island (itself described by players as a
"Pearl Fishery knockoff"). Rendered in 3D with three.js; ball motion is physically simulated.
The game itself is original work: it does not use the cabinet's logos, character art, screen graphics, audio,
or captured video frames.

Evidence tags:
- **[F mm:ss]** frame observed in `media/NEW PUSHER called VICTORIA!! … [3-koMfby63A].mkv`
- **[T mm:ss]** transcript line from that video's captions
- **[INF]** inference; the rule is a design decision, tunable in `src/config.ts`

## 1. Cabinet layout (one player station)

| # | Element | Evidence |
|---|---------|----------|
| 1 | Vertical peg ("nail") board on clear acrylic in front of an LCD | [F 00:14], [F 04:41] |
| 2 | Seven slots under the peg board: `BALL · TICKET · BALL · BIG BALL LUCKY · TICKET · BALL · TICKET` | [F 01:26] crop |
| 3 | Pusher tray full of white ping-pong-size balls plus large orange "big pearls" | [F 00:14], [F 10:13] |
| 4 | Pusher shelf moving forward/back behind the tray | [T 05:34] "we got a big pusher" |
| 5 | Side drop-offs: balls falling off the tray sides are lost | [T 03:22] "going down the sides is a loss" |
| 6 | "BIG PEARL" chute routing pushed-off pearls to a spinning, colored pocket disk at the front | [F 01:26], [F 10:13] |
| 7 | LCD: four-segment value wheel (green, red, yellow `SUPER`, red), ticket-bead ladder, jackpot counter | [F 10:13] crop |
| 8 | Progressive jackpot display around 1,200 that rises during play (1,202 → 1,204 → 1,223) | [F 00:14], [F 04:41], [F 10:13] |

Out of scope: the four-player cabinet ([T 03:02] "four-sided"), the mushroom/rotating-nail variant in the short
video, real ticket dispensing, and real money.

## 2. Game loop

1. **Credits → shots.** One credit loads a fixed batch of shots. Each credit adds +1 to the progressive jackpot. [INF], jackpot rise [F]
2. **Launch.** Pressing launch fires one ball into the top of the peg board at a random entry; holding auto-fires at 2 shots/s. There is no aiming: on the source cabinet players cannot steer shots ([T 09:05] "you don't really have much choice"). Measured: an aim control made the left edge (`BALL · TICKET · BALL`) a dominant strategy (66% BALL vs 31% at center).
3. **Peg board.** The ball falls through physically simulated pegs and lands in one of the 7 slots.
4. **Slot outcomes:**
   - `BALL`: drops N white balls onto the tray ([T 02:51] "every time you hit the ball slot it jumps an amount of balls") and advances the **ball ladder**.
   - `TICKET`: awards the current ticket-ladder value (8 → 10 → 12 → 15 → 20 → 25 → 30 → 40; contains the run 15·20·25·?·40 seen at [F 10:13]) and advances the **ticket ladder**.
   - `BIG BALL LUCKY`: releases one big pearl from the tower reserve onto the tray, if the tower holds any ([T 04:06] "big ball, we always like the big balls"). [INF: exact center-slot effect]
   - Advancing one ladder knocks the other back two steps ([T 03:45] "we lost some progress cuz we went into a ticket", [T 04:03] "we got a ticket, that means we go backwards", [T 04:15] "continuously two away"). [INF: exact amount]
5. **Party Time.** Topping a ladder (8 beads) starts that ladder's party for 31 s ([T 01:47] "31 seconds double balls and party time", [T 08:02] "33 seconds"). The ladder then resets. Ladder length and knockback are tuned so Ball Party Time arrives ~15×/hour (~13% of play); the source video shows ~4 in 14 minutes. With 5 beads, a party would be running more than half the time.
   - **Ball Party Time:** `BALL` slot drops double balls; disk pockets pay party values; yellow pays the progressive jackpot ("SUPER"). The jackpot can be won more than once per party ([T 02:03] "double super bonus in one party time").
   - **Ticket Party Time:** `TICKET` slot pays the top ladder value on every hit. [INF: effect; players call it the weaker party, [T 06:49]]
6. **Pusher tray.** The pusher oscillates continuously. White balls pushed over the **front** edge recycle into the machine with no payout. [INF; refunding shots made credits unnecessary] Pearls over a **side** edge (the rail-free front corners) pay nothing. [T 03:22]
7. **Pearls and the disk.** A pearl pushed over the front edge is routed to the spinning disk, settles into a colored pocket, and pays by color:

   | Pocket | Normal | Ball Party Time | Evidence |
   |--------|--------|-----------------|----------|
   | green  | 40     | 180             | [T 01:38] "180 for each of those"; normal "60 or 120" [T 02:30] |
   | red    | 60     | 300             | [T 01:21] "300 for a red" |
   | yellow | 120    | progressive jackpot, reset to base | [T 01:25] "yellow's worth 1200", [T 01:32] "super jackpot", [T 06:03] "still 120" off-party |

   Observed values also include 80, 150, 160, 220, 380, 400, and 420 ([T 11:01]–[T 12:30]). The source likely uses a multiplier this spec does not model; keep payouts in config so a multiplier can be added later.
8. **Pearl circulation.** Pearls are a fixed set that circulates: tray → (front edge) disk pocket → tower lift → tower reserve → LUCKY → tray. Side losses skip the disk. The clear tower beside the tray visibly holds the waiting pearls, and the LCD hub shows "LUCKY BALL" with the count ([F 04:41], [F 10:13], demo 0:20). The machine starts with ~4 pearls on the tray ([T 03:12] "this one's got four pearls already on it") and 4 in the tower. Tray contents carry across credits.

## 3. Presentation

- Real-time 3D scene modeled on reference frames:
  - Board area: circuit-art back panel, screw pegs over the LCD, gold slot windows, neon chevrons.
  - Tray area: mirror tray with side signs.
  - Pearl column: clear LED tower holding the reserve, and the pocket disk in an LED bowl.
  - Top and front: red seven-segment jackpot counter, topper sign, control deck.
  - Effects: bloom and reflections.
- The LCD mirrors rule state: both ladders, the active party with countdown, current pocket values, the jackpot, the tower count, and celebration flashes.
- Sound is synthesized: peg clicks, launch, tray clatter, pearl thumps, slot jingles, payouts, jackpot fanfare, idle and party music beds, cabinet ambience. A mute toggle is remembered.
- The HUD shows credits, shots, tickets won, and the jackpot. Buttons: insert credit, launch (hold to auto-fire), reset, sound.
- Debug menu (`?debug=1`): live camera, render, simulation, and rule tunables; cheats; light editor; presets.
- Input: press anywhere on the cabinet, the LAUNCH button, or Space; holding auto-fires.
- Targets: 60 fps on a recent laptop with ~300 simulated balls; layout usable at 390 px wide.

## 4. Delivery

- `npm run dev` serves the game.
- `npm run build` emits a single self-contained `dist/index.html` that works from `file://` (`open dist/index.html`).

## 5. Acceptance

1. The page loads with no console errors over HTTP and from `file://`.
2. The tray starts with white balls and 4 pearls; the pusher visibly moves them.
3. Launching consumes a shot; the ball falls through the pegs and lands in a slot; the slot effect is visible in the HUD/LCD.
4. Hitting `BALL` adds balls to the tray; hitting `TICKET` adds ladder tickets; ladders push each other back.
5. Topping a ladder starts a 31 s party with a visible countdown that ends on time.
6. A pearl pushed off the front lands in a disk pocket and pays the table value for the current mode; yellow during Ball Party pays and resets the jackpot.
7. The rules core has unit tests covering 4–6 that do not depend on physics or rendering.
8. Every pearl is always visible (tray, chute, disk, lift, or tower), and LUCKY releases a pearl while the tower holds one.
9. Every game event has a distinct synthesized sound; nothing plays before the first user gesture or while muted.
10. `npm run coverage` passes with ≥ 90% statements, branches, functions, and lines.
