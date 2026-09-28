// boss_check.js — headless boss verification: force a boss wave, detach a part
// (assert hazard), kill the core (assert wave ends + next wave normal), confirm
// ≥2 distinct appearances and that all four attack types fire.
// Run: node test/boss_check.js   (requires server on :8000, override with PORT env)
const path = require('path');
const { chromium } = require('playwright-core');
const shot = (name) => path.join(__dirname, name);

let pass = 0, fail = 0;
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log(`${label.padEnd(22)} : PASS`); }
  else { fail++; console.log(`${label.padEnd(22)} : FAIL ${extra ? '(' + extra + ')' : ''}`); }
};

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const logs = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack || e.message}`));

  const port = process.env.PORT || 8000;
  await page.goto(`http://localhost:${port}`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.keyboard.down('Enter'); await page.waitForTimeout(120); await page.keyboard.up('Enter');
  await page.waitForTimeout(600);

  const snap = () => page.evaluate(() => {
    const s = game.scene.keys.MainScene;
    return {
      state: s.gameState,
      wave: s.waveCounter,
      isBossWave: s.isBossWave,
      hasBoss: !!s.boss,
      bossAlive: s.boss ? s.boss.alive : false,
      bossMembers: s.bossGroup.countActive(true),
      hazards: s.bossHazards.countActive(true),
      invaders: s.invaderGroup.countActive(true),
      score: s.score,
      attacks: s.boss ? { ...s.boss.attacksFired } : null,
      lastMove: s.boss ? s.boss.lastMove : null,
    };
  });

  // 1. Force a boss wave (wave 3 = first boss). Player is protected so its own
  //    bullets/dives can't drain lives and end the fight mid-check.
  await page.evaluate(() => {
    const s = game.scene.keys.MainScene;
    if (s.gameState === 'playing') {
      s.invaderGroup.clear(true);
      s.lives = 99;
      s.invincibleUntil = 1e9;
      s.waveCounter = 3;
      s.beginWave();
    }
  });
  await page.waitForTimeout(300);
  const t0 = await snap();
  await page.screenshot({ path: shot('boss_t0.png') });
  check('boss spawned', t0.hasBoss && t0.bossAlive, `hasBoss=${t0.hasBoss} alive=${t0.bossAlive}`);
  check('boss + 5 parts', t0.bossMembers === 6, `members=${t0.bossMembers}`);
  check('no formation on boss wave', t0.isBossWave === true && t0.invaders === 0, `isBossWave=${t0.isBossWave} invaders=${t0.invaders}`);

  // 2. Shoot a part off (6 hits drains a part's hp 6) -> part gone + a hazard drops
  await page.evaluate(() => {
    const s = game.scene.keys.MainScene;
    if (s.boss) {
      const part = s.boss.parts[0];
      for (let i = 0; i < 6; i++) s.boss.hitBullet(part);
    }
  });
  await page.waitForTimeout(120);
  const t1 = await snap();
  check('part detached', t1.hasBoss && t1.bossMembers === 5, `members=${t1.bossMembers}`);
  check('hazard spawned', t1.hazards === 1, `hazards=${t1.hazards}`);

  // 3. All four attack types fire (deterministic cycle, ~850ms each). Open the gate
  //    and run ~4.5s so straight -> arc -> burst -> dive all trigger.
  await page.evaluate(() => { const s = game.scene.keys.MainScene; if (s.boss) { s.boss.lastAttack = 0; s.invincibleUntil = 1e9; s.lives = 99; } });
  await page.waitForTimeout(4500);
  const t2 = await snap();
  const a = t2.attacks || {};
  check('all 4 attacks fired', a.straight > 0 && a.arc > 0 && a.burst > 0 && a.dive > 0, JSON.stringify(a));
  check('boss moved (drift/dash)', t2.lastMove === 'drift' || t2.lastMove === 'dash', `lastMove=${t2.lastMove}`);
  await page.screenshot({ path: shot('boss_t1.png') });

  // 4. Kill the core -> fight ends, wave advances to a normal formation (wave 4)
  await page.evaluate(() => {
    const s = game.scene.keys.MainScene;
    if (s.boss) {
      let guard = 0;
      while (s.boss && s.boss.alive && guard++ < 200) s.boss.hitBullet(s.boss.core);
    }
  });
  await page.waitForTimeout(300);
  const t3 = await snap();
  check('core death ends fight', t3.hasBoss === false && t3.bossAlive === false, `hasBoss=${t3.hasBoss} alive=${t3.bossAlive}`);
  check('fight -> stage clear', t3.state === 'stageclear', `state=${t3.state}`);

  // 5. Advance: the next wave (4) must be a normal formation, not a boss
  await page.keyboard.down('Space'); await page.waitForTimeout(60); await page.keyboard.up('Space');
  await page.waitForTimeout(1200); // fly-through
  await page.keyboard.down('Space'); await page.waitForTimeout(60); await page.keyboard.up('Space');
  await page.waitForTimeout(500);
  const t4 = await snap();
  check('next wave is normal', t4.wave === 4 && t4.isBossWave === false && t4.invaders === 40, `wave=${t4.wave} isBossWave=${t4.isBossWave} invaders=${t4.invaders}`);

  // 6. ≥2 distinct appearances (wave 3 = index 0, wave 6 = index 1): tint + layout differ
  const ap = await page.evaluate(() => {
    const differTint = BOSS_APPEARANCES[0].core !== BOSS_APPEARANCES[1].core && BOSS_APPEARANCES[0].part !== BOSS_APPEARANCES[1].part;
    const differLayout = JSON.stringify(BOSS_LAYOUTS[0]) !== JSON.stringify(BOSS_LAYOUTS[1]);
    return { differTint, differLayout };
  });
  check('appearances differ', ap.differTint && ap.differLayout, JSON.stringify(ap));

  const pageErrors = logs.filter(l => l.startsWith('[pageerror]')).length;
  check('no page errors', pageErrors === 0, `errors=${pageErrors}`);

  console.log('--- console/crash logs ---');
  console.log(logs.length ? logs.join('\n') : '(none)');
  console.log('--- state ---');
  console.log('boss wave  :', JSON.stringify(t0));
  console.log('part detach:', JSON.stringify(t1));
  console.log('attacks    :', JSON.stringify(t2));
  console.log('core death :', JSON.stringify(t3));
  console.log('next wave  :', JSON.stringify(t4));
  console.log('--- summary ---');
  console.log(`${pass} passed, ${fail} failed`);

  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
