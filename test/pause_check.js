// pause_check.js — logo animation + Esc pause menu: freeze, sound toggle, resume, quit to title
const path = require('path');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8000', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // logo animates on the title screen (500ms per frame)
  const f1 = await page.evaluate(() => game.scene.keys.MainScene.logoFrame);
  await page.waitForTimeout(600);
  const f2 = await page.evaluate(() => game.scene.keys.MainScene.logoFrame);

  // start game, let invaders march a bit, then pause
  await page.keyboard.down('Enter'); await page.waitForTimeout(120); await page.keyboard.up('Enter');
  await page.waitForTimeout(1500);
  const esc = async () => { await page.keyboard.down('Escape'); await page.waitForTimeout(120); await page.keyboard.up('Escape'); };
  await esc();
  await page.waitForTimeout(200);
  const p1 = await page.evaluate(() => {
    const s = game.scene.keys.MainScene;
    return { state: s.gameState, invX: Math.round(s.invaderGroup.getChildren()[0].x), muted: sfx.isMuted() };
  });
  await page.screenshot({ path: path.join(__dirname, 'pause_check.png') });

  // while paused, the invader march must be frozen
  await page.waitForTimeout(1000);
  const p2 = await page.evaluate(() => {
    const s = game.scene.keys.MainScene;
    return { state: s.gameState, invX: Math.round(s.invaderGroup.getChildren()[0].x) };
  });

  // toggle sound off via the button (scene (400,350) + canvas offset (50,50))
  await page.mouse.click(450, 400);
  await page.waitForTimeout(100);
  const p3 = await page.evaluate(() => sfx.isMuted());
  // ...and back on
  await page.mouse.click(450, 400);
  await page.waitForTimeout(100);
  const p4 = await page.evaluate(() => sfx.isMuted());

  // resume with Esc
  await esc();
  await page.waitForTimeout(200);
  const p5 = await page.evaluate(() => ({ state: game.scene.keys.MainScene.gameState }));

  // pause again and QUIT TO TITLE (scene (400,430) + offset)
  await esc();
  await page.waitForTimeout(200);
  await page.mouse.click(450, 480);
  await page.waitForTimeout(400);
  const p6 = await page.evaluate(() => ({ state: game.scene.keys.MainScene.gameState }));

  console.log(JSON.stringify({
    logoAnimated: f1 !== f2,
    paused: p1.state === 'paused',
    frozenWhilePaused: p1.invX === p2.invX && p2.state === 'paused',
    soundToggledOff: p3 === true,
    soundToggledBack: p4 === false,
    resumed: p5.state === 'playing',
    quitToTitle: p6.state === 'title',
    pageErrors: errors,
  }, null, 1));
  await browser.close();
})();
