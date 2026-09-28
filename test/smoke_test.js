// smoke_test.js — headless smoke test: load game, capture console, verify input + spawning
// Run: node test/smoke_test.js   (requires server on :8000, override with PORT env)
const path = require('path');
const { chromium } = require('playwright-core');
const shot = (name) => path.join(__dirname, name); // screenshots land next to this script

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });

  const logs = [];
  page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack || e.message}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

  const port = process.env.PORT || 8000;
  await page.goto(`http://localhost:${port}`, { waitUntil: 'load' });
  await page.waitForTimeout(2000); // let a few frames tick
  // hold ~120ms: a down+up within one frame can be missed by JustDown
  await page.keyboard.down('Enter'); await page.waitForTimeout(120); await page.keyboard.up('Enter');
  await page.waitForTimeout(500);

  const snap = () =>
    page.evaluate(() => {
      const s = game.scene.keys.MainScene;
      return {
        playerX: Math.round(s.player.x),
        invaders: s.invaderGroup.countActive(true),
        score: s.score,
        lives: s.lives,
        wave: s.waveCounter,
        state: s.gameState,
        enemyBullets: s.enemyBullets.countActive(true),
        playerBullets: s.playerBullets.countActive(true),
        bulletY: (() => { const ys = s.playerBullets.getChildren().filter(b => b.active).map(b => b.y); return ys.length ? Math.min(...ys) : null; })(),
      };
    });

  const t0 = await snap();
  await page.screenshot({ path: shot('smoke_t0.png') });

  // Hold ArrowLeft for ~1s — player should move
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(1000);
  await page.keyboard.up('ArrowLeft');
  const t1 = await snap();

  // Fire a bullet (JustDown needs the key held at least one frame)
  await page.keyboard.down('Space');
  await page.waitForTimeout(50);
  await page.keyboard.up('Space');
  await page.waitForTimeout(150);
  const t2 = await snap();

  // Stage clear (run now, while state is guaranteed 'playing'): ship flies off trailing fire,
  // Space during the fly-through is ignored, then Space starts the next stage.
  await page.evaluate(() => { const s = game.scene.keys.MainScene; if (s.gameState === 'playing') s.showStageClear(); });
  await page.waitForTimeout(300);
  const sc0 = await snap();
  await page.screenshot({ path: shot('smoke_fly.png') }); // mid fly-through: ship + fire trail
  await page.keyboard.down('Space');
  await page.waitForTimeout(50);
  await page.keyboard.up('Space');
  await page.waitForTimeout(300);
  const scIgnored = await snap(); // still flying, advance must be blocked
  await page.waitForTimeout(1200); // fly-through (~900ms) finishes, message appears
  await page.screenshot({ path: shot('smoke_clear.png') });
  await page.keyboard.down('Space');
  await page.waitForTimeout(50);
  await page.keyboard.up('Space');
  await page.waitForTimeout(300);
  const sc1 = await snap();

  // Last-survivor dive: once the only invader breaks off to dive, the shooter
  // filter is empty (old bug: attemptShoot() on undefined froze the loop), and when
  // the diver exits the arc off-screen it must trigger the stage clear (not a bullet)
  await page.evaluate(() => {
    const s = game.scene.keys.MainScene;
    if (s.gameState === 'playing') {
      const kids = s.invaderGroup.getChildren().slice(); // live array: destroy() splices it mid-loop
      for (let i = 0; i < kids.length - 1; i++) while (kids[i].isAlive) kids[i].takeDamage(); // tiers: top rows take 2-3 hits
      s.tweens.killTweensOf(kids); s.stageIntro = false; // skip the intro swoop
      s.playerBullets.clear(true); // the advance-Space fired a bullet that would shoot the last invader
      // Start the lone survivor's dive by hand and park the ship where it will miss,
      // so the diver stays alive while the fire gate is open (the crash window)
      s.lastDiveTime = 999999; // suppress the random dive
      const last = s.invaderGroup.getChildren()[0];
      last.setPosition(400, 200); // ring spawn points are off-screen; the off-screen sweep would kill it
      last.diveAt(400, 550);
      s.player.setPosition(50, 550);
      s.lastEnemyShotTime = s.time.now - 2000; // open the fire gate immediately
      s.lives = 3;
    }
  });
  await page.waitForTimeout(3000); // full 1.2s dive flight, off-screen death, clear must follow
  const t5 = await snap();
  const diveErrors = logs.filter(l => l.startsWith('[pageerror]')).length;
  console.log('dive no freeze :', (diveErrors === 0) ? 'PASS' : `FAIL (errors=${diveErrors})`);
  console.log('offscreen clear:', (t5.state === 'stageclear' && t5.invaders === 0) ? 'PASS' : `FAIL (state=${t5.state} invaders=${t5.invaders})`);

  // Let it run: formation march + enemy fire + collisions
  await page.waitForTimeout(15000);
  const t3 = await snap();
  await page.screenshot({ path: shot('smoke_t4.png') });

  console.log('--- console/crash logs ---');
  console.log(logs.length ? logs.join('\n') : '(none)');
  console.log('--- state ---');
  console.log('after load   :', JSON.stringify(t0));
  console.log('after 1s left:', JSON.stringify(t1));
  console.log('after space  :', JSON.stringify(t2));
  console.log('after 5s run :', JSON.stringify(t3));
  console.log('stage clear  :', JSON.stringify(sc0));
  console.log('after space  :', JSON.stringify(sc1));
  console.log('--- checks ---');
  console.log('moved left    :', t1.playerX < t0.playerX ? 'PASS' : 'FAIL');
  // bullet either still in flight or already hit an invader (score up)
  console.log('space fired   :', (t2.playerBullets >= 1 || t2.score > t1.score) ? 'PASS' : 'FAIL');
  console.log('invaders alive:', t0.invaders === 40 ? 'PASS' : `FAIL (${t0.invaders})`);
  console.log('game running  :', t0.state === 'playing' ? 'PASS' : 'FAIL');
  console.log('break screen  :', sc0.state === 'stageclear' ? 'PASS' : `FAIL (${sc0.state})`);
  console.log('flythru holds :', (scIgnored.state === 'stageclear' && scIgnored.wave === sc0.wave) ? 'PASS' : `FAIL (state=${scIgnored.state} wave=${scIgnored.wave})`);
  console.log('space starts  :', (sc1.state === 'playing' && sc1.wave > sc0.wave) ? 'PASS' : `FAIL (state=${sc1.state} wave ${sc0.wave}->${sc1.wave})`);

  // Restart: the last-dive section ends on the stage-clear screen (R is dead there),
  // so advance to a wave first if needed, then force game-over if the AFK player survived
  await page.evaluate(() => { const s = game.scene.keys.MainScene; if (s.gameState === 'stageclear' && s.stageClearReady) s.nextWave(); });
  await page.waitForTimeout(2000); // let the new wave's intro finish so the forced game-over freezes it mid-play
  await page.evaluate(() => { const s = game.scene.keys.MainScene; if (s.gameState === 'playing') s.gameOver(); });
  await page.keyboard.down('KeyR');
  await page.waitForTimeout(120);
  await page.keyboard.up('KeyR');
  await page.waitForTimeout(1000);
  await page.keyboard.down('Enter'); await page.waitForTimeout(120); await page.keyboard.up('Enter'); // restart lands on the title screen
  await page.waitForTimeout(500);
  const t4 = await snap();
  console.log('after restart:', JSON.stringify(t4));
  console.log('restart fresh :', (t4.state === 'playing' && t4.score === 0 && t4.lives === 3 && t4.wave === 1 && t4.invaders === 40) ? 'PASS' : 'FAIL');

  await browser.close();
})();
