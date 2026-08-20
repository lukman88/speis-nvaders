// Focused check: one life per hit via the REAL overlap path, 3 hits = game over
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8000', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  // hold ~120ms: a down+up within one frame can be missed by JustDown
  await page.keyboard.down('Enter'); await page.waitForTimeout(120); await page.keyboard.up('Enter');
  await page.waitForTimeout(500);

  // Two enemy bullets dropped on the player in the same frame:
  // first hit drains a life, second must be swallowed by the invincibility gate.
  await page.evaluate(() => {
    const s = game.scene.keys.MainScene;
    s.enemyBullets.create(s.player.x, s.player.y);
    s.enemyBullets.create(s.player.x, s.player.y);
  });
  await page.waitForTimeout(300);
  const t1 = await page.evaluate(() => { const s = game.scene.keys.MainScene; return { lives: s.lives, hud: s.hudText.text, state: s.gameState }; });

  // wait past 1500ms invincibility, then one more bullet
  await page.waitForTimeout(1600);
  await page.evaluate(() => { const s = game.scene.keys.MainScene; s.enemyBullets.create(s.player.x, s.player.y); });
  await page.waitForTimeout(300);
  const t2 = await page.evaluate(() => { const s = game.scene.keys.MainScene; return { lives: s.lives, hud: s.hudText.text, state: s.gameState }; });

  // third bullet -> game over; then a fourth must not drain below 0
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const s = game.scene.keys.MainScene;
    s.enemyBullets.create(s.player.x, s.player.y);
    s.enemyBullets.create(s.player.x, s.player.y);
  });
  await page.waitForTimeout(300);
  const t3 = await page.evaluate(() => { const s = game.scene.keys.MainScene; return { lives: s.lives, state: s.gameState, hud: s.hudText.text }; });

  // restart resets to 3
  await page.keyboard.down('KeyR'); await page.waitForTimeout(100); await page.keyboard.up('KeyR');
  await page.waitForTimeout(500);
  await page.keyboard.down('Enter'); await page.waitForTimeout(120); await page.keyboard.up('Enter'); // restart lands on the title screen
  await page.waitForTimeout(500);
  const t4 = await page.evaluate(() => { const s = game.scene.keys.MainScene; return { lives: s.lives, state: s.gameState, wave: s.waveCounter, score: s.score }; });

  console.log(JSON.stringify({ t1, t2, t3, t4, pageErrors: errors }, null, 1));
  await browser.close();
})();
