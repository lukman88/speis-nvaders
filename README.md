# speis-nvaders

A Space Invaders clone in Phaser 3.80 (local `lib/phaser.min.js`, no build step).

## Run

```
npx http-server -p 8000
# open http://localhost:8000
```

## Controls

| Input | Action |
| --- | --- |
| ← → / A D | move |
| Space | fire (hold to auto-fire) |
| M | mute / unmute |
| Esc | pause |
| R | restart (title / game over) |
| Touch | drag to move, auto-fires while held |

## Features

- 4 difficulty levels (enemy speed + fire rate)
- Invader tiers: 3/2/1 hp top-to-bottom, 30/20/10 pts × wave; deeper rows dive more often
- Destructible shields (4 per stage, restored each stage) — both player and enemy bullets erode them and stop
- Kamikaze dives (parabolic, weighted by row) and arcing enemy shots aimed at the player
- High score persisted in `localStorage`, shown on title and game over
- Chiptune music + SFX via Web Audio synth (no audio files)
- Hit-stop on life loss, camera shake on kills, per-wave starfield with planets

## Tests

```
node --test test/ballistic.test.js   # dive/arc closed-form math
node test/smoke_test.js              # headless browser end-to-end (needs server on :8000)
```
