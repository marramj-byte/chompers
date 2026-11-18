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
Each test section starts from `fresh()`, which clears localStorage. Persistence checks use `reload()`, which keeps it.

## Branches
- Day-to-day work happens on **`dev`**. Commit there and push `dev` (`git push origin dev`).
- **`main` only changes by a deliberate merge** of `dev`, done when the user asks for it. Never commit directly to `main` or push it otherwise, because every push to `main` redeploys the live site.
- The cloud environment's stop hook asks for the *checked-out* branch to be pushed, so staying on `dev` makes it push `dev`. If a session starts on `main`, switch to `dev` (`git switch dev`) before changing anything.

## Hosting
- The repo is deployed as-is by Cloudflare Pages on every push to `main` (no build command, output directory is the repo root). Live at https://chompers.realmarras.com/.
- `_redirects` at the root sends `/` to `/chompers.html`. It must stay exactly one line, and `chompers.html` must keep its name. Never delete, rename, or reformat either; never add an `index.html`.
- Everything committed to `main` is publicly served, so no secrets, scratch files, or large assets in the repo. Test screenshots stay in `tests/out/` (already gitignored).
- Nothing about the game itself changes for hosting: single file, no dependencies, no server.

## Conventions
- **Single file:** everything lives in `chompers.html` — inline CSS and JS, no external assets or libraries.
- **Six clearly commented sections, in this order:**
  1. `CONFIG / DATA` — modes, enemy types, the `CAMPAIGN`, escalation, number ranges, lives, grid size, scoring, timings, palette. All tunables live here and are meant to be hand-edited.
  2. `ENGINE` — game state and rules. No DOM, no canvas, no keyboard code. Driven only by `Engine.handle(action)` and `Engine.update(dtMs)`.
  3. `RENDER` — draws `Engine.state` to a canvas. Reads state, never mutates it.
  4. `SOUND` — a tiny WebAudio synth (oscillators and a noise buffer, no sample files). `Sound.play(name)` for `move`, `correct`, `wrong`, `death`, `clear`, `spawn`, `safe`, `menu`.
  5. `STORAGE` — one versioned localStorage entry (`CONFIG.storage.key`, currently `chompers.v1`) holding `Engine.saveData()`: high scores, mute, last initials. Bad or foreign-version data loads as nothing saved.
  6. `INPUT` — maps physical input to abstract actions (`up`, `down`, `left`, `right`, `eat`, `pause`, `confirm`, `blur`, `mute`, `any` for unmapped keys) and calls `Engine.handle`. Key and pointer handlers also call `Sound.unlock()` (browsers need a gesture before audio). A future touch layer just emits the same actions; the engine does not change.
  - After the sections, the boot code loads the save, then runs the frame loop: `Loop.step(dt)` drains engine events into SOUND, STORAGE and hit-stop, then calls `Engine.update`.
- **Rendering:** canvas at a fixed logical resolution of 320×200, scaled up by an integer factor to fit the window (`image-rendering: pixelated`). Text uses a built-in 5×7 bitmap font so it stays crisp.
- **Controls:** arrows / WASD move, Space eats (also starts / continues), Esc pauses, M toggles sound (saved). On the title screen Up/Down choose Campaign or a practice mode (`CONFIG.menu`). For high-score initials, Up/Down change the letter, Left/Right move between letters and Space saves. Window blur auto-pauses.
- **Modes** are entries in `MODES` (in CONFIG) with four required functions: `title` (header), `isCorrect`, `makeValue` (generator; may return `null`, the engine retries), `explain` (wrong-eat message). Optional: `name` (menus), `setup(p, rnd)` (turns stage params into concrete params once per level, e.g. picking N from `ns`) and `widen(p, f)` (ranges scaled by f for escalation). Current modes: `multiples`, `factors`, `primes`, `equals` (variants `eq` / `lt` / `gt`). Adding a mode needs a `MODES` entry plus `CAMPAIGN` stages (and a `CONFIG.menu` id for practice), with no engine changes. Wanderer rewrites call the mode's own `makeValue`.
- **Cell values** are numbers or short expression strings (`"3+9"`, `"4×3"`, `"15−3"`, `"24÷2"`, using the Unicode `−`, `×`, `÷`). Uniqueness is by displayed text. Cell text is at most `board.maxChars` (6) characters. Text of up to 3 characters uses the normal 5×7 font; anything longer uses the condensed 3×7 digit/operator font, for both the big centred label and the small label under the player or a Grump. `MathUtil` holds the shared helpers (`isPrime`, `factors`, `evalExpr`).
- **Enemies ("Grumps")** are entries in `ENEMY_TYPES` (in CONFIG) with `name`, `color`, `tickMs`, `altersNumbers`, `move(e, w, t)` plus any type-specific tunables. `move` returns a direction and only sees a small `world` object (grid size, player position, `canEnter`, rng), so new types need no engine changes. Per-stage enemy settings (`enemies: { count, types, spawnDelay, tickMult }`, `safeCell`) live in the `CAMPAIGN` stages; global caps and timings live in `CONFIG.enemies`, `CONFIG.safeCell`, `CONFIG.timing`.
- **Time** only advances in `Engine.update`, and only the `playing` screen ticks enemies, spawns and the safe cell, so pause freezes everything. Lockouts (wrong eat, death) share one `lockT` / `lockKind` mechanism.
- **Engine events:** the engine never touches audio or storage. It queues event names (`move`, `correct`, `wrong`, `death`, `clear`, `spawn`, `safe`, `menu`, `mute`, `save`) in `state.events`, and the boot loop drains them with `Engine.drainEvents()`. A new sound means a new `emit(...)` in the engine plus an `SFX` entry with the same name.
- **Screens:** `title` → `playing` ⇄ `paused` / `levelclear` → `entername` (only for a top-5 score) → `gameover` → `title`. After `CONFIG.attract.idleMs` idle on the title comes `attract`, a demo board with Grumps and no player, kept entirely in `state.attract`. Any key returns to the title, and the demo never changes game state, scores or storage.
- **High scores:** `state.hiscores[track]` holds the top `CONFIG.hiscores.perTrack` (5) entries `{ name, score, stage }` for each `CONFIG.menu` track. The pure helpers are in `Engine.Hiscores` (`qualifies`, `insert`, `sanitize`). A score must be above 0 and beat, not tie, the 5th entry. Ties go below existing equal scores.
- **Feel** (`CONFIG.feel`): death screen flash (`deathFlash*`, drawn by RENDER from the death flash timer) and hit-stop on a correct eat (`hitStop`, `hitStopFrames`, applied by the boot loop). Both can be switched off.
- Boards never show duplicate numbers; a level's range must hold well over `cols*rows` values (the engine throws if it can't fill a board).
- For quick debugging, `window.Chompers` exposes `{ CONFIG, MODES, MathUtil, ENEMY_TYPES, CAMPAIGN, Engine, Render, Input, Sound, Storage, Loop }` in the browser console. `Engine.debug` has test hooks (`gotoLevel`, `spawn`, `placePlayer`, `setSafe`); the game never calls them.

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
