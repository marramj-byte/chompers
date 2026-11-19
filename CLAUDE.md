# Chompers

> "Chompers" is a working title. A game's name lives in its **theme** (`THEMES[id].title`) and its manifest (`manifest.json` / `manifest-jr.json`: `name`, `short_name`). The boot code copies the theme title into `<title>` and the `apple-mobile-web-app-title` meta. Keep the filename `chompers.html` (hosting and tests depend on it).

## Project summary
A personal, original math-practice game in the spirit of the classic "eat the right number on a grid" genre.
The player steers a small creature around a grid of numbered cells and eats only the numbers that match the
current rule (e.g. "Multiples of 3"). Correct eats score points; wrong eats cost a life; clearing every correct
cell advances the level.

The same file runs **two games**: **Chompers** (`regular`) and **Chompers Jr** (`jr`, for younger kids). Each game is a **profile** (rules) plus a **theme** (look), chosen once at boot. See "Games: profiles and themes" below.

It is a **genre homage only**: original names, characters, art and sounds. Never use the original
game's names, sprites, music, or sound effects. Every game's page footer must read:
`not affiliated with Number Munchers™ / MECC · for personal play.`

## How to run
Open `chompers.html` in any modern browser (double-click it, or `file:///path/to/chompers.html`).
No server, no build step, no dependencies. Add `?game=jr` (or `?game=regular`) to pick a game locally.

## How to test
`node tests/headless.js` drives the game in headless Chromium via Playwright and prints ok/FAIL per check
(exit code 1 on any failure). Screenshots land in `tests/out/` (gitignored). Playwright is the only
requirement and is not vendored; it is test-only, the game itself has no dependencies.
Each test section starts from `fresh()`, which clears localStorage. Persistence checks use `reload()`, which keeps it.
The touch / mobile / PWA section starts a tiny local HTTP server (service workers need http) and drives
touch-emulated Chromium contexts at phone landscape (844×390), phone portrait (390×844) and tablet (1024×768) sizes.
- **Regular rules snapshot:** `tests/regular-rules.snapshot.json` records the regular game's rules from before profiles existed: the campaign, every rule setting, Grump tunables, track names, and every resolved stage up to 40 past the end of each track. The test fails if the regular profile drifts from it. If you change regular rules **on purpose**, regenerate the snapshot in the same commit and say so.
- **Icons:** `node tests/make-icons.js` regenerates every theme's `icons/*.png` and its inline `favicon` string from that theme's Chomper sprite. It uses only Node's built-in `zlib` and `vm`, loading the CONFIG section in `vm` to read `THEMES`. Run it after changing a theme's `sprites.chomp` or palette; the test fails if any icon or favicon is stale.

## Branches
- Day-to-day work happens on **`dev`**. Commit there and push `dev` (`git push origin dev`).
- **`main` only changes by a deliberate merge** of `dev`, done when the user asks for it. Never commit directly to `main` or push it otherwise, because every push to `main` redeploys the live site.
- The cloud environment's stop hook asks for the *checked-out* branch to be pushed, so staying on `dev` makes it push `dev`. If a session starts on `main`, switch to `dev` (`git switch dev`) before changing anything.

## Hosting
- The repo is deployed as-is by Cloudflare Pages on every push to `main` (no build command, output directory is the repo root). Live at https://chompers.realmarras.com/. A `chompersjr.*` hostname serving the same files runs Chompers Jr.
- `_redirects` at the root sends `/` to `/chompers.html`. It must stay exactly one line, and `chompers.html` must keep its name. Never delete, rename, or reformat either; never add an `index.html`.
- Everything committed to `main` is publicly served, so no secrets, scratch files, or large assets in the repo. Test screenshots stay in `tests/out/` (already gitignored).
- Nothing about the game itself changes for hosting: single file, no dependencies, no server.
- **PWA / offline:** the page registers `sw.js?v=<CONFIG.version>&cache=<theme.cacheName>&manifest=<theme.manifest>`. The service worker caches the page, that game's manifest, and the icons the manifest lists, in `<cacheName>-<version>` (`chompers-…` or `chompersjr-…`). **Bump `CONFIG.version` with every release to `main`.** The page itself is fetched network-first, so a reload picks up new code even before the bump, but the version keys the cache and clears the old ones. The manifest link and service worker are only added over http(s); opening the file from disk stays exactly as before.

## Games: profiles and themes
- **Selection** happens once, at the end of the CONFIG section. `selectGame(hostname, search)` returns `?game=<id>` if a profile and theme with that id exist. Otherwise it returns the first `CONFIG.hosts` match (`chompersjr.*` → `jr`), else `CONFIG.defaultGame` (`regular`). It sets `CONFIG.game`, `CONFIG.profile = PROFILES[game]` and `CONFIG.theme = THEMES[game]`.
- **Everything after the CONFIG section reads only `CONFIG.profile` and `CONFIG.theme`**, plus the shared settings in `CONFIG`. Never compare against a game id (`'jr'`, `CONFIG.game`) or index `PROFILES` / `THEMES` downstream; the test checks this. If two games need different behaviour, add a profile or theme *value* (e.g. `feel.deathFlash`, `theme.wrongText`) and read it.
- **The engine reads only the profile, never the theme.** RENDER, SOUND and the boot code read the theme.
- **Profile = rules** (`PROFILES[id]`): `storageKey`, `grid`, `startLives`, `menu` + `trackNames`, `scoring`, `board`, `timing`, `enemies`, `safeCell`, `feel`, `hiscores`, `escalation`, `enemyTypes` (the Grump kit) and `campaign` (the stage list). Each is documented on `PROFILES.regular`.
- **Theme = look** (`THEMES[id]`): `title`, `characterName`, `grumpName`, `footer`, `manifest`, `cacheName`, `icons`, `favicon`, `sound` (`pitch`, `tempo`), `titleLayout`, `palette` (optional `pageBg`, `cheek`), `grumpColors`, `sprites`, and optional `wrongText(msg)` / `deathText(msg)` message rewrites.
- **Shared** (`CONFIG`): `version`, `view`, `sound` volume and default mute, `attract`, `touch`, `storage.version`, `hosts`. Also shared: `MODES` (the math rules; a profile's stages pick which it uses), `MathUtil` and `MOVES` (Grump movement functions that kits point at).
- **Saves:** each game saves under its own localStorage key (`profile.storageKey`: `chompers.v1`, `chompersjr.v1`), so scores and settings never mix.

### Chompers Jr (`PROFILES.jr`, `THEMES.jr`)
- **Rules:**
  - 5×4 board, 5 lives, wrong-eat lockout 900 ms, no death flash, hit-stop on.
  - `JR_CAMPAIGN` has 11 gentle stages: ×2 to 20, ×10, ×5, equal-to with `+` (operands ≤ 10), ×2 to 40, less-than with plain numbers, equal-to with `+`/`−` (≤ 12), greater-than with plain numbers, ×3, equal-to with `+`/`−` (≤ 15), primes to 20. There's no factors mode.
  - Grumps: at most one slow Wanderer per stage (from stage 3). Stalkers appear only in escalation, with `randomStepChance` 0.6. The safe cell is on every stage and lasts 12 s.
  - Escalation uses the same formula with gentler numbers: `rangeStep` 0.05, `rangeMax` 2, a Grump added every 6 stages up to 3, `tickFloor` 0.7, `safeFloor` 6 s.
  - Names: `hiscores.presets` replaces letter entry with picking a ready-made name (YOU, ACE, BOO, …). The top-5 tables are kept.
  - Title menu: Adventure plus practice for multiples, equal/less/more and primes.
- **Look:**
  - Warm plum palette with a soft coral "wrong" colour.
  - Original rounder, big-eyed Chompy with rosy cheeks (`p` in the sprite → `palette.cheek`), friendlier Grumplets, and a dizzy (not scary) caught sprite.
  - Sounds ×1.12 pitch and ×1.25 speed.
  - `wrongText` turns "9 is not a multiple of 2" into "9 isn't a multiple of 2 — try again!", and `deathText` shows "Oops! A Grumplet bumped you!".

### How to add a game (profile + theme)
1. **Pick an id**, e.g. `kids2`.
2. **Profile:** add `PROFILES.kids2`. Start from an existing profile and change values. Give it its own `storageKey`. List its tracks in `menu` / `trackNames`, using only modes that appear in its `campaign`.
3. **Theme:** add `THEMES.kids2` with the same keys as `THEMES.regular`. Set `manifest: 'manifest-kids2.json'`, `cacheName: 'chompers' + id` (any prefix unique among the games), `icons: { 192: 'icons/<prefix>-192.png', 512: … }`, and a `favicon` line ending in `// generated by tests/make-icons.js (kids2)`. Keep the disclaimer as its `footer`.
4. **Manifest:** copy `manifest-jr.json` to `manifest-kids2.json`. Set `name`, `short_name`, `id` / `start_url` (`./chompers.html?game=kids2`), the palette colours (`theme_color` = `palette.panel`, `background_color` = `palette.bg`) and the icon paths.
5. **Icons:** run `node tests/make-icons.js`.
6. **Hostname (optional):** add `{ match: /^kids2\./i, game: 'kids2' }` to `CONFIG.hosts`.
7. **Tests:** add the new game to the boot / storage / manifest checks and run `node tests/headless.js`. Every stage must pass the board guarantees, which the test checks for each game's stages.

## Conventions
- **Single file:** the game lives entirely in `chompers.html`: inline CSS and JS, no external assets or libraries.
  - **The only exception is the PWA files:** `manifest.json` / `manifest-jr.json`, `sw.js`, and `icons/chompers-*.png` / `icons/chompersjr-*.png`. They exist because browsers require separate files for installing and offline play. Favicons are inlined as data URLs in the themes. Don't add other runtime files. (`tests/` holds dev tooling, not game files.)
- **Six clearly commented sections, in this order:**
  1. `CONFIG / DATA` — `CONFIG` (shared settings), `MathUtil`, `MODES`, `MOVES`, the campaign arrays, `PROFILES`, `THEMES`, `selectGame`. All tunables live here and are meant to be hand-edited.
  2. `ENGINE` — game state and rules. No DOM, no canvas, no keyboard code. Driven only by `Engine.handle(action)` and `Engine.update(dtMs)`. Reads `CONFIG.profile` (as `PR`), never the theme.
  3. `RENDER` — draws `Engine.state` to a canvas. Reads state, never mutates it. Colours, sprites, title layout and message rewrites come from the theme (`TH`); grid and other rules from the profile (`PR`). Also: `place()` (canvas CSS position, set by INPUT's layout), `hitTest(state, x, y)` (canvas pixel → cell / menu row / name-entry target / save, using the same geometry the screens are drawn with), `label()` (pixel-font button labels) and `hints.touch` (tap wording instead of key wording).
  4. `SOUND` — a tiny WebAudio synth (oscillators and a noise buffer, no sample files). `Sound.play(name)` for `move`, `correct`, `wrong`, `death`, `clear`, `spawn`, `safe`, `menu`. Every frequency is multiplied by `theme.sound.pitch`, and durations are divided by `theme.sound.tempo`.
  5. `STORAGE` — one versioned localStorage entry per game (`profile.storageKey`; shape version `CONFIG.storage.version`) holding `Engine.saveData()` (high scores, mute, last initials) plus the touch layer's `touchMode`. Bad or foreign-version data loads as nothing saved.
  6. `INPUT` — maps physical input to abstract actions (`up`, `down`, `left`, `right`, `eat`, `pause`, `confirm`, `blur`, `mute`, `any` for unmapped keys) and calls `Engine.handle`. Key, pointer and touch handlers also call `Sound.unlock()` (browsers need a gesture before audio; iOS only accepts touchend / pointerup). It contains:
     - **Keyboard:** `KEYMAP`.
     - **Touch layer:** tap handling, the tap-to-move walker, on-screen buttons, the rotate hint.
     - **`layout()`:** positions the canvas and the buttons.

     **The engine knows nothing about touch.** Every touch input becomes an ordinary `emit(action)`; the touch layer only *reads* `Engine.state` to decide what to send.
  - After the sections, the boot code applies the theme to the page: title, theme-color, favicon, apple-touch-icon, footer. It then loads the save, lays out the page, and runs the frame loop each frame:
    - `Input.update(dt)` advances the tap-walk and sets which buttons show.
    - `Loop.step(dt)` drains engine events into SOUND, STORAGE and hit-stop, then calls `Engine.update`.

    Over http(s), the boot code also adds the theme's manifest link and registers the service worker.
- **Rendering:** canvas at a fixed logical resolution of 320×200, scaled up by an integer factor to fit the window (`image-rendering: pixelated`). Text uses a built-in 5×7 bitmap font so it stays crisp. The grid's cell size follows the profile's `grid`.
- **Controls:** arrows / WASD move, Space eats (also starts / continues), Esc pauses, M toggles sound (saved). On the title screen Up/Down choose Campaign or a practice mode (`profile.menu`). For high-score initials, Up/Down change the letter, Left/Right move between letters and Space saves. A profile with `hiscores.presets` instead picks one of those names with any arrow. Window blur auto-pauses.
- **Touch** (`CONFIG.touch`):
  - The touch UI appears on coarse-pointer devices or after the first touch. Mouse input is unchanged: a click never moves or eats.
  - **Moving:** tap a cell and the Chomper walks there one cell per `stepMs`, along a shortest Manhattan path (longer axis first). A new tap, a key, a pad button or EAT cancels the walk, and so does a lockout. Tapping the Chomper's own cell eats. Taps up to half a cell outside the grid, even just beside the canvas, count as the nearest cell. Taps during a lockout are ignored.
  - **Buttons:** EAT (≥ 56 px, corner set by `eatSide`), pause opposite it, and an optional D-pad (four 56 px buttons, hold to repeat).
  - **Title toggles:** TOUCH: TAP / PAD and SOUND. The touch mode is saved as `touchMode` in the same storage entry, merged in by the boot code's `saveAll`.
  - **Menus by tap:** tap a menu row to select it, tap again to start. Name entry has an arrow above and below each letter (or above and below the name, for presets) plus a SAVE box. Game over and pause respond to a tap anywhere.
- **Layout** (`layout()` in INPUT): the canvas gets the largest whole-number scale that leaves room for the buttons, and buttons are never placed over the canvas.
  - **`plain`:** no touch UI; the desktop look.
  - **`side`:** landscape. EAT and the title toggles go in one side column, pause and the D-pad in the other.
  - **`bottom`:** portrait, or landscape when it gives a bigger scale (tablets). Buttons sit in a row under the canvas.
  - Safe-area insets are respected. The page never scrolls or zooms: viewport meta, `touch-action: none`, and preventDefault on touch and gesture events. In portrait, a "rotate for best play" hint shows until tapped or for `rotateHintMs`.
- **Modes** are entries in `MODES` (in CONFIG, shared by all games) with four required functions: `title` (header), `isCorrect`, `makeValue` (generator; may return `null`, the engine retries), `explain` (wrong-eat message). Optional: `name`, `setup(p, rnd)` (turns stage params into concrete params once per level, e.g. picking N from `ns`) and `widen(p, f)` (ranges scaled by f for escalation). Current modes: `multiples`, `factors`, `primes`, `equals` (variants `eq` / `lt` / `gt`; with `plain: true` its cells are plain numbers from the operand range instead of expressions). Adding a mode needs a `MODES` entry plus stages in a profile's `campaign` (and `menu` / `trackNames` entries for practice), with no engine changes. Wanderer rewrites call the mode's own `makeValue`.
- **Cell values** are numbers or short expression strings (`"3+9"`, `"4×3"`, `"15−3"`, `"24÷2"`, using the Unicode `−`, `×`, `÷`). Uniqueness is by displayed text. Cell text is at most `profile.board.maxChars` (6) characters. Text of up to 3 characters uses the normal 5×7 font; anything longer uses the condensed 3×7 digit/operator font, for both the big centred label and the small label under the player or a Grump. `MathUtil` holds the shared helpers (`isPrime`, `factors`, `evalExpr`).
- **Enemies ("Grumps")** come from the profile's Grump kit, `profile.enemyTypes`: `{ name, tickMs, altersNumbers, move, ...tunables }`, where `move` is one of the shared `MOVES` (`wander`, `stalk`). `move` returns a direction and only sees a small `world` object (grid size, player position, `canEnter`, rng), so new types need no engine changes. Colours come from `theme.grumpColors`. Per-stage enemy settings (`enemies: { count, types, spawnDelay, tickMult }`, `safeCell`) live in the campaign stages; global caps and timings live in the profile's `enemies`, `safeCell` and `timing`.
- **Time** only advances in `Engine.update`, and only the `playing` screen ticks enemies, spawns and the safe cell, so pause freezes everything. Lockouts (wrong eat, death) share one `lockT` / `lockKind` mechanism.
- **Engine events:** the engine never touches audio or storage. It queues event names (`move`, `correct`, `wrong`, `death`, `clear`, `spawn`, `safe`, `menu`, `mute`, `save`) in `state.events`, and the boot loop drains them with `Engine.drainEvents()`. A new sound means a new `emit(...)` in the engine plus an `SFX` entry with the same name.
- **Screens:** `title` → `playing` ⇄ `paused` / `levelclear` → `entername` (only for a top-5 score) → `gameover` → `title`. After `CONFIG.attract.idleMs` idle on the title comes `attract`, a demo board with Grumps and no player, kept entirely in `state.attract`. Any key returns to the title, and the demo never changes game state, scores or storage.
- **High scores:** `state.hiscores[track]` holds the top `profile.hiscores.perTrack` (5) entries `{ name, score, stage }` for each `profile.menu` track. The pure helpers are in `Engine.Hiscores` (`qualifies`, `insert`, `sanitize`). A score must be above 0 and beat, not tie, the 5th entry. Ties go below existing equal scores.
- **Feel** (`profile.feel`): death screen flash (`deathFlash*`, drawn by RENDER from the death flash timer) and hit-stop on a correct eat (`hitStop`, `hitStopFrames`, applied by the boot loop). Both can be switched off.
- Boards never show duplicate numbers; a stage's range must hold well over `cols*rows` values (the engine throws if it can't fill a board).
- For quick debugging, `window.Chompers` exposes `{ CONFIG, MODES, MathUtil, PROFILES, THEMES, selectGame, CAMPAIGN, ENEMY_TYPES, Engine, Render, Input, Sound, Storage, Loop }` in the browser console. `CAMPAIGN` and `ENEMY_TYPES` are the selected profile's `campaign` and `enemyTypes`. `Engine.debug` has test hooks (`gotoLevel`, `spawn`, `placePlayer`, `setSafe`); the game never calls them.

## Campaign, practice and escalation
- **`profile.campaign`** is an array of stages, one per level, played in order: `{ mode, params, enemies, safeCell }`. Modes rotate, and each mode's first stage is its gentlest. The regular campaign (`REGULAR_CAMPAIGN`) has 22 stages.
- A **track** is the list of stages a game plays. `'campaign'` is the whole campaign. Practice (a mode id) is only that mode's campaign stages, in campaign order. `Engine.stageFor(track, level)` resolves a stage purely, with no randomness.
- **Past the last stage of a track the game does not loop.** With `k = level − trackLength` (1, 2, 3, …), the mode and params come from `track[(k − 1) mod trackLength]`, so modes keep cycling. The difficulty comes from the profile's `escalation`, where "last" is the track's final stage:
  - range scale `f = min(rangeMax, 1 + rangeStep·k)`, passed to the mode's `widen(p, f)`. Multiples, factors and primes scale `max`, capped at `maxNumber` (999 regular, 120 jr). Equals scales the top of the operand range (capped at `maxOperand`, 99 regular, 40 jr) and, for less-than and greater-than, the target N. A cap never shrinks a stage's own range, and when a cap applies, N scales with the range that's really there.
  - Grumps `= min(enemies.maxOnScreen, last.count + floor(k / extraEnemyEvery))`
  - `tickMult = max(min(tickFloor, last.tickMult), last.tickMult · tickDecay^k)`
  - safe cell is always on and lasts `max(min(safeFloor, safeCell.duration), safeCell.duration · safeDecay^k)` ms
  - Grump types `= escalation.types`; `spawnDelay = last.spawnDelay` (or `escalation.spawnDelay`)
  - Every term is monotone in k, so difficulty never eases; the headless test checks 80 stages past the end of every track.
- Every stage, configured or escalated, must allow a unique board (`cols × rows` cells) with at least `board.minCorrect` correct cells. The headless test generates 200 boards per configured stage and samples escalated ones. `buildBoard` warns in the console if a stage falls short.
