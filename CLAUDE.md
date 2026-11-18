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

## Hosting
- The repo is deployed as-is by Cloudflare Pages on every push to `main` (no build command, output directory is the repo root). Live at https://chompers.realmarras.com/.
- `_redirects` at the root sends `/` to `/chompers.html`. It must stay exactly one line, and `chompers.html` must keep its name. Never delete, rename, or reformat either; never add an `index.html`.
- Everything committed to `main` is publicly served, so no secrets, scratch files, or large assets in the repo. Test screenshots stay in `tests/out/` (already gitignored).
- Nothing about the game itself changes for hosting: single file, no dependencies, no server.

## Conventions
- **Single file:** everything lives in `chompers.html` — inline CSS and JS, no external assets or libraries.
- **Four clearly commented sections, in this order:**
  1. `CONFIG / DATA` — modes, enemy types, the `CAMPAIGN`, escalation, number ranges, lives, grid size, scoring, timings, palette. All tunables live here and are meant to be hand-edited.
  2. `ENGINE` — game state and rules. No DOM, no canvas, no keyboard code. Driven only by `Engine.handle(action)` and `Engine.update(dtMs)`.
  3. `RENDER` — draws `Engine.state` to a canvas. Reads state, never mutates it.
  4. `INPUT` — maps physical input to abstract actions (`up`, `down`, `left`, `right`, `eat`, `pause`, `confirm`, `blur`) and calls `Engine.handle`. A future touch layer just emits the same actions; the engine does not change.
- **Rendering:** canvas at a fixed logical resolution of 320×200, scaled up by an integer factor to fit the window (`image-rendering: pixelated`). Text uses a built-in 5×7 bitmap font so it stays crisp.
- **Controls:** arrows / WASD move, Space eats (also starts / continues), Esc pauses. On the title screen Up/Down choose Campaign or a practice mode (`CONFIG.menu`). Window blur auto-pauses.
- **Modes** are entries in `MODES` (in CONFIG) with four required functions: `title` (header), `isCorrect`, `makeValue` (generator; may return `null`, the engine retries), `explain` (wrong-eat message). Optional: `name` (menus), `setup(p, rnd)` (turns stage params into concrete params once per level, e.g. picking N from `ns`) and `widen(p, f)` (ranges scaled by f for escalation). Current modes: `multiples`, `factors`, `primes`, `equals` (variants `eq` / `lt` / `gt`). Adding a mode needs a `MODES` entry plus `CAMPAIGN` stages (and a `CONFIG.menu` id for practice), with no engine changes. Wanderer rewrites call the mode's own `makeValue`.
- **Cell values** are numbers or short expression strings (`"3+9"`, `"4×3"`, `"15−3"`, `"24÷2"`, using the Unicode `−`, `×`, `÷`). Uniqueness is by displayed text. Cell text is at most `board.maxChars` (6) characters. Text of up to 3 characters uses the normal 5×7 font; anything longer uses the condensed 3×7 digit/operator font, for both the big centred label and the small label under the player or a Grump. `MathUtil` holds the shared helpers (`isPrime`, `factors`, `evalExpr`).
- **Enemies ("Grumps")** are entries in `ENEMY_TYPES` (in CONFIG) with `name`, `color`, `tickMs`, `altersNumbers`, `move(e, w, t)` plus any type-specific tunables. `move` returns a direction and only sees a small `world` object (grid size, player position, `canEnter`, rng), so new types need no engine changes. Per-stage enemy settings (`enemies: { count, types, spawnDelay, tickMult }`, `safeCell`) live in the `CAMPAIGN` stages; global caps and timings live in `CONFIG.enemies`, `CONFIG.safeCell`, `CONFIG.timing`.
- **Time** only advances in `Engine.update`, and only the `playing` screen ticks enemies, spawns and the safe cell, so pause freezes everything. Lockouts (wrong eat, death) share one `lockT` / `lockKind` mechanism.
- Boards never show duplicate numbers; a level's range must hold well over `cols*rows` values (the engine throws if it can't fill a board).
- For quick debugging, `window.Chompers` exposes `{ CONFIG, MODES, ENEMY_TYPES, Engine }` in the browser console. `Engine.debug` has test hooks (`gotoLevel`, `spawn`, `placePlayer`, `setSafe`); the game never calls them.

## Campaign, practice and escalation
- **`CAMPAIGN`** (in CONFIG) is an array of stages, one per level, played in order: `{ mode, params, enemies, safeCell }`. Modes rotate, and each mode's first stage is its gentlest. There are currently 22 stages.
- A **track** is the list of stages a game plays. `'campaign'` is all of `CAMPAIGN`. Practice (a mode id) is only that mode's `CAMPAIGN` stages, in campaign order. `Engine.stageFor(track, level)` resolves a stage purely, with no randomness.
- **Past the last stage of a track the game does not loop.** With `k = level − trackLength` (1, 2, 3, …), the mode and params come from `track[(k − 1) mod trackLength]`, so modes keep cycling. The difficulty comes from `CONFIG.escalation`, where "last" is the track's final stage:
  - range scale `f = min(rangeMax, 1 + rangeStep·k)`, passed to the mode's `widen(p, f)`. Multiples, factors and primes scale `max`, capped at `maxNumber` (999). Equals scales the top of the operand range (capped at `maxOperand`, 99) and, for less-than and greater-than, the target N.
  - Grumps `= min(enemies.maxOnScreen, last.count + floor(k / extraEnemyEvery))`
  - `tickMult = max(min(tickFloor, last.tickMult), last.tickMult · tickDecay^k)`
  - safe cell is always on and lasts `max(min(safeFloor, safeCell.duration), safeCell.duration · safeDecay^k)` ms
  - Grump types `= escalation.types`; `spawnDelay = last.spawnDelay` (or `escalation.spawnDelay`)
  - Every term is monotone in k, so difficulty never eases; the headless test checks 80 stages past the end of every track.
- Every stage, configured or escalated, must allow a unique 30-cell board with at least `board.minCorrect` correct cells. The headless test generates 200 boards per configured stage and samples escalated ones. `buildBoard` warns in the console if a stage falls short.
