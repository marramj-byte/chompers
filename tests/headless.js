// Headless smoke test for chompers.html.
// Run: node tests/headless.js   (needs Playwright + Chromium available to require('playwright'))
// Screenshots are written to tests/out/ (gitignored).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 980, height: 660 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });
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

  await page.goto('file://' + path.join(ROOT, 'chompers.html'));
  await page.waitForTimeout(300);
  await shot('1-title');
  check((await S()).screen === 'title', 'starts on title screen');

  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  await shot('2-board');
  check((await S()).screen === 'playing', 'Space starts the game');

  await goTo(false); await page.keyboard.press('Space'); await page.waitForTimeout(200);
  await shot('3-wrong');
  await page.waitForTimeout(1500);
  let st = await S();
  check(st.lives === 2 && st.screen === 'playing', 'wrong eat costs a life');

  await goTo(true); await page.keyboard.press('Space'); await page.waitForTimeout(100);
  check((await S()).score > 0, 'correct eat scores');
  while (await goTo(true) !== null) { await page.keyboard.press('Space'); await page.waitForTimeout(20); }
  await page.waitForTimeout(200);
  await shot('4-clear');
  check((await S()).screen === 'levelclear', 'clearing all correct cells shows level clear');
  await page.waitForTimeout(2000);
  st = await S();
  check(st.screen === 'playing' && st.level === 2, 'advances to level 2');

  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  await shot('5-pause');
  check((await S()).screen === 'paused', 'Esc pauses');
  await page.keyboard.press('Escape');
  check((await S()).screen === 'playing', 'Esc resumes');

  for (let k = 0; k < 3; k++) { await goTo(false); await page.keyboard.press('Space'); await page.waitForTimeout(1600); }
  check((await S()).screen === 'gameover', 'losing all lives ends the game');
  await page.waitForTimeout(800);
  await shot('6-gameover');
  await page.keyboard.press('Space'); await page.waitForTimeout(100);
  check((await S()).screen === 'title', 'Space returns to title');

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
