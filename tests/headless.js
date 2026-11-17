// Headless test for chompers.html.
// Run: node tests/headless.js   (needs Playwright + Chromium available to require('playwright'))
// Screenshots are written to tests/out/ (gitignored). Exit code 1 if any check fails.
//
// Slice-2 checks drive time deterministically with T.sim(ms), which calls
// Engine.update in 16 ms steps inside the page, and use Engine.debug hooks to
// set up positions. The real requestAnimationFrame loop keeps running too;
// each scenario does its setup + simulation inside one evaluate() so the two
// don't interleave.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const URL = 'file://' + path.join(ROOT, 'chompers.html');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}

// Helpers injected into the page before the game script runs.
function pageHelpers() {
  window.T = {
    // advance the engine ms milliseconds; optional per-step callback may return a failure string
    sim(ms, each) {
      const E = Chompers.Engine;
      for (let t = 0; t < ms; t += 16) {
        E.update(16);
        if (each) { const err = each(); if (err) return err; }
      }
      return null;
    },
    visibleDupes() {
      const seen = new Set(), d = [];
      for (const c of Chompers.Engine.state.cells) if (!c.eaten) { if (seen.has(c.value)) d.push(c.value); seen.add(c.value); }
      return d;
    },
    recount() {
      const E = Chompers.Engine, s = E.state, m = E.mode();
      return s.cells.filter(c => !c.eaten && m.isCorrect(c.value, s.params)).length;
    },
    isEdge(e) {
      const { cols, rows } = Chompers.CONFIG.grid;
      return e.col === 0 || e.row === 0 || e.col === cols - 1 || e.row === rows - 1;
    },
  };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 980, height: 660 } });
  await page.addInitScript(pageHelpers);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });
  const fresh = async () => { await page.goto(URL); await page.waitForTimeout(150); };
  const S = () => page.evaluate(() => {
    const s = Chompers.Engine.state;
    return { screen: s.screen, lives: s.lives, level: s.level, score: s.score };
  });
  // Put the player on a cell whose correctness == want; returns index or null.
  const goTo = want => page.evaluate(want => {
    const { Engine, CONFIG } = window.Chompers, s = Engine.state, m = Engine.mode();
    const i = s.cells.findIndex(c => !c.eaten && m.isCorrect(c.value, s.params) === want);
    if (i < 0) return null;
    s.player.col = i % CONFIG.grid.cols; s.player.row = Math.floor(i / CONFIG.grid.cols);
    return i;
  }, want);

  // ===================== slice 1: core loop =====================
  console.log('-- slice 1: core loop');
  await fresh();
  await page.waitForTimeout(150);
  await shot('01-title');
  check((await S()).screen === 'title', 'starts on title screen');

  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  await shot('02-board');
  check((await S()).screen === 'playing', 'Space starts the game');

  await goTo(false); await page.keyboard.press('Space'); await page.waitForTimeout(200);
  await shot('03-wrong');
  await page.waitForTimeout(1500);
  let st = await S();
  check(st.lives === 2 && st.screen === 'playing', 'wrong eat costs a life');

  await goTo(true); await page.keyboard.press('Space'); await page.waitForTimeout(100);
  check((await S()).score > 0, 'correct eat scores');
  while (await goTo(true) !== null) { await page.keyboard.press('Space'); await page.waitForTimeout(20); }
  await page.waitForTimeout(200);
  await shot('04-clear');
  check((await S()).screen === 'levelclear', 'clearing all correct cells shows level clear');
  await page.waitForTimeout(2000);
  st = await S();
  check(st.screen === 'playing' && st.level === 2, 'advances to level 2');

  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  await shot('05-pause');
  check((await S()).screen === 'paused', 'Esc pauses');
  await page.keyboard.press('Escape');
  check((await S()).screen === 'playing', 'Esc resumes');

  for (let k = 0; k < 3; k++) { await goTo(false); await page.keyboard.press('Space'); await page.waitForTimeout(1600); }
  check((await S()).screen === 'gameover', 'losing all lives ends the game');
  await page.waitForTimeout(800);
  await shot('06-gameover');
  await page.keyboard.press('Space'); await page.waitForTimeout(100);
  check((await S()).screen === 'title', 'Space returns to title');

  // ===================== housekeeping: unique numbers =====================
  console.log('-- unique numbers');
  await fresh();
  const uniq = await page.evaluate(() => {
    const { Engine, CONFIG } = Chompers, n = CONFIG.levels[CONFIG.mode].length;
    let boards = 0, dupes = 0, tooFew = 0;
    for (let lvl = 1; lvl <= n; lvl++) for (let k = 0; k < 30; k++) {
      Engine.debug.gotoLevel(lvl); boards++;
      if (T.visibleDupes().length) dupes++;
      if (Engine.state.remaining < CONFIG.board.minCorrect) tooFew++;
    }
    return { boards, dupes, tooFew };
  });
  check(uniq.dupes === 0, `no duplicate numbers on ${uniq.boards} generated boards (all levels)`);
  check(uniq.tooFew === 0, 'every generated board still has at least board.minCorrect correct cells');

  // ===================== enemies: spawning =====================
  console.log('-- enemies: spawning');
  await fresh();
  const none = await page.evaluate(() => {
    const E = Chompers.Engine, out = [];
    for (const lvl of [1, 2]) { E.debug.gotoLevel(lvl); T.sim(15000); out.push(E.state.enemies.length + (E.state.safe ? 100 : 0)); }
    return out;
  });
  check(none[0] === 0 && none[1] === 0, 'levels 1-2: no Grumps and no safe cell after 15 s');

  const spawn = await page.evaluate(() => {
    const { Engine: E, CONFIG } = Chompers, s = E.state;
    E.debug.gotoLevel(3);
    const delay = s.enemyCfg.spawnDelay;
    T.sim(delay - 100);
    const before = s.enemies.length;
    T.sim(200);
    const e = s.enemies[0];
    const atSpawn = e && { type: e.type, edge: T.isEdge(e),
      dist: Math.abs(e.col - s.player.col) + Math.abs(e.row - s.player.row) };
    s.player.col = 0; s.player.row = 0; E.debug.setSafe(0, 0, 1e9); // keep the player out of reach
    T.sim(delay * 3);
    return { before, atSpawn, minDist: CONFIG.enemies.spawnMinDistance, later: s.enemies.length, count: s.enemyCfg.count };
  });
  check(spawn.before === 0, 'level 3: nothing spawns before the spawn delay');
  check(spawn.atSpawn && spawn.atSpawn.type === 'wanderer' && spawn.atSpawn.edge,
        `level 3: one Wanderer enters on an edge cell after the delay (${JSON.stringify(spawn.atSpawn)})`);
  check(spawn.atSpawn && spawn.atSpawn.dist >= spawn.minDist, 'spawn cell respects spawnMinDistance from the player');
  check(spawn.later === spawn.count, `enemy count stays at the level's count (${spawn.later}/${spawn.count})`);

  // ===================== collision + death =====================
  console.log('-- collision and death');
  await fresh();
  const death = await page.evaluate(() => {
    const { Engine: E, CONFIG, ENEMY_TYPES } = Chompers, s = E.state;
    ENEMY_TYPES.stalker.randomStepChance = 0;
    E.debug.gotoLevel(5);
    s.spawnT = 1e9; E.debug.setSafe(null, null, 1e9);   // isolate: no random spawns or safe cells
    const centre = { col: s.player.col, row: s.player.row };
    const lives0 = s.lives;
    E.debug.spawn('stalker', centre.col + 2, centre.row, [-1, 0]);
    const tick = ENEMY_TYPES.stalker.tickMs * s.enemyCfg.tickMult;
    T.sim(tick * 2 + 50);                                 // two steps: adjacent, then onto the player
    const hit = { lives: s.lives, lock: s.lockKind, flash: s.flash && s.flash.kind, enemies: s.enemies.length };
    E.handle('left');
    const movedWhileLocked = s.player.col !== centre.col;
    return { lives0, hit, movedWhileLocked, centre, tick };
  });
  check(death.hit.lives === death.lives0 - 1 && death.hit.lock === 'death' && death.hit.flash === 'dead',
        'Stalker reaching the player costs a life and starts the death lock');
  check(!death.movedWhileLocked, 'input is locked during the death animation');
  await page.waitForTimeout(60);
  await shot('07-death');
  const after = await page.evaluate(() => {
    const { Engine: E, CONFIG } = Chompers, s = E.state;
    T.sim(CONFIG.timing.deathLock + 50, () => s.lockKind === null && 'unlocked'); // stop the step the lock ends
    return { enemies: s.enemies.length, col: s.player.col, row: s.player.row, lock: s.lockKind,
             screen: s.screen, spawnT: s.spawnT, delay: s.enemyCfg.spawnDelay };
  });
  check(after.enemies === 0 && after.lock === null && after.screen === 'playing', 'after the death lock: all Grumps cleared, play resumes');
  check(after.col === death.centre.col && after.row === death.centre.row, 'player respawns at the board centre');
  check(after.spawnT > after.delay - 20, `spawn timer resets to the level spawn delay on respawn (${Math.round(after.spawnT)}/${after.delay})`);

  const walkInto = await page.evaluate(() => {
    const { Engine: E } = Chompers, s = E.state;
    const e = E.debug.spawn('wanderer', s.player.col + 1, s.player.row);
    e.tickT = 1e9;                     // stand still
    const l = s.lives;
    E.handle('right');
    return { before: l, after: s.lives, lock: s.lockKind };
  });
  check(walkInto.after === walkInto.before - 1 && walkInto.lock === 'death', 'walking into a Grump also costs a life');

  const lastLife = await page.evaluate(() => {
    const { Engine: E, CONFIG } = Chompers, s = E.state;
    E.debug.gotoLevel(5); s.spawnT = 1e9; E.debug.setSafe(null, null, 1e9);
    s.lives = 1;
    const e = E.debug.spawn('wanderer', s.player.col + 1, s.player.row); e.tickT = 1e9;
    E.handle('right');
    T.sim(CONFIG.timing.deathLock + 50);
    return s.screen;
  });
  check(lastLife === 'gameover', 'losing the last life to a Grump ends the game');

  // ===================== safe cell =====================
  console.log('-- safe cell');
  await fresh();
  const safe = await page.evaluate(() => {
    const { Engine: E, ENEMY_TYPES } = Chompers, s = E.state;
    ENEMY_TYPES.stalker.randomStepChance = 0;
    ENEMY_TYPES.wanderer.straightBias = 1;
    E.debug.gotoLevel(5); s.spawnT = 1e9;
    const c = s.player.col, r = s.player.row;
    E.debug.setSafe(c, r, 1e9);
    E.debug.spawn('stalker', c + 1, r, [-1, 0]);   // wants to step onto the player
    E.debug.spawn('wanderer', c - 1, r, [1, 0]);   // heading straight at the safe cell
    const lives = s.lives;
    let adjacentTicks = 0;
    const err = T.sim(30000, () => {
      if (s.enemies.some(e => e.col === c && e.row === r)) return 'a Grump entered the safe cell';
      if (s.lives !== lives) return 'player was hit on the safe cell';
      const st = s.enemies[0];
      if (Math.abs(st.col - c) + Math.abs(st.row - r) === 1) adjacentTicks++;
    });
    return { err, adjacentTicks };
  });
  check(safe.err === null, 'Grumps never enter the safe cell; player on it is never hit' + (safe.err ? ` (${safe.err})` : ''));
  check(safe.adjacentTicks > 0, 'Stalker does close in next to the safe cell (so the block was actually exercised)');

  const cycle = await page.evaluate(() => {
    const { Engine: E, CONFIG } = Chompers, s = E.state, sc = CONFIG.safeCell;
    E.debug.gotoLevel(3); s.spawnT = 1e9;
    T.sim(sc.firstDelay - 100); const early = !!s.safe;
    T.sim(200); const appeared = !!s.safe;
    T.sim(sc.duration); const gone = !s.safe;
    T.sim(sc.cooldown + 100); const back = !!s.safe;
    E.debug.gotoLevel(1); T.sim(sc.firstDelay + 500); const offLevel = !!s.safe;
    return { early, appeared, gone, back, offLevel };
  });
  check(!cycle.early && cycle.appeared, 'safe cell appears after safeCell.firstDelay');
  check(cycle.gone && cycle.back, 'safe cell expires after its duration and returns after the cooldown');
  check(!cycle.offLevel, 'safe cell stays off on a level with safeCell:false');

  // ===================== pause freezes the world =====================
  console.log('-- pause');
  await fresh();
  await page.evaluate(() => {
    const { Engine: E } = Chompers, s = E.state;
    E.debug.gotoLevel(5);
    E.debug.setSafe(0, 0, 5000);
    E.debug.spawn('wanderer', 5, 4);   // one of two -> spawn timer is running
    s.spawnT = 1500;
    s.player.col = 0; s.player.row = 0;
  });
  await page.keyboard.press('Escape');
  const snap = () => page.evaluate(() => {
    const s = Chompers.Engine.state;
    return JSON.stringify({ e: s.enemies, spawnT: s.spawnT, safe: s.safe, safeT: s.safeT, screen: s.screen });
  });
  const p1 = await snap();
  await page.waitForTimeout(1500);
  await page.evaluate(() => T.sim(5000));
  const p2 = await snap();
  check(JSON.parse(p1).screen === 'paused', 'Esc pauses mid-level');
  check(p1 === p2, 'pause freezes Grump ticks/animation, spawn timer and safe-cell timer (1.5 s real + 5 s simulated)');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await snap()) !== p2, 'everything moves again after resuming');

  // ===================== number rewrites =====================
  console.log('-- number rewrites');
  await fresh();
  const rw = await page.evaluate(() => {
    const { Engine: E, CONFIG } = Chompers, s = E.state, m = E.mode();
    const lv = CONFIG.levels[CONFIG.mode][8];
    lv.enemies = { ...lv.enemies, types: ['wanderer'], spawnDelay: 200 };
    const run = (eatDownTo) => {
      E.debug.gotoLevel(9);
      // eat correct cells until `eatDownTo` remain (no Grumps yet: spawn delay hasn't elapsed)
      while (s.remaining > eatDownTo) {
        const i = s.cells.findIndex(c => !c.eaten && m.isCorrect(c.value, s.params));
        E.debug.placePlayer(i % CONFIG.grid.cols, Math.floor(i / CONFIG.grid.cols));
        E.handle('eat');
      }
      const floor = Math.min(s.remaining, CONFIG.board.minCorrect);
      const eaten0 = s.cells.filter(c => c.eaten).length;
      E.debug.placePlayer(2, 2); E.debug.setSafe(2, 2, 1e9);
      const values0 = s.cells.map(c => c.value).join();
      let rewrites = 0;
      const err = T.sim(60000, () => {
        if (s.screen !== 'playing') return 'screen changed to ' + s.screen;
        if (T.visibleDupes().length) return 'duplicate numbers ' + T.visibleDupes();
        if (s.remaining !== T.recount()) return 'remaining out of sync';
        if (s.remaining < floor) return `correct cells fell to ${s.remaining} (< ${floor})`;
        if (s.cells.filter(c => c.eaten).length !== eaten0) return 'an eaten cell was refilled';
        for (const c of s.cells) if (c.fxT === CONFIG.timing.rewriteFlash) rewrites++;
      });
      return { err, rewrites, changed: s.cells.map(c => c.value).join() !== values0, enemies: s.enemies.length };
    };
    return { full: run(99), low: run(2) };
  });
  check(rw.full.rewrites > 0 && rw.full.changed, `Wanderers rewrite numbers as they walk (${rw.full.rewrites} rewrites in 60 s)`);
  check(rw.full.err === null, 'full board: rewrites keep numbers unique and correct cells >= minCorrect' + (rw.full.err ? ` (${rw.full.err})` : ''));
  check(rw.low.err === null, 'nearly-cleared board (2 left): rewrites never reduce the correct count or end the level' + (rw.low.err ? ` (${rw.low.err})` : ''));

  // ===================== screenshot of a busy level =====================
  await fresh();
  await page.evaluate(() => {
    const { Engine: E } = Chompers, s = E.state;
    E.debug.gotoLevel(9);
    E.debug.placePlayer(1, 1); E.debug.setSafe(1, 1, 20000);
    T.sim(9000);
  });
  await page.waitForTimeout(60);
  await shot('08-enemies');

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
