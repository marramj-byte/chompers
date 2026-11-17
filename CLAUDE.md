# Chompers

> "Chompers" is a working title. To rename: change `CONFIG.title` and the `<title>` tag in `chompers.html` (and the filename if you like). Nothing else depends on the name.

## Project summary
A personal, original math-practice game in the spirit of the classic "eat the right number on a grid" genre.
The player steers a small creature around a grid of numbered cells and eats only the numbers that match the
current rule (e.g. "Multiples of 3"). Correct eats score points; wrong eats cost a life; clearing every correct
cell advances the level.

It is a **genre homage only**: original name, characters, art, and (later) sounds. Never use the original
game's names, sprites, music, or sound effects. The page footer must read:
`not affiliated with Number Munchers™ / MECC · for personal play.`

## How to run
Open `chompers.html` in any modern browser (double-click it, or `file:///path/to/chompers.html`).
No server, no build step, no dependencies.

## How to test
`node tests/headless.js` drives the game in headless Chromium via Playwright and prints ok/FAIL per check
(exit code 1 on any failure). Screenshots land in `tests/out/` (gitignored). Playwright is the only
requirement and is not vendored; it is test-only, the game itself has no dependencies.

## Conventions
- **Single file:** everything lives in `chompers.html` — inline CSS and JS, no external assets or libraries.
- **Four clearly commented sections, in this order:**
  1. `CONFIG / DATA` — modes, levels, number ranges, lives, grid size, scoring, timings, palette. All tunables live here and are meant to be hand-edited.
  2. `ENGINE` — game state and rules. No DOM, no canvas, no keyboard code. Driven only by `Engine.handle(action)` and `Engine.update(dtMs)`.
  3. `RENDER` — draws `Engine.state` to a canvas. Reads state, never mutates it.
  4. `INPUT` — maps physical input to abstract actions (`up`, `down`, `left`, `right`, `eat`, `pause`, `confirm`, `blur`) and calls `Engine.handle`. A future touch layer just emits the same actions; the engine does not change.
- **Rendering:** canvas at a fixed logical resolution of 320×200, scaled up by an integer factor to fit the window (`image-rendering: pixelated`). Text uses a built-in 5×7 bitmap font so it stays crisp.
- **Controls:** arrows / WASD move, Space eats (also starts / continues), Esc pauses. Window blur auto-pauses.
- **Modes** are entries in `MODES` (in CONFIG) with `title`, `isCorrect`, `makeValue`, `explain`. Per-level parameters live in `CONFIG.levels[modeId]`. Adding a mode should not require engine changes.
- For quick debugging, `window.Chompers` exposes `{ CONFIG, MODES, Engine }` in the browser console.
