# LaunchBox / Big Box media

Media for the Vermilion cabinet's LaunchBox "Arcade" platform, made from the game itself by
`node scripts/launchbox-media.mjs` (default: the `latest` release the cabinet runs; `--ref .` for this checkout,
`--art-only` to recompose the logo and posters from the screenshots here). `SOURCE.txt` names the captured commit.

The folders mirror LaunchBox's own, and files are named `Neon Reef-01` so LaunchBox matches them to **Neon Reef**.
To install or restore, close LaunchBox and Big Box, then copy `Images/` and `Videos/` over
`C:\Users\arcade\LaunchBox\` (this tree is the backup; the cabinet's collector does not archive media).

The six PNGs are the title/machine view, gameplay, transparent clear logo, box front, banner, and background.
The video is a silent 30-second, 720-pixel-wide H.264 gameplay snap. Requires system Google Chrome,
Playwright, and ffmpeg (`FFMPEG` can override its path); uses Metal rendering at 1050×1680.

Artwork follows Coin Quake's approved layout. Lettering uses the cabinet's `logoTexture` font stack
(italic 900 Arial Black, Impact, system-ui, sans-serif), silver fill and dark ink; the reef HUD supplies
cyan highlights. There is no bundled webfont. “Push pearls. Chase the jackpot!” reflects the README's
pearl-pusher and progressive jackpot rules. Space holds/taps fire real balls; the released build's
+CREDITS button tops up during play. That release has no title/attract screen, so the title image shows
the fresh machine with its own marquee. Frame cadence is logged and captures below 50 fps are rejected.
