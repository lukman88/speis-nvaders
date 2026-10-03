// zoom_repro.js — measure canvas backing store vs CSS box through the fullscreen cycle
const path = require('path');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto('http://localhost:8000', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const measure = async (label) => {
    const m = await page.evaluate(() => {
      const canvas = document.querySelector('#game-container canvas');
      const cont = document.getElementById('game-container');
      const cr = canvas.getBoundingClientRect();
      const kr = cont.getBoundingClientRect();
      return {
        canvasPx: [canvas.width, canvas.height],
        canvasCss: [Math.round(cr.width), Math.round(cr.height)],
        containerCss: [Math.round(kr.width), Math.round(kr.height)],
        fullscreen: document.fullscreenElement ? document.fullscreenElement.id : null,
        dpr: window.devicePixelRatio,
        canvasStyle: [canvas.style.width, canvas.style.height],
      };
    });
    const zx = m.canvasCss[0] / m.canvasPx[0];
    const zy = m.canvasCss[1] / m.canvasPx[1];
    const fits = m.canvasCss[0] <= m.containerCss[0] + 2 && m.canvasCss[1] <= m.containerCss[1] + 2;
    console.log(`${label}: canvasPx=${m.canvasPx} canvasCss=${m.canvasCss} container=${m.containerCss} fs=${m.fullscreen} zoom=${zx.toFixed(2)}x${zy.toFixed(2)} fits=${fits}`);
  };

  await measure('title');
  await page.keyboard.down('Enter'); await page.waitForTimeout(120); await page.keyboard.up('Enter');
  await page.waitForTimeout(1000);
  await measure('after start (desktop: no auto-fullscreen)');
  const btn = await page.evaluate(() => {
    const b = document.getElementById('fs-btn');
    const r = b.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  await page.mouse.click(btn[0], btn[1]);
  await page.waitForTimeout(1000);
  await measure('after fs-btn (entered fullscreen)');
  await page.evaluate(() => { try { document.exitFullscreen(); } catch (e) {} });
  await page.waitForTimeout(1000);
  await measure('after exit');
  await browser.close();
})();
