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
const http = require('http');
const { chromium } = require('playwright');
const icons = require('./make-icons');

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
    // independent check of an expression's value (plain JS arithmetic)
    jsEval(v) {
      const js = String(v).replace('×', '*').replace('÷', '/').replace('−', '-');
      if (!/^\d+[-+*/]\d+$/.test(js)) return NaN;
      return Function('return (' + js + ')')();
    },
    // null if value v is a legal cell for mode id with params p, else a reason
    invalid(id, v, p) {
      const { CONFIG } = Chompers;
      if (String(v).length > CONFIG.profile.board.maxChars) return `"${v}" longer than ${CONFIG.profile.board.maxChars}`;
      if (id === 'equals') {
        const m = /^(\d+)([+−×÷])(\d+)$/.exec(v);
        if (typeof v !== 'string' || !m) return `"${v}" is not an expression`;
        const a = +m[1], op = m[2], b = +m[3], x = T.jsEval(v);
        if (!Number.isInteger(x) || x < 0) return `"${v}" = ${x} (not a whole number >= 0)`;
        if (!p.ops.includes(op)) return `"${v}" uses ${op}, not in ${p.ops}`;
        const [lo, hi] = p.operand, inR = n => n >= lo && n <= hi;
        if (op === '÷' ? !(inR(x) && b >= Math.max(1, lo) && b <= hi) : !(inR(a) && inR(b))) return `"${v}" operands outside ${lo}..${hi}`;
        return null;
      }
      if (!Number.isInteger(v) || v < 1 || v > p.max) return `${v} outside 1..${p.max}`;
      return null;
    },
    // full validity check of the current board
    boardProblem() {
      const { CONFIG, Engine: E } = Chompers, s = E.state, id = s.modeId;
      const shown = s.cells.filter(c => !c.eaten).map(c => String(c.value));
      if (new Set(shown).size !== shown.length) return 'duplicate cell text';
      if (s.remaining !== T.recount()) return 'remaining out of sync';
      for (const c of s.cells) { const bad = T.invalid(id, c.value, s.params); if (bad) return bad; }
      return null;
    },
    isEdge(e) {
      const { cols, rows } = Chompers.CONFIG.profile.grid;
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
  // fresh(): reload with empty localStorage; reload(): reload keeping it (persistence checks)
  const fresh = async () => {
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL);
    await page.waitForTimeout(150);
  };
  const reload = async () => { await page.goto(URL); await page.waitForTimeout(150); };
  const S = () => page.evaluate(() => {
    const s = Chompers.Engine.state;
    return { screen: s.screen, lives: s.lives, level: s.level, score: s.score };
  });
  // Put the player on a cell whose correctness == want; returns index or null.
  const goTo = want => page.evaluate(want => {
    const { Engine, CONFIG } = window.Chompers, s = Engine.state, m = Engine.mode();
    const i = s.cells.findIndex(c => !c.eaten && m.isCorrect(c.value, s.params) === want);
    if (i < 0) return null;
    s.player.col = i % CONFIG.profile.grid.cols; s.player.row = Math.floor(i / CONFIG.profile.grid.cols);
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
  const stats = await page.evaluate(() => {
    const s = Chompers.Engine.state;
    return { ...s.levelStats, eaten: s.cells.filter(c => c.eaten).length };
  });
  check(stats.correct === stats.eaten && stats.wrong === 1 && stats.ms > 1000,
        `stage-clear stats: ${stats.correct} correct, ${stats.wrong} wrong, ${(stats.ms / 1000).toFixed(1)} s`);
  await page.waitForTimeout(2000);
  st = await S();
  check(st.screen === 'playing' && st.level === 2, 'advances to level 2');

  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  await shot('05-pause');
  check((await S()).screen === 'paused', 'Esc pauses');
  await page.keyboard.press('Escape');
  check((await S()).screen === 'playing', 'Esc resumes');

  for (let k = 0; k < 3; k++) { await goTo(false); await page.keyboard.press('Space'); await page.waitForTimeout(1600); }
  check((await S()).screen === 'entername', 'losing all lives with a top-5 score goes to name entry');
  await page.waitForTimeout(800);
  await page.keyboard.press('Space'); await page.waitForTimeout(100);
  check((await S()).screen === 'gameover', 'Space saves the initials and shows game over');
  await page.waitForTimeout(800);
  await shot('06-gameover');
  await page.keyboard.press('Space'); await page.waitForTimeout(100);
  check((await S()).screen === 'title', 'Space returns to title');

  // ===================== housekeeping: unique numbers =====================
  console.log('-- unique numbers');
  await fresh();
  const uniq = await page.evaluate(() => {
    const { Engine, CAMPAIGN } = Chompers, n = CAMPAIGN.length;
    let boards = 0, dupes = 0, tooFew = 0;
    for (let lvl = 1; lvl <= n; lvl++) for (let k = 0; k < 30; k++) {
      Engine.debug.gotoLevel(lvl); boards++;
      if (T.visibleDupes().length) dupes++;
      if (Engine.state.remaining < CONFIG.profile.board.minCorrect) tooFew++;
    }
    return { boards, dupes, tooFew };
  });
  check(uniq.dupes === 0, `no duplicate numbers on ${uniq.boards} generated boards (all campaign stages)`);
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
    return { before, atSpawn, minDist: CONFIG.profile.enemies.spawnMinDistance, later: s.enemies.length, count: s.enemyCfg.count };
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
    T.sim(CONFIG.profile.timing.deathLock + 50, () => s.lockKind === null && 'unlocked'); // stop the step the lock ends
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
    T.sim(CONFIG.profile.timing.deathLock + 50);
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
    const { Engine: E, CONFIG } = Chompers, s = E.state, sc = CONFIG.profile.safeCell;
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
    E.debug.gotoLevel(6);              // campaign stage 6: two Grumps, safe cells on
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
    const { Engine: E, CONFIG, CAMPAIGN } = Chompers, s = E.state;
    const lv = CAMPAIGN[8]; // stage 9
    lv.enemies = { ...lv.enemies, types: ['wanderer'], spawnDelay: 200 };
    const run = (eatDownTo) => {
      E.debug.gotoLevel(9);
      const m = E.mode();
      // eat correct cells until `eatDownTo` remain (no Grumps yet: spawn delay hasn't elapsed)
      while (s.remaining > eatDownTo) {
        const i = s.cells.findIndex(c => !c.eaten && m.isCorrect(c.value, s.params));
        E.debug.placePlayer(i % CONFIG.profile.grid.cols, Math.floor(i / CONFIG.profile.grid.cols));
        E.handle('eat');
      }
      const floor = Math.min(s.remaining, CONFIG.profile.board.minCorrect);
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
        for (const c of s.cells) if (c.fxT === CONFIG.profile.timing.rewriteFlash) rewrites++;
      });
      return { err, rewrites, changed: s.cells.map(c => c.value).join() !== values0, enemies: s.enemies.length };
    };
    return { full: run(99), low: run(2) };
  });
  check(rw.full.rewrites > 0 && rw.full.changed, `Wanderers rewrite numbers as they walk (${rw.full.rewrites} rewrites in 60 s)`);
  check(rw.full.err === null, 'full board: rewrites keep numbers unique and correct cells >= minCorrect' + (rw.full.err ? ` (${rw.full.err})` : ''));
  check(rw.low.err === null, 'nearly-cleared board (2 left): rewrites never reduce the correct count or end the level' + (rw.low.err ? ` (${rw.low.err})` : ''));

  // ===================== modes =====================
  console.log('-- modes');
  await fresh();
  const boards = await page.evaluate(() => {
    const { MODES, Engine: E } = Chompers, out = {};
    for (const id of Object.keys(MODES)) {
      const len = E.trackStages(id).length;
      const r = { boards: 0, escalated: 0, problems: [], minCorrect: Infinity };
      const sweep = (L, times) => {
        for (let k = 0; k < times; k++) {
          E.debug.gotoLevel(L, id); r.boards++;
          if (L > len) r.escalated++;
          if (E.state.modeId !== id) r.problems.push(`stage ${L}: mode ${E.state.modeId}`);
          r.minCorrect = Math.min(r.minCorrect, E.state.remaining);
          const bad = T.boardProblem();
          if (bad && r.problems.length < 3) r.problems.push(`stage ${L}: ${bad}`);
        }
      };
      for (let L = 1; L <= len; L++) sweep(L, 200);                // every configured stage
      for (let L = len + 1; L <= 2 * len; L++) sweep(L, 50);       // first escalated lap
      for (const k of [20, 40, 60]) sweep(len + k, 50);           // deep escalation (ranges at rangeMax)
      out[id] = r;
    }
    return out;
  });
  for (const [id, r] of Object.entries(boards)) {
    check(r.problems.length === 0, `${id}: ${r.boards} boards (200 per stage + ${r.escalated} escalated) unique, in range, <= maxChars` + (r.problems.length ? ' ' + JSON.stringify(r.problems) : ''));
    check(r.minCorrect >= 6, `${id}: every board has >= board.minCorrect correct cells (lowest seen ${r.minCorrect})`);
  }

  const exprs = await page.evaluate(() => {
    const { CONFIG, MODES, MathUtil, Engine: E } = Chompers, m = MODES.equals;
    const fixed = { '3+9': 12, '4×3': 12, '15−3': 12, '24÷2': 12, '7÷2': NaN, '2−9': -7, '12x12': 144, '9-4': 5, '8/2': 4, 'abc': NaN };
    const fixedBad = Object.entries(fixed).filter(([s, v]) => !Object.is(MathUtil.evalExpr(s), v));
    let checked = 0, mismatches = [];
    const len = E.trackStages('equals').length;
    for (let L = 1; L <= len + 8; L++) {             // configured stages + escalated ones
      E.debug.gotoLevel(L, 'equals');
      const p = E.state.params;
      for (let k = 0; k < 500; k++) {
        const s = m.randomExpr(p, (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1)));
        if (s === null) continue;
        checked++;
        if (MathUtil.evalExpr(s) !== T.jsEval(s) && mismatches.length < 3) mismatches.push(s);
      }
    }
    const msgs = [
      m.explain('4×3', { variant: 'lt', n: 10 }),
      m.explain('3+9', { variant: 'eq', n: 10 }),
      m.explain('15−3', { variant: 'gt', n: 20 }),
      MODES.primes.explain(91), MODES.primes.explain(1), MODES.factors.explain(9, { n: 24 }),
    ];
    const titles = [MODES.equals.title({ variant: 'eq', n: 10 }), MODES.equals.title({ variant: 'lt', n: 10 }),
                    MODES.equals.title({ variant: 'gt', n: 10 }), MODES.factors.title({ n: 24 }), MODES.primes.title({})];
    return { fixedBad, checked, mismatches, msgs, titles };
  });
  check(exprs.fixedBad.length === 0, 'evalExpr: hand-checked cases (3+9, 4×3, 15−3, 24÷2, 7÷2 -> NaN, ...)' + (exprs.fixedBad.length ? ' ' + JSON.stringify(exprs.fixedBad) : ''));
  check(exprs.mismatches.length === 0, `evalExpr matches plain JS arithmetic on ${exprs.checked} generated expressions`);
  check(exprs.msgs[0] === '4×3 = 12, not less than 10' && exprs.msgs[1] === '3+9 = 12, not equal to 10' && exprs.msgs[2] === '15−3 = 12, not greater than 20',
        'wrong-eat messages show the evaluated value: ' + exprs.msgs.slice(0, 3).join(' | '));
  check(exprs.msgs[3] === '91 = 7×13, not prime' && exprs.msgs[4] === '1 is not prime' && exprs.msgs[5] === '9 is not a factor of 24',
        'primes / factors wrong-eat messages: ' + exprs.msgs.slice(3).join(' | '));
  check(exprs.titles.join('|') === 'Equal to 10|Less than 10|Greater than 10|Factors of 24|Primes', 'headers: ' + exprs.titles.join(' | '));

  const nearMiss = await page.evaluate(() => {
    const { CONFIG, MathUtil, Engine: E } = Chompers;
    let wrong = 0, near = 0;
    for (let k = 0; k < 100; k++) {
      E.debug.gotoLevel(4, 'primes'); // practice stage 4 = primes to 100
      for (const c of E.state.cells) if (!MathUtil.isPrime(c.value)) { wrong++; if (c.value === 1 || c.value % 2) near++; }
    }
    // baseline: share of 1 + odd composites among all non-primes in 1..100
    let base = 0, all = 0;
    for (let v = 1; v <= 100; v++) if (!MathUtil.isPrime(v)) { all++; if (v === 1 || v % 2) base++; }
    return { share: near / wrong, base: base / all };
  });
  check(nearMiss.share > nearMiss.base + 0.2, `primes over-represent near-misses (${Math.round(nearMiss.share * 100)}% of wrong cells vs ${Math.round(nearMiss.base * 100)}% by chance)`);

  const rewrites = await page.evaluate(() => {
    const { CONFIG, Engine: E } = Chompers, s = E.state, out = {};
    for (const [id, L] of [['multiples', 6], ['factors', 4], ['primes', 3], ['equals', 4], ['equals', 6]]) {
      E.debug.gotoLevel(L, id); // practice track for that mode
      E.debug.placePlayer(2, 2); E.debug.setSafe(2, 2, 1e9);
      s.enemyCfg = { ...s.enemyCfg, count: 2, types: ['wanderer'] }; // only number-altering Grumps
      s.spawnT = 0;
      let n = 0;
      const err = T.sim(30000, () => {
        if (s.screen !== 'playing') return 'screen ' + s.screen;
        if (s.remaining < CONFIG.profile.board.minCorrect) return 'correct cells below minCorrect';
        for (const c of s.cells) if (c.fxT === CONFIG.profile.timing.rewriteFlash) n++;
        return T.boardProblem();
      });
      out[`${id}#${L}`] = { err, rewrites: n };
    }
    return out;
  });
  for (const [k, r] of Object.entries(rewrites))
    check(r.err === null && r.rewrites > 0, `${k}: Wanderer rewrites use the mode's generator (${r.rewrites} rewrites, board stays valid)` + (r.err ? ` (${r.err})` : ''));

  // ===================== campaign + escalation =====================
  console.log('-- campaign and escalation');
  await fresh();
  const camp = await page.evaluate(() => {
    const { CAMPAIGN, Engine: E } = Chompers;
    // 1) stageFor follows CAMPAIGN exactly, in order
    const mismatch = [];
    CAMPAIGN.forEach((st, i) => {
      const r = E.stageFor('campaign', i + 1);
      const same = r.modeId === st.mode && JSON.stringify(r.params) === JSON.stringify(st.params)
        && r.safeCell === !!st.safeCell && r.enemies.count === (st.enemies ? st.enemies.count : 0) && r.k === 0;
      if (!same) mismatch.push(i + 1);
    });
    // 2) the opening matches the spec'd order
    const spec = [
      st => st.mode === 'multiples' && st.params.n === 2,
      st => st.mode === 'multiples' && st.params.n === 5,
      st => st.mode === 'factors' && JSON.stringify(st.params.ns) === '[12]',
      st => st.mode === 'primes' && st.params.max === 30,
      st => st.mode === 'equals' && st.params.variant === 'eq' && st.params.ops.every(o => o === '+' || o === '−'),
      st => st.mode === 'multiples' && st.params.n === 3,
      st => st.mode === 'factors' && JSON.stringify(st.params.ns) === '[24]',
      st => st.mode === 'equals' && st.params.variant === 'lt',
      st => st.mode === 'primes' && st.params.max === 50,
    ];
    const specBad = spec.map((f, i) => (f(CAMPAIGN[i]) ? null : i + 1)).filter(Boolean);
    // 3) each mode's first appearance is its gentlest stage (no Grumps beyond 1)
    const firsts = {};
    CAMPAIGN.forEach((st, i) => { if (!(st.mode in firsts)) firsts[st.mode] = (st.enemies ? st.enemies.count : 0); });
    // 4) no two neighbouring stages share a mode after the opening pair
    const repeats = CAMPAIGN.map((st, i) => (i > 1 && st.mode === CAMPAIGN[i - 1].mode ? i + 1 : null)).filter(Boolean);
    return { len: CAMPAIGN.length, mismatch, specBad, firsts, repeats };
  });
  check(camp.mismatch.length === 0, `stageFor('campaign', n) returns CAMPAIGN[n-1] for all ${camp.len} stages` + (camp.mismatch.length ? ' ' + camp.mismatch : ''));
  check(camp.specBad.length === 0, 'campaign opens: x2, x5, factors of 12, primes to 30, equal-to (+/-), x3, factors of 24, less-than, primes to 50' + (camp.specBad.length ? ' (wrong at ' + camp.specBad + ')' : ''));
  check(Object.values(camp.firsts).every(c => c <= 1), 'each mode first appears with at most one Grump ' + JSON.stringify(camp.firsts));
  check(camp.repeats.length === 0, 'modes rotate: no back-to-back stages of the same mode after stage 2');

  const esc = await page.evaluate(() => {
    const { CONFIG, Engine: E } = Chompers, out = {};
    for (const track of CONFIG.profile.menu) {
      const len = E.trackStages(track).length, problems = [];
      let prev = E.stageFor(track, len); // k = 0: the last configured stage
      const eff = st => ({ count: Math.min(st.enemies.count, CONFIG.profile.enemies.maxOnScreen), tick: st.enemies.tickMult,
                           safe: st.safeCell ? st.safeDuration : Infinity, range: st.rangeScale });
      const modes = [];
      for (let k = 1; k <= 80; k++) {
        const cur = E.stageFor(track, len + k), a = eff(prev), b = eff(cur);
        if (b.count < a.count) problems.push(`k=${k}: Grumps ${a.count}->${b.count}`);
        if (b.tick > a.tick) problems.push(`k=${k}: tickMult ${a.tick}->${b.tick}`);
        if (b.safe > a.safe) problems.push(`k=${k}: safe ${a.safe}->${b.safe}`);
        if (b.range < a.range) problems.push(`k=${k}: range ${a.range}->${b.range}`);
        if (b.tick < CONFIG.profile.escalation.tickFloor - 1e-9 || b.safe < CONFIG.profile.escalation.safeFloor - 1e-9) problems.push(`k=${k}: below a floor`);
        if (b.count > CONFIG.profile.enemies.maxOnScreen) problems.push(`k=${k}: above maxOnScreen`);
        modes.push(cur.modeId);
        prev = cur;
      }
      const expectModes = Array.from({ length: 80 }, (_, i) => E.trackStages(track)[i % len].mode);
      const last = eff(E.stageFor(track, len + 80)), first = eff(E.stageFor(track, len + 1));
      out[track] = { problems: problems.slice(0, 3), cycles: modes.join() === expectModes.join(),
                     grew: last.count > first.count && last.tick < first.tick && last.safe < first.safe && last.range > first.range,
                     end: last };
    }
    return out;
  });
  for (const [track, r] of Object.entries(esc)) {
    check(r.problems.length === 0 && r.grew, `${track}: 80 stages past the end, difficulty never eases (Grumps, speed, safe time, range all monotone; ends at ${r.end.count} Grumps, tick x${r.end.tick.toFixed(2)}, safe ${Math.round(r.end.safe)} ms, range x${r.end.range})` + (r.problems.length ? ' ' + JSON.stringify(r.problems) : ''));
    check(r.cycles, `${track}: past the end, modes keep cycling in track order`);
  }

  const safeEsc = await page.evaluate(() => {
    const { CAMPAIGN, Engine: E } = Chompers, s = E.state;
    E.debug.gotoLevel(CAMPAIGN.length + 10);
    s.spawnT = 1e9; s.safeT = 0;
    T.sim(16);
    return { dur: s.safe && s.safe.dur, want: s.stage.safeDuration };
  });
  check(safeEsc.dur === safeEsc.want && safeEsc.want < 6000, `escalated stages use the shorter safe-cell duration (${Math.round(safeEsc.dur)} ms)`);

  // ===================== title menu + practice =====================
  console.log('-- title menu and practice');
  await fresh();
  await shot('09-title-menu');
  const menu = await page.evaluate(() => Chompers.CONFIG.profile.menu);
  const sel = () => page.evaluate(() => Chompers.Engine.state.menuIndex);
  await page.keyboard.press('ArrowUp');
  check((await sel()) === menu.length - 1, 'Up from the top of the menu wraps to the last entry');
  await page.keyboard.press('ArrowDown');
  check((await sel()) === 0, 'Down wraps back to Campaign');

  for (let i = 1; i < menu.length; i++) {
    const id = menu[i];
    await fresh();
    for (let k = 0; k < i; k++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await page.waitForTimeout(50);
    // play it for real: eat every correct cell, let the stage-clear banner run, repeat
    const run = await page.evaluate(id => {
      const { CONFIG, Engine: E } = Chompers, s = E.state;
      const len = E.trackStages(id).length, seen = new Set(), titles = [];
      if (s.track !== id) return { err: 'track is ' + s.track };
      for (let stage = 1; stage <= len + 6; stage++) {
        if (s.screen !== 'playing' || s.level !== stage) return { err: `expected stage ${stage}, got ${s.screen} ${s.level}` };
        seen.add(s.modeId); titles.push(E.mode().title(s.params));
        s.enemies = []; s.spawnT = 1e9;               // keep Grumps out of the way
        const m = E.mode();
        while (s.screen === 'playing') {
          const i = s.cells.findIndex(c => !c.eaten && m.isCorrect(c.value, s.params));
          E.debug.placePlayer(i % CONFIG.profile.grid.cols, Math.floor(i / CONFIG.profile.grid.cols));
          E.handle('eat');
        }
        T.sim(CONFIG.profile.timing.levelClear + 50);
      }
      const resolved = [];
      for (let L = 1; L <= len + 100; L++) resolved.push(E.stageFor(id, L).modeId);
      return { seen: [...seen], titles, resolvedOther: resolved.filter(x => x !== id).length, played: len + 6 };
    }, id);
    check(!run.err && run.seen.length === 1 && run.seen[0] === id && run.resolvedOther === 0,
          `practice ${id}: chosen from the menu, ${run.played} stages played (into escalation) and 100 resolved, never another mode` + (run.err ? ` (${run.err})` : ` [${run.titles.slice(0, 4).join(', ')}, ...]`));
  }

  // game over shows track + stage reached
  await fresh();
  for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowDown'); // Practice: Primes
  await page.keyboard.press('Space');
  const over = await page.evaluate(() => {
    const { CONFIG, Engine: E } = Chompers, s = E.state;
    E.debug.gotoLevel(3, 'primes');
    s.spawnT = 1e9;
    const m = E.mode();
    for (let k = 0; k < CONFIG.profile.startLives; k++) {
      const i = s.cells.findIndex(c => !c.eaten && !m.isCorrect(c.value, s.params));
      E.debug.placePlayer(i % CONFIG.profile.grid.cols, Math.floor(i / CONFIG.profile.grid.cols));
      E.handle('eat');
      T.sim(CONFIG.profile.timing.wrongLock + 50);
    }
    T.sim(CONFIG.profile.timing.gameOverGuard + 50);
    return { screen: s.screen, label: E.trackLabel(s.track), stage: s.level, title: m.title(s.params) };
  });
  await page.waitForTimeout(60);
  await shot('10-gameover-practice');
  check(over.screen === 'gameover' && over.label === 'Practice: Primes' && over.stage === 3,
        `game-over screen data: "${over.label}", "Stage ${over.stage}: ${over.title}" (see tests/out/10-gameover-practice.png)`);

  // ===================== polish: high scores =====================
  console.log('-- high scores');
  await fresh();
  const hs = await page.evaluate(() => {
    const { Engine: E, CONFIG } = Chompers, H = E.Hiscores, cap = CONFIG.profile.hiscores.perTrack;
    let list = [];
    const ranks = [];
    for (const [name, score] of [['AAA', 50], ['BBB', 10], ['CCC', 30], ['DDD', 30], ['EEE', 70], ['FFF', 20], ['GGG', 5]]) {
      const r = H.insert(list, { name, score, stage: 1 }, cap);
      list = r.list; ranks.push(r.rank);
    }
    const full = list.map(e => e.name + e.score).join(' ');
    const q = { empty0: H.qualifies([], 0, cap), empty1: H.qualifies([], 1, cap),
                tieLast: H.qualifies(list, list[cap - 1].score, cap), beatLast: H.qualifies(list, list[cap - 1].score + 1, cap) };
    const clean = H.sanitize({
      campaign: [{ name: 'ZZZ', score: 5, stage: 2 }, { name: 'abc', score: 99, stage: 1 }, { name: 'TOOLONG', score: 99, stage: 1 },
                 { name: 'NEG', score: -4, stage: 1 }, { name: 'STR', score: '80', stage: 1 }, { name: 'TOP', score: 900, stage: 9 },
                 { name: 'MID', score: 40, stage: 3 }, null, 7, { name: 'A1', score: 3, stage: 1 },
                 { name: 'X', score: 1, stage: 1 }, { name: 'LOW', score: 2, stage: 1 }, { name: 'LOX', score: 1, stage: 1 },
                 { name: 'OUT', score: 1, stage: 0 }],
      primes: 'not a list', bogusTrack: [{ name: 'BAD', score: 9, stage: 1 }],
    }, CONFIG.profile.menu, cap);
    return { full, ranks, q, clean, tracks: Object.keys(clean) };
  });
  check(hs.full === 'EEE70 AAA50 CCC30 DDD30 FFF20', `insert keeps best-first order, ties stay in arrival order, capped at 5 (${hs.full})`);
  check(JSON.stringify(hs.ranks) === '[0,1,1,2,0,4,-1]', `insert returns the new rank, -1 when it falls off (${hs.ranks})`);
  check(!hs.q.empty0 && hs.q.empty1 && !hs.q.tieLast && hs.q.beatLast, 'qualifies: >0 on an empty table; must beat (not tie) the last of a full one');
  check(hs.clean.campaign.map(e => e.name).join() === 'TOP,MID,ZZZ,LOW,LOX' && hs.clean.primes.length === 0
        && hs.tracks.join() === 'campaign,multiples,factors,primes,equals',
        `sanitize drops bad entries/tracks, sorts and caps (${hs.clean.campaign.map(e => e.name + e.score).join(' ')})`);

  const rt = await page.evaluate(() => {
    const { Storage, CONFIG } = Chompers;
    const data = { hiscores: { campaign: [{ name: 'RTX', score: 123, stage: 4 }] }, muted: true, initials: 'RTX' };
    const ok = Storage.save(data);
    const back = Storage.load();
    const raw = JSON.parse(localStorage.getItem(CONFIG.profile.storageKey));
    localStorage.setItem(CONFIG.profile.storageKey, JSON.stringify({ ...raw, version: 999 }));
    const wrongVersion = Storage.load();
    localStorage.setItem(CONFIG.profile.storageKey, '{not json');
    const corrupt = Storage.load();
    localStorage.removeItem(CONFIG.profile.storageKey);
    return { ok, same: JSON.stringify({ version: CONFIG.storage.version, ...data }) === JSON.stringify(back),
             keys: Object.keys(localStorage), wrongVersion, corrupt, key: CONFIG.profile.storageKey };
  });
  check(rt.ok && rt.same, `Storage round-trip under one versioned key ("${rt.key}")`);
  check(rt.wrongVersion === null && rt.corrupt === null, 'other versions and corrupt JSON load as "nothing saved"');

  // real game -> name entry with the arrow keys -> saved -> survives a reload
  const loseWithScore = () => page.evaluate(() => {
    const { CONFIG, Engine: E } = Chompers, s = E.state, m = E.mode();
    s.spawnT = 1e9;
    const eatWhere = want => {
      const i = s.cells.findIndex(c => !c.eaten && m.isCorrect(c.value, s.params) === want);
      E.debug.placePlayer(i % CONFIG.profile.grid.cols, Math.floor(i / CONFIG.profile.grid.cols));
      E.handle('eat');
    };
    eatWhere(true); eatWhere(true);
    for (let k = 0; k < CONFIG.profile.startLives; k++) { eatWhere(false); T.sim(CONFIG.profile.timing.wrongLock + 50); }
    T.sim(CONFIG.profile.timing.gameOverGuard + 50);
    return { screen: s.screen, score: s.score };
  });
  await page.keyboard.press('Space');                    // campaign
  const lost = await loseWithScore();
  check(lost.screen === 'entername' && lost.score > 0, `a top-5 score (${lost.score}) asks for initials`);
  for (const k of ['ArrowRight', 'ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowDown']) await page.keyboard.press(k);
  await page.waitForTimeout(50);
  await shot('11-name-entry');
  await page.keyboard.press('Space');
  await page.waitForTimeout(60);
  const saved = await page.evaluate(() => {
    const s = Chompers.Engine.state;
    return { screen: s.screen, top: s.hiscores.campaign[0], newEntry: s.newEntry,
             stored: JSON.parse(localStorage.getItem(Chompers.CONFIG.profile.storageKey)) };
  });
  await shot('12-gameover-highlight');
  check(saved.screen === 'gameover' && saved.top && saved.top.name === 'ACZ' && saved.newEntry && saved.newEntry.rank === 0,
        `initials entered with Up/Down/Left/Right ("${saved.top && saved.top.name}") and highlighted as rank 1 on game over`);
  check(saved.stored && saved.stored.hiscores.campaign[0].name === 'ACZ', 'the new entry is written to localStorage immediately');
  await reload();
  const restored = await page.evaluate(() => {
    const s = Chompers.Engine.state;
    return { top: s.hiscores.campaign[0], initials: s.initials, primes: s.hiscores.primes.length };
  });
  await shot('13-title-hiscores');
  check(restored.top && restored.top.name === 'ACZ' && restored.top.score === lost.score && restored.initials === 'ACZ' && restored.primes === 0,
        'after a reload: table restored, last initials remembered, other tracks untouched');
  // a second game in practice goes into its own table
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space');
  await loseWithScore();
  await page.keyboard.press('Space'); await page.waitForTimeout(60);
  const second = await page.evaluate(() => {
    const h = Chompers.Engine.state.hiscores;
    return { campaign: h.campaign.length, multiples: h.multiples.map(e => e.name) };
  });
  check(second.campaign === 1 && second.multiples.join() === 'ACZ', 'tables are per track (practice score went to Multiples, initials pre-filled)');

  // ===================== polish: mute =====================
  console.log('-- mute');
  await fresh();
  const muteState = () => page.evaluate(() => ({ state: Chompers.Engine.state.muted, sound: Chompers.Sound.isMuted(),
    stored: (JSON.parse(localStorage.getItem(Chompers.CONFIG.profile.storageKey) || 'null') || {}).muted }));
  const m0 = await muteState();
  await page.keyboard.press('KeyM'); await page.waitForTimeout(60);
  const m1 = await muteState();
  await reload();
  const m2 = await muteState();
  await page.keyboard.press('KeyM'); await page.waitForTimeout(60);
  await reload();
  const m3 = await muteState();
  check(m0.state === false && m1.state && m1.sound && m1.stored === true, 'M mutes (engine, synth and saved state agree)');
  check(m2.state && m2.sound, 'mute survives a reload');
  check(!m3.state && !m3.sound && m3.stored === false, 'M again unmutes, and that survives a reload too');

  // ===================== polish: sound + events + feel =====================
  console.log('-- sound, events, feel');
  await fresh();
  await page.keyboard.press('KeyX');                     // any key: unlocks audio
  await page.waitForTimeout(100);
  const snd = await page.evaluate(() => {
    const { Sound } = Chompers;
    const played = Sound.names.map(n => [n, Sound.play(n)]);
    Sound.setMuted(true);
    const whileMuted = Sound.names.some(n => Sound.play(n));
    Sound.setMuted(false);
    return { unlocked: Sound.stats.unlocked, played, whileMuted };
  });
  check(snd.unlocked && snd.played.every(([, ok]) => ok), `all ${snd.played.length} synth effects play after the first key press (${snd.played.map(p => p[0]).join(', ')})`);
  check(!snd.whileMuted, 'nothing plays while muted');

  const ev = await page.evaluate(() => {
    const { CONFIG, Engine: E, ENEMY_TYPES } = Chompers, s = E.state;
    E.debug.gotoLevel(6); E.drainEvents();
    const got = new Set();
    const take = () => E.drainEvents().forEach(e => got.add(e));
    E.handle(s.player.col > 0 ? 'left' : 'right'); take();
    const m = E.mode();
    let i = s.cells.findIndex(c => !c.eaten && m.isCorrect(c.value, s.params));
    E.debug.placePlayer(i % 6, Math.floor(i / 6)); E.handle('eat'); take();
    i = s.cells.findIndex(c => !c.eaten && !m.isCorrect(c.value, s.params));
    E.debug.placePlayer(i % 6, Math.floor(i / 6)); E.handle('eat'); take();
    T.sim(CONFIG.profile.timing.wrongLock + 50); take();
    s.spawnT = 0; s.safeT = 0; T.sim(32); take();      // spawn + safe cell
    ENEMY_TYPES.stalker.randomStepChance = 0;
    s.enemies = []; E.debug.setSafe(null, null, 1e9);
    E.debug.spawn('stalker', s.player.col + 1 < 6 ? s.player.col + 1 : s.player.col - 1, s.player.row).tickT = 0;
    T.sim(32); take();                                  // death
    s.screen = 'title'; E.handle('down'); take();       // menu
    return [...got].sort();
  });
  check(['correct', 'death', 'menu', 'move', 'safe', 'spawn', 'wrong'].every(e => ev.includes(e)), `engine emits sound events: ${ev.join(', ')}`);

  const feel = await page.evaluate(() => {
    const { CONFIG, Engine: E, Loop, Render } = Chompers, s = E.state;
    const out = {};
    for (const on of [true, false]) {
      CONFIG.profile.feel.hitStop = on;
      E.debug.gotoLevel(1); E.drainEvents();
      const m = E.mode(), i = s.cells.findIndex(c => !c.eaten && m.isCorrect(c.value, s.params));
      E.debug.placePlayer(i % 6, Math.floor(i / 6)); E.handle('eat');
      out['hit' + on] = [Loop.step(16), Loop.step(16)];
    }
    CONFIG.profile.feel.hitStop = true;
    // death flash: draw the first frame of a death and sample a background pixel
    const px = () => Array.from(document.getElementById('screen').getContext('2d').getImageData(2, 100, 1, 1).data.slice(0, 3));
    for (const on of [true, false]) {
      CONFIG.profile.feel.deathFlash = on;
      E.debug.gotoLevel(5); s.enemies = []; s.spawnT = 1e9; E.debug.setSafe(null, null, 1e9);
      const g = E.debug.spawn('wanderer', s.player.col + 1, s.player.row); g.tickT = 1e9;
      E.handle('right');
      Render.draw(s, performance.now());
      out['flash' + on] = px();
    }
    CONFIG.profile.feel.deathFlash = true;
    return out;
  });
  const bright = rgb => rgb.reduce((a, b) => a + b, 0);
  check(JSON.stringify(feel.hittrue) === '[false,true]' && JSON.stringify(feel.hitfalse) === '[true,true]',
        `hit-stop holds exactly ${1} frame after a correct eat, and is off when CONFIG.profile.feel.hitStop is false`);
  check(bright(feel.flashtrue) > 400 && bright(feel.flashfalse) < 150,
        `death screen flash (rgb ${feel.flashtrue}) and none with CONFIG.profile.feel.deathFlash off (rgb ${feel.flashfalse})`);

  // ===================== polish: attract mode =====================
  console.log('-- attract mode');
  await fresh();
  // leave a finished game behind so there is real state to protect
  await page.evaluate(() => {
    const { CONFIG, Engine: E } = Chompers, s = E.state;
    E.debug.gotoLevel(4, 'factors'); s.spawnT = 1e9;
    const m = E.mode();
    for (let k = 0; k < CONFIG.profile.startLives; k++) {
      const i = s.cells.findIndex(c => !c.eaten && !m.isCorrect(c.value, s.params));
      E.debug.placePlayer(i % 6, Math.floor(i / 6)); E.handle('eat'); T.sim(CONFIG.profile.timing.wrongLock + 50);
    }
    T.sim(CONFIG.profile.timing.gameOverGuard + 50);
    E.handle('confirm');                                  // game over -> title
    s.menuIndex = 2;
  });
  const gameSnap = () => page.evaluate(() => {
    const skip = new Set(['screen', 'idleT', 'attract', 'events']);
    const s = Chompers.Engine.state;
    return JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => !skip.has(k))))
      + '|' + localStorage.getItem(Chompers.CONFIG.profile.storageKey);
  });
  const before = await gameSnap();
  const att = await page.evaluate(() => {
    const { CONFIG, Engine: E } = Chompers, s = E.state;
    s.idleT = 0;                                        // ignore real frames that ran between steps
    T.sim(CONFIG.attract.idleMs - 500);
    const early = s.screen;
    T.sim(600);
    const entered = s.screen;
    const pos0 = s.attract && JSON.stringify(s.attract.enemies.map(e => [e.col, e.row]));
    T.sim(6000);
    const moved = s.attract && JSON.stringify(s.attract.enemies.map(e => [e.col, e.row])) !== pos0;
    return { early, entered, moved, grumps: s.attract ? s.attract.enemies.length : 0, player: s.attract && 'player' in s.attract };
  });
  await page.waitForTimeout(60);
  await shot('14-attract');
  const mid = await gameSnap();
  await page.keyboard.press('KeyQ');                    // any key
  await page.waitForTimeout(60);
  const exited = await page.evaluate(() => ({ screen: Chompers.Engine.state.screen, attract: Chompers.Engine.state.attract }));
  const afterExit = await gameSnap();
  check(att.early === 'title' && att.entered === 'attract', `attract demo starts after ${20} s idle on the title, not before`);
  check(att.moved && att.grumps > 0 && !att.player, `demo board: ${att.grumps} Grumps wandering, no player`);
  check(exited.screen === 'title' && exited.attract === null, 'any key returns to the title');
  check(before === mid && mid === afterExit, 'game state, high scores, menu selection and storage are identical before, during and after the demo');
  const auto = await page.evaluate(() => {
    const { CONFIG, Engine: E } = Chompers, s = E.state;
    T.sim(CONFIG.attract.idleMs + 100);
    const on = s.screen;
    T.sim(CONFIG.attract.durationMs + 100);
    const off = s.screen;
    E.handle('down');                                   // title input resets the idle timer
    T.sim(CONFIG.attract.idleMs - 1000);
    return { on, off, stillTitle: s.screen };
  });
  check(auto.on === 'attract' && auto.off === 'title' && auto.stillTitle === 'title', 'the demo loops back to the title by itself; input on the title resets the idle timer');

  // ===================== profiles + themes =====================
  console.log('-- profiles and themes');
  const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
  const rulesOf = () => page.evaluate(() => {
    // same shape as tests/regular-rules.snapshot.json (recorded before profiles existed)
    const { CONFIG, Engine: E } = Chompers, PR = CONFIG.profile;
    const enemyTypes = {};
    for (const [id, t] of Object.entries(PR.enemyTypes)) { const { color, move, ...rest } = t; enemyTypes[id] = rest; }
    const stages = {};
    for (const track of PR.menu) {
      const len = E.trackStages(track).length;
      stages[track] = Array.from({ length: len + 40 }, (_, i) => E.stageFor(track, i + 1));
    }
    return JSON.parse(JSON.stringify({
      campaign: PR.campaign,
      rules: { grid: PR.grid, startLives: PR.startLives, scoring: PR.scoring, board: PR.board, timing: PR.timing,
               enemies: PR.enemies, safeCell: PR.safeCell, feel: PR.feel, escalation: PR.escalation,
               menu: PR.menu, hiscores: PR.hiscores },
      enemyTypes,
      trackLabels: Object.fromEntries(PR.menu.map(t => [t, E.trackLabel(t)])),
      stages,
    }));
  });
  await page.goto(URL + '?game=regular'); await page.waitForTimeout(150);
  const regularNow = JSON.stringify(canon(await rulesOf()), null, 1) + '\n';
  const regularThen = fs.readFileSync(path.join(__dirname, 'regular-rules.snapshot.json'), 'utf8');
  check(regularNow === regularThen,
        'regular profile: campaign, rules, Grump tunables, track names and every resolved stage (to 40 past the end) are identical to the pre-profile snapshot');

  // selectGame with fake hostnames (pure function, run in Node on the CONFIG section)
  const { selectGame: pick } = icons.loadData();
  const hostCases = [
    ['chompersjr.realmarras.com', '', 'jr'], ['CHOMPERSJR.example.org', '', 'jr'], ['chompersjr.localhost', '', 'jr'],
    ['chompers.realmarras.com', '', 'regular'], ['localhost', '', 'regular'], ['127.0.0.1', '', 'regular'], ['', '', 'regular'],
    ['notchompersjr.com', '', 'regular'], ['www.chompersjr.com', '', 'regular'], ['chompersjr', '', 'regular'],
    ['chompers.realmarras.com', '?game=jr', 'jr'], ['chompersjr.realmarras.com', '?game=regular', 'regular'],
    ['chompersjr.realmarras.com', '?game=bogus', 'jr'], ['localhost', '?x=1&game=jr', 'jr'], ['localhost', '?game=', 'regular'],
  ];
  const hostBad = hostCases.filter(([h, q, want]) => pick(h, q) !== want).map(([h, q, w]) => `${h}${q} -> ${pick(h, q)} (want ${w})`);
  check(hostBad.length === 0, `selectGame: ${hostCases.length} hostname / ?game= cases (chompersjr.* -> jr, else regular; ?game= overrides)` + (hostBad.length ? ' ' + hostBad.join('; ') : ''));

  // no "is this jr" branching outside CONFIG: later sections only read profile / theme values
  const src = fs.readFileSync(path.join(ROOT, 'chompers.html'), 'utf8');
  const downstream = src.slice(src.indexOf(' * 2. ENGINE'));
  const engineSrc = src.slice(src.indexOf(' * 2. ENGINE'), src.indexOf(' * 3. RENDER'));
  // (listing PROFILES / THEMES in the window.Chompers debug object is fine; indexing or comparing is not)
  const branches = downstream.match(/['"]jr['"]|['"]regular['"]|CONFIG\.game\b|PROFILES\s*[.[]|THEMES\s*[.[]/g) || [];
  const engineTheme = engineSrc.match(/CONFIG\.theme|THEMES/g) || [];
  check(engineTheme.length === 0, 'the engine reads CONFIG.profile only (no theme, no THEMES)');
  check(branches.length === 0, `no game-id branching after CONFIG: later sections only read profile / theme values (found: ${branches.join(', ') || 'none'})`);

  // boot each game: title, footer, storage key
  await page.evaluate(() => localStorage.clear());
  const bootAs = async game => {
    await page.goto(URL + '?game=' + game); await page.waitForTimeout(150);
    await page.keyboard.press('KeyM');                    // any saved setting will do
    await page.waitForTimeout(60);
    return page.evaluate(() => ({
      game: Chompers.CONFIG.game, title: document.title, themeTitle: Chompers.CONFIG.theme.title,
      key: Chompers.CONFIG.profile.storageKey, keys: Object.keys(localStorage).sort(),
      footer: document.getElementById('footer').textContent,
      grid: Chompers.CONFIG.profile.grid, stages: Chompers.CONFIG.profile.campaign.map(st => st.mode),
      favicon: document.querySelector('link[rel=icon]').href === Chompers.CONFIG.theme.favicon,
    }));
  };
  const asRegular = await bootAs('regular');
  const asJr = await bootAs('jr');
  const DISCLAIMER = 'not affiliated with Number Munchers™ / MECC · for personal play.';
  check(asRegular.game === 'regular' && asRegular.title === 'Chompers' && asRegular.key === 'chompers.v1' && asRegular.favicon,
        `?game=regular: "${asRegular.title}", ${asRegular.grid.cols}x${asRegular.grid.rows}, ${asRegular.stages.length} stages, saves to ${asRegular.key}`);
  check(asJr.game === 'jr' && asJr.title === 'Chompers Jr' && asJr.themeTitle === 'Chompers Jr' && asJr.key === 'chompersjr.v1' && asJr.favicon,
        `?game=jr: "${asJr.title}", ${asJr.grid.cols}x${asJr.grid.rows}, ${asJr.stages.length} stages, saves to ${asJr.key}`);
  check(JSON.stringify(asJr.keys) === '["chompers.v1","chompersjr.v1"]' && JSON.stringify(asRegular.keys) === '["chompers.v1"]',
        'each game saves under its own localStorage key; neither touches the other');
  check(asRegular.footer === DISCLAIMER && asJr.footer === DISCLAIMER, 'both games keep the disclaimer footer');
  await page.evaluate(() => localStorage.clear());

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

  // desktop: no touch UI, and a mouse click on the board neither moves nor eats
  await fresh();
  const desk = await page.evaluate(() => {
    const { Engine: E, Input, Render } = Chompers, s = E.state;
    E.debug.gotoLevel(1);
    const shown = [...document.querySelectorAll('.tbtn.show')].length;
    return { touch: Input.touchActive(), shown, hintsTouch: Render.hints.touch, at: [s.player.col, s.player.row] };
  });
  const box = await page.locator('#screen').boundingBox();
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.3);
  await page.waitForTimeout(400);
  const deskAfter = await page.evaluate(() => { const s = Chompers.Engine.state; return { at: [s.player.col, s.player.row], eaten: s.levelStats.correct + s.levelStats.wrong }; });
  check(!desk.touch && desk.shown === 0 && !desk.hintsTouch, 'desktop (fine pointer, no touch yet): no touch buttons, keyboard texts');
  check(JSON.stringify(deskAfter.at) === JSON.stringify(desk.at) && deskAfter.eaten === 0, 'desktop mouse clicks on the board do not move or eat (unchanged)');

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

  // ===================== touch + mobile + PWA (served over http) =====================
  console.log('-- touch, mobile, PWA');
  const mobileErrors = [];
  { // own block scope: this section reuses short names (p, g, before, ...)
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new globalThis.URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}/chompers.html`;
  async function phone(viewport) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await context.newPage();
    await p.addInitScript(pageHelpers);
    p.on('pageerror', e => mobileErrors.push(`${viewport.width}x${viewport.height}: ${e.message}`));
    p.on('console', m => m.type() === 'error' && mobileErrors.push(`${viewport.width}x${viewport.height}: ${m.text()}`));
    await p.goto(HTTP);
    await p.waitForTimeout(250);
    return { context, p };
  }
  // tap a point given in canvas pixels (0..320, 0..200)
  const tapAt = async (p, x, y) => {
    const r = await p.evaluate(() => { const b = Chompers.Render.canvas.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    await p.touchscreen.tap(r.x + x * r.w / 320, r.y + y * r.h / 200);
  };
  const cellXY = async (p, col, row) => p.evaluate(([c, r]) => {
    const g = Chompers.Render.geom; return [g.gridX + (c + 0.5) * g.cellW, g.gridY + (r + 0.5) * g.cellH];
  }, [col, row]);
  const tapCell = async (p, col, row) => { const [x, y] = await cellXY(p, col, row); await tapAt(p, x, y); };
  const at = p => p.evaluate(() => [Chompers.Engine.state.player.col, Chompers.Engine.state.player.row].join(','));
  const rectOf = (p, sel) => p.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, shown: getComputedStyle(e).display !== 'none' }; }, sel);
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // place the player on a cell that is (want) correct, return its index
  const putOn = (p, want) => p.evaluate(want => {
    const { CONFIG, Engine: E } = Chompers, s = E.state, m = E.mode();
    const i = s.cells.findIndex((c, j) => !c.eaten && m.isCorrect(c.value, s.params) === want && j !== s.player.row * 6 + s.player.col);
    E.debug.placePlayer(i % CONFIG.profile.grid.cols, Math.floor(i / CONFIG.profile.grid.cols));
    return i;
  }, want);

  // ---- landscape phone ----
  const L = await phone({ width: 844, height: 390 });
  const p = L.p;
  const l0 = await p.evaluate(() => ({ touch: Chompers.Input.touchActive(), info: Chompers.Input.layoutInfo(), unlocked: Chompers.Sound.stats.unlocked }));
  check(l0.touch && l0.info.kind === 'side' && Number.isInteger(l0.info.scale) && l0.info.canvas.w === 320 * l0.info.scale,
        `landscape phone: touch UI on (coarse pointer), side layout, whole-number scale x${l0.info.scale}`);

  // title by tap: first tap selects, second confirms
  await tapAt(p, 60, 90 + 3 * 12 + 2);                     // row 4: Practice: Primes
  const sel1 = await p.evaluate(() => ({ i: Chompers.Engine.state.menuIndex, screen: Chompers.Engine.state.screen, unlocked: Chompers.Sound.stats.unlocked }));
  await tapAt(p, 60, 90 + 3 * 12 + 2);
  const started = await p.evaluate(() => ({ screen: Chompers.Engine.state.screen, track: Chompers.Engine.state.track }));
  check(!l0.unlocked && sel1.unlocked, 'first touch unlocks the audio context');
  check(sel1.i === 3 && sel1.screen === 'title' && started.screen === 'playing' && started.track === 'primes',
        'title: tapping a mode selects it, tapping it again starts it');

  // tap-to-move along a shortest path, one step per stepMs
  await p.evaluate(() => {
    Chompers.Engine.debug.gotoLevel(1);                    // stage 1: no Grumps
    window.__trail = [];
    (function sample() {
      const s = Chompers.Engine.state, k = s.player.col + ',' + s.player.row;
      if (!__trail.length || __trail[__trail.length - 1].k !== k) __trail.push({ k, t: performance.now() });
      requestAnimationFrame(sample);
    })();
  });
  const start = await at(p);
  await tapCell(p, 0, 4);
  await p.waitForFunction(() => { const s = Chompers.Engine.state; return s.player.col === 0 && s.player.row === 4; }, null, { timeout: 3000 }).catch(() => {});
  const trail = await p.evaluate(() => __trail);
  const cfg = await p.evaluate(() => Chompers.CONFIG.touch);
  const steps = trail.slice(trail.findIndex(e => e.k === start));
  const unit = steps.every((e, i) => { if (!i) return true; const [a, b] = steps[i - 1].k.split(',').map(Number), [c, d] = e.k.split(',').map(Number); return Math.abs(a - c) + Math.abs(b - d) === 1; });
  const gaps = steps.slice(1).map((e, i) => e.t - steps[i].t);
  check((await at(p)) === '0,4' && unit && steps.length - 1 === 5,
        `tap-to-move: ${start} -> 0,4 in ${steps.length - 1} single-cell steps (Manhattan distance 5, no diagonals)`);
  // timing measured from requestAnimationFrame jitters by a frame either way, so check the average
  const avgGap = gaps.slice(1).reduce((a, b) => a + b, 0) / (gaps.length - 1);
  check(avgGap >= cfg.stepMs - 10 && avgGap <= cfg.stepMs + 40,
        `walk cadence: first step on the tap, then one per ${cfg.stepMs} ms (average ${Math.round(avgGap)} ms; gaps ${gaps.slice(1).map(g => Math.round(g)).join(', ')})`);

  // a new tap cancels the walk in progress
  await tapCell(p, 5, 4);
  await p.waitForTimeout(cfg.stepMs * 1.5);
  await tapCell(p, 0, 0);
  await p.waitForFunction(() => { const s = Chompers.Engine.state; return s.player.col === 0 && s.player.row === 0; }, null, { timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(cfg.stepMs * 2);
  const reroute = await p.evaluate(() => ({ at: Chompers.Engine.state.player.col + ',' + Chompers.Engine.state.player.row, maxCol: Math.max(...__trail.slice(-12).map(e => +e.k.split(',')[0])) }));
  check(reroute.at === '0,0' && reroute.maxCol < 5, 'a new tap cancels the walk and heads for the new cell');

  // forgiving targets
  const g = await p.evaluate(() => Chompers.Render.geom);
  await tapAt(p, g.gridX - g.cellW * 0.4, g.gridY + g.cellH * 1.5);   // left of the grid, row 1
  await p.waitForTimeout(cfg.stepMs * 3);
  const forgive = await p.evaluate(g => {
    const { Render, Engine: E } = Chompers, s = { screen: 'playing' };
    return { at: E.state.player.col + ',' + E.state.player.row,
             header: Render.hitTest(s, g.gridX + g.cellW * 2.5, g.gridY - g.cellH * 0.4),
             edge: Render.hitTest(s, g.gridX + g.cellW * 3, g.gridY + g.cellH * 2.5),   // exactly on a cell border
             tooFar: Render.hitTest(s, g.gridX - g.cellW * 0.7, g.gridY + g.cellH) };
  }, g);
  check(forgive.at === '0,1' && forgive.header && forgive.header.row === 0 && forgive.header.col === 2 && forgive.edge && forgive.tooFar === null,
        'forgiving taps: up to half a cell outside the grid (even just beside the canvas) count as the nearest cell; further out is ignored');

  // tap on yourself eats; the EAT button eats
  await putOn(p, true);
  const c0 = await p.evaluate(() => Chompers.Engine.state.levelStats.correct);
  const me = await at(p);
  await tapCell(p, ...me.split(',').map(Number));
  await p.waitForTimeout(80);
  const c1 = await p.evaluate(() => Chompers.Engine.state.levelStats.correct);
  await putOn(p, true);
  await p.tap('#btn-eat');
  await p.waitForTimeout(80);
  const c2 = await p.evaluate(() => Chompers.Engine.state.levelStats.correct);
  check(c1 === c0 + 1, 'tapping the Chomper\'s own cell eats');
  check(c2 === c1 + 1, 'the EAT button eats');
  const eatBtn = await rectOf(p, '#btn-eat');
  check(eatBtn.shown && eatBtn.w >= 56 && eatBtn.h >= 56, `EAT button is thumb-sized (${eatBtn.w}x${eatBtn.h} px)`);

  // taps during a lockout are ignored
  await putOn(p, false);
  const before = await at(p);
  await tapCell(p, ...before.split(',').map(Number));        // wrong eat -> lockout
  await p.waitForTimeout(50);
  const locked = await p.evaluate(() => Chompers.Engine.state.lockT > 0);
  await tapCell(p, before === '5,0' ? 0 : 5, 0);
  await p.tap('#btn-eat');
  await p.waitForTimeout(cfg.stepMs * 2);
  const during = await at(p);
  await p.waitForFunction(() => Chompers.Engine.state.lockT <= 0, null, { timeout: 4000 });
  await p.waitForTimeout(cfg.stepMs * 4);
  const afterLock = await p.evaluate(() => ({ at: Chompers.Engine.state.player.col + ',' + Chompers.Engine.state.player.row, wrong: Chompers.Engine.state.levelStats.wrong }));
  check(locked && during === before && afterLock.at === before && afterLock.wrong === 1,
        'taps (cell and EAT) during a wrong-eat lockout are ignored, and no walk starts after it');

  // pause button + tap to resume
  await p.tap('#btn-pause');
  const paused = await p.evaluate(() => Chompers.Engine.state.screen);
  await tapAt(p, 160, 100);
  check(paused === 'paused' && (await p.evaluate(() => Chompers.Engine.state.screen)) === 'playing', 'pause button pauses; a tap on the screen resumes');

  // layout: buttons never over the canvas
  const lCanvas = await rectOf(p, '#screen'), lPause = await rectOf(p, '#btn-pause');
  check(!overlaps(eatBtn, lCanvas) && !overlaps(lPause, lCanvas) && eatBtn.x >= lCanvas.x + lCanvas.w && lPause.x + lPause.w <= lCanvas.x,
        'landscape: EAT in the right margin, pause in the left, neither over the canvas');
  await p.screenshot({ path: path.join(OUT, '15-phone-landscape.png') });

  // pinch and scroll are blocked
  await p.evaluate(() => {
    window.__touch = [];
    for (const type of ['touchstart', 'touchmove']) window.addEventListener(type, e => __touch.push({ type, prevented: e.defaultPrevented, n: e.touches.length }));
  });
  const cdp = await L.context.newCDPSession(p);
  const cb = await p.evaluate(() => { const b = Chompers.Render.canvas.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const pts = d => [{ x: cb.x - d, y: cb.y, id: 1 }, { x: cb.x + d, y: cb.y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(20) });
  for (const d of [40, 60, 90]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // one-finger drag on the empty margin (page scroll attempt)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 200, id: 3 }] });
  for (const y of [170, 120, 60]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y, id: 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(100);
  const pinch = await p.evaluate(() => ({
    moves: __touch.filter(e => e.type === 'touchmove'), two: __touch.some(e => e.n === 2),
    scale: window.visualViewport ? visualViewport.scale : 1, scrollY: window.scrollY, scrollX: window.scrollX,
    viewport: document.querySelector('meta[name=viewport]').content,
    touchAction: [getComputedStyle(document.body).touchAction, getComputedStyle(Chompers.Render.canvas).touchAction],
  }));
  check(pinch.two && pinch.moves.length >= 6 && pinch.moves.every(e => e.prevented), `pinch and drag touchmoves are all preventDefault()ed (${pinch.moves.length} events)`);
  check(pinch.scale === 1 && pinch.scrollX === 0 && pinch.scrollY === 0 && /user-scalable=no/.test(pinch.viewport) && /viewport-fit=cover/.test(pinch.viewport)
        && pinch.touchAction.every(a => a === 'none'), 'no zoom or scroll: scale 1, scroll 0, viewport meta and touch-action: none');

  // name entry, game over by tap
  await p.evaluate(() => {
    const { CONFIG, Engine: E } = Chompers, s = E.state;
    E.debug.gotoLevel(1);
    const m = E.mode(), eatWhere = want => {
      const i = s.cells.findIndex(c => !c.eaten && m.isCorrect(c.value, s.params) === want);
      E.debug.placePlayer(i % 6, Math.floor(i / 6)); E.handle('eat');
    };
    eatWhere(true);
    for (let k = 0; k < CONFIG.profile.startLives; k++) { eatWhere(false); T.sim(CONFIG.profile.timing.wrongLock + 50); }
    T.sim(CONFIG.profile.timing.gameOverGuard + 50);
  });
  const W2 = 160;
  await tapAt(p, W2, 68);                    // up arrow over letter 2 -> moves there, A -> B
  await tapAt(p, W2 + 30, 136);              // down arrow under letter 3 -> A -> Z
  const ent = await p.evaluate(() => Chompers.Engine.state.entry && Chompers.Engine.state.entry.initials.join(''));
  await p.screenshot({ path: path.join(OUT, '16-phone-name-entry.png') });
  await tapAt(p, W2, 167);                   // SAVE
  const savedName = await p.evaluate(() => ({ screen: Chompers.Engine.state.screen, top: Chompers.Engine.state.hiscores.campaign[0] }));
  await p.waitForTimeout(800);
  await tapAt(p, 160, 100);
  check(ent === 'ABZ' && savedName.screen === 'gameover' && savedName.top && savedName.top.name === 'ABZ',
        `name entry by tap: per-letter arrows and SAVE ("${ent}")`);
  check((await p.evaluate(() => Chompers.Engine.state.screen)) === 'title', 'game over: a tap returns to the title');

  // D-pad mode: toggle on the title, saved, pad works
  await p.tap('#btn-touchMode');
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem(Chompers.CONFIG.profile.storageKey)));
  await p.reload(); await p.waitForTimeout(250);
  const persisted = await p.evaluate(() => Chompers.Input.touchMode());
  check(stored && stored.touchMode === 'pad' && persisted === 'pad', 'TOUCH: TAP / PAD toggle on the title, saved with the other settings');
  await p.evaluate(() => Chompers.Engine.debug.gotoLevel(1));
  await p.waitForTimeout(80);
  const pad = {};
  for (const d of ['up', 'down', 'left', 'right', 'eat', 'pause']) pad[d] = await rectOf(p, '#btn-' + d);
  const padCanvas = await rectOf(p, '#screen');
  const padOk = ['up', 'down', 'left', 'right'].every(d => pad[d].shown && pad[d].w >= 56 && pad[d].h >= 56 && !overlaps(pad[d], padCanvas))
    && !overlaps(pad.eat, padCanvas) && !overlaps(pad.pause, padCanvas)
    && ['up', 'down', 'left', 'right'].every(d => !overlaps(pad[d], pad.pause) && !overlaps(pad[d], pad.eat));
  check(padOk, 'PAD mode: four 56 px buttons + EAT + pause, none over the canvas or each other');
  const p0 = await at(p);
  await p.tap('#btn-left');
  const p1 = await at(p);
  await p.locator('#btn-down').dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'touch', isPrimary: true });
  await p.waitForTimeout(cfg.padRepeatDelay + cfg.stepMs + 60);
  await p.locator('#btn-down').dispatchEvent('pointerup', { pointerId: 9, pointerType: 'touch', isPrimary: true });
  const p2 = await at(p);
  await p.waitForTimeout(cfg.stepMs * 2);
  const p3 = await at(p);
  const [x0, y0] = p0.split(',').map(Number), [x1] = p1.split(',').map(Number), [, y2] = p2.split(',').map(Number);
  check(x1 === x0 - 1 && y2 >= Math.min(4, y0 + 2) && p3 === p2, `D-pad: tap moves one cell, holding repeats, release stops (${p0} -> ${p1} -> ${p2})`);
  await p.screenshot({ path: path.join(OUT, '17-phone-pad.png') });

  // ---- PWA: service worker, manifest, icons, offline ----
  const pwa = await p.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 5000))]);
    const link = document.querySelector('link[rel=manifest]');
    const man = await (await fetch(link.href)).json();
    const keys = await caches.keys();
    const cache = await caches.open('chompers-' + Chompers.CONFIG.version);
    const cached = (await cache.keys()).map(r => new URL(r.url).pathname).sort();
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth + 'x' + i.naturalHeight); i.onerror = () => r('error'); i.src = src; });
    const iconSizes = await Promise.all(man.icons.map(i => load(new URL(i.src, link.href).href)));
    const fav = document.querySelector('link[rel=icon]').href;
    return { script: reg && reg.active && reg.active.scriptURL, version: Chompers.CONFIG.version, man, keys, cached, iconSizes,
             favicon: fav.startsWith('data:image/png;base64,') ? await load(fav) : 'not inline',
             palette: Chompers.CONFIG.theme.palette };
  });
  check(pwa.script && pwa.script.includes('/sw.js?v=' + pwa.version + '&cache=chompers&manifest=manifest.json'),
        `service worker registered and active (${pwa.script && pwa.script.replace(/^.*\//, '')})`);
  check(pwa.keys.includes('chompers-' + pwa.version) && ['/chompers.html', '/icons/chompers-192.png', '/icons/chompers-512.png', '/manifest.json'].every(f => pwa.cached.includes(f)),
        `offline cache "chompers-${pwa.version}" holds the page, manifest and icons`);
  const m = pwa.man;
  check(m.short_name === 'Chompers' && m.name && m.start_url && m.display === 'standalone' && m.orientation === 'landscape'
        && m.theme_color === pwa.palette.panel && m.background_color === pwa.palette.bg,
        'manifest: name, short_name, start_url, standalone, landscape, palette colours');
  check(pwa.iconSizes.join() === '192x192,512x512,192x192,512x512' && pwa.favicon === '32x32', `icons load at ${[...new Set(pwa.iconSizes)].join(' and ')}, inline favicon ${pwa.favicon}`);
  const iconData = icons.loadData();
  const stale = icons.iconList(iconData).filter(({ theme, file, size }) =>
    !icons.decodePng(fs.readFileSync(path.join(ROOT, file))).px.equals(icons.iconPixels(size, {}, icons.readArt(theme, iconData))));
  const staleFav = Object.keys(iconData.THEMES).filter(id => iconData.THEMES[id].favicon !== icons.faviconDataUrl(icons.readArt(id, iconData)));
  const favNow = await p.evaluate(() => document.querySelector('link[rel=icon]').href);
  check(stale.length === 0 && staleFav.length === 0 && favNow === iconData.THEMES.regular.favicon,
        'every theme\'s icons and favicon match its Chomper sprite (else: node tests/make-icons.js)' + (stale.length + staleFav.length ? ' stale: ' + [...stale.map(x => x.file), ...staleFav] : ''));

  await L.context.setOffline(true);
  await p.reload();
  await p.waitForTimeout(300);
  const offline = await p.evaluate(() => typeof Chompers === 'object' && Chompers.Engine.state.screen);
  await L.context.setOffline(false);
  check(offline === 'title', 'offline: a reload still starts the game from the cache');
  await L.context.close();

  // the Jr game over http: its own manifest, icons and offline cache
  const J = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const jp = await J.newPage();
  jp.on('pageerror', e => mobileErrors.push('jr: ' + e.message));
  jp.on('console', m => m.type() === 'error' && mobileErrors.push('jr: ' + m.text()));
  await jp.goto(HTTP + '?game=jr'); await jp.waitForTimeout(250);
  const jpwa = await jp.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 5000))]);
    const link = document.querySelector('link[rel=manifest]');
    const man = await (await fetch(link.href)).json();
    const v = Chompers.CONFIG.version, keys = await caches.keys();
    const cached = keys.includes('chompersjr-' + v) ? (await (await caches.open('chompersjr-' + v)).keys()).map(r => new URL(r.url).pathname).sort() : [];
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); i.src = src; });
    return { href: link.getAttribute('href'), man, keys, cached, script: reg && reg.active && reg.active.scriptURL,
             iconW: await Promise.all(man.icons.map(i => load(new URL(i.src, link.href).href))),
             palette: Chompers.CONFIG.theme.palette, touchIcon: document.querySelector('link[rel=apple-touch-icon]').getAttribute('href') };
  });
  check(jpwa.href === 'manifest-jr.json' && jpwa.man.name === 'Chompers Jr' && jpwa.man.short_name === 'Chompers Jr'
        && jpwa.man.start_url.includes('game=jr') && jpwa.man.theme_color === jpwa.palette.panel && jpwa.man.background_color === jpwa.palette.bg
        && jpwa.iconW.join() === '192,512,192,512' && jpwa.man.icons.every(i => i.src.includes('chompersjr-')) && jpwa.touchIcon.includes('chompersjr-192'),
        'jr: its own manifest (name, start_url ?game=jr, palette colours) and icons');
  check(jpwa.script && jpwa.script.includes('cache=chompersjr') && jpwa.script.includes('manifest=manifest-jr.json')
        && ['/chompers.html', '/icons/chompersjr-192.png', '/icons/chompersjr-512.png', '/manifest-jr.json'].every(f => jpwa.cached.includes(f))
        && !jpwa.cached.some(f => f.includes('/icons/chompers-')),
        `jr: service worker caches the Jr files in "chompersjr-${'<version>'}"`);
  await J.setOffline(true);
  await jp.reload(); await jp.waitForTimeout(300);
  const jOffline = await jp.evaluate(() => typeof Chompers === 'object' && Chompers.CONFIG.game + '/' + document.title);
  await J.setOffline(false);
  check(jOffline === 'jr/Chompers Jr', 'jr: offline reload still starts Chompers Jr');
  await J.close();

  // ---- portrait phone ----
  const Pt = await phone({ width: 390, height: 844 });
  const q = Pt.p;
  const pInfo = await q.evaluate(() => Chompers.Input.layoutInfo());
  const hintShown = (await rectOf(q, '#rotate')).shown;
  const titleBtns = [await rectOf(q, '#btn-touchMode'), await rectOf(q, '#btn-sound')];
  await q.screenshot({ path: path.join(OUT, '18-phone-portrait-title.png') });
  await q.evaluate(() => Chompers.Engine.debug.gotoLevel(1));
  await q.waitForTimeout(80);
  const qCanvas = await rectOf(q, '#screen'), qEat = await rectOf(q, '#btn-eat'), qPause = await rectOf(q, '#btn-pause');
  const belowAll = [qEat, qPause, ...titleBtns].every(b => b.y >= qCanvas.y + qCanvas.h && b.y + b.h <= 844);
  check(pInfo.kind === 'bottom' && Number.isInteger(pInfo.scale) && belowAll && !overlaps(qEat, qPause),
        'portrait: buttons (and title toggles) sit below the canvas, inside the screen');
  await q.screenshot({ path: path.join(OUT, '19-phone-portrait-play.png') });
  await q.tap('#rotate');
  const hintGone = !(await rectOf(q, '#rotate')).shown;
  check(hintShown && hintGone, 'portrait: "rotate for best play" hint shows, and a tap dismisses it');
  await Pt.context.close();
  const Pt2 = await phone({ width: 390, height: 844 });
  const h0 = (await rectOf(Pt2.p, '#rotate')).shown;
  await Pt2.p.waitForTimeout(cfg.rotateHintMs + 300);
  const h1 = (await rectOf(Pt2.p, '#rotate')).shown;
  check(h0 && !h1, `portrait hint disappears by itself after ${cfg.rotateHintMs / 1000} s`);
  await Pt2.context.close();

  // ---- tablet (landscape, roomy): whatever layout wins, buttons stay off the canvas ----
  const Tb = await phone({ width: 1024, height: 768 });
  await Tb.p.evaluate(() => Chompers.Engine.debug.gotoLevel(1));
  await Tb.p.waitForTimeout(80);
  const tInfo = await Tb.p.evaluate(() => Chompers.Input.layoutInfo());
  const tCanvas = await rectOf(Tb.p, '#screen'), tEat = await rectOf(Tb.p, '#btn-eat'), tPause = await rectOf(Tb.p, '#btn-pause');
  check(!overlaps(tEat, tCanvas) && !overlaps(tPause, tCanvas) && tInfo.scale >= 2,
        `tablet 1024x768: ${tInfo.kind} layout at x${tInfo.scale}, buttons off the canvas`);
  await Tb.context.close();
  server.close();
  }

  check(mobileErrors.length === 0, 'touch/PWA pages: no page or console errors' + (mobileErrors.length ? ': ' + mobileErrors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
