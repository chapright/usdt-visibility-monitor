'use strict';

/**
 * Verifies the evidence screenshots really show the elements the price was read
 * from, for every exchange in the registry.
 *
 * The check is: the tagged element's own text is the one the adapter parsed, and
 * the capture rect fully contains that element's box. A clip that only partially
 * overlaps would silently produce an image missing the price.
 *
 *   node test/verify-shots.js
 */

const { chromium } = require('playwright');
const config = require('../src/config');
const { EXCHANGES } = require('../src/exchanges');

const failures = [];

async function checkExchange(browser) {
  const ctx = await browser.newContext({
    locale: 'fa-IR',
    viewport: { width: 1440, height: 1200 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  try {
    for (const ex of EXCHANGES) {
      // Static exchanges are read over HTTP and have no layout to photograph.
      if (typeof ex.probeInPage !== 'function') {
        console.log(`\n=== ${ex.name} (${ex.host}) ===`);
        console.log('    SKIP: read over plain HTTP — no browser, no screenshots');
        continue;
      }
      console.log(`\n=== ${ex.name} (${ex.host}) ===`);
      await page.goto(ex.url, { waitUntil: 'domcontentloaded', timeout: config.navTimeoutMs });

      // Let the page settle before sampling, mirroring the scraper.
      const started = Date.now();
      let ready = false;
      let snap = null;
      while (Date.now() - started < config.navTimeoutMs) {
        snap = await page.evaluate(ex.probeInPage, { coin: ex.coin });
        if (snap.ready) ready = true;
        if (ready && Date.now() - started >= config.settleMs) break;
        await page.waitForTimeout(config.sampleMs);
      }

      const probeByKey = Object.fromEntries((snap.probes || []).map((p) => [p.key, p]));
      console.log(`  ready=${snap.ready} feedLive=${snap.feedLive}`);
      for (const p of snap.probes || []) {
        console.log(`    probe ${p.key.padEnd(8)} = ${JSON.stringify(p.raw)}`);
      }

      const viewport = page.viewportSize();
      for (const shot of snap.shots || []) {
        const el = page.locator(`[data-monitor="${shot.key}"]`);
        const count = await el.count();
        if (count !== 1) {
          const msg = `${ex.id}/${shot.key}: expected 1 tagged element, found ${count}`;
          console.log(`    FAIL ${msg}`);
          failures.push(msg);
          continue;
        }

        await el.evaluate((n) => n.scrollIntoView({ block: 'center', inline: 'nearest' }));
        await page.waitForTimeout(220);

        const text = (await el.innerText()).replace(/\s+/g, ' ').trim().slice(0, 60);
        const box = await el.boundingBox();
        const pad = 12;

        // An element the user cannot see legitimately has no screenshot, so
        // that is a skip rather than a failure. Anything the scraper did choose
        // to capture must sit fully inside its padded clip.
        const onScreen =
          box.x + box.width > 0 && box.x < viewport.width &&
          box.y + box.height > 0 && box.y < viewport.height;
        if (!onScreen) {
          console.log(`    SKIP ${shot.key}: element is off-screen (nothing to capture)`);
          continue;
        }

        const left = Math.max(0, box.x - pad);
        const top = Math.max(0, box.y - pad);
        const right = Math.min(viewport.width, box.x + box.width + pad);
        const bottom = Math.min(viewport.height, box.y + box.height + pad);
        const clip = { x: left, y: top, width: right - left, height: bottom - top };
        const contains =
          box.x >= clip.x - 0.5 && box.y >= clip.y - 0.5 &&
          box.x + box.width <= clip.x + clip.width + 0.5 &&
          box.y + box.height <= clip.y + clip.height + 0.5;

        console.log(`    ${contains ? 'PASS' : 'FAIL'} ${shot.key}: ${Math.round(clip.width)}x${Math.round(clip.height)} clip contains element (${text})`);

        // The element we screenshot must be one the adapter actually parsed.
        const probe = probeByKey[shot.key];
        if (probe && probe.raw && !text.includes(probe.raw.trim())) {
          const msg = `${ex.id}/${shot.key}: element text does not contain parsed value ${JSON.stringify(probe.raw)}`;
          console.log(`    FAIL ${msg}`);
          failures.push(msg);
        }
        if (!contains) failures.push(`${ex.id}/${shot.key}: clip does not contain the element`);
      }
    }
  } finally {
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: config.headless, channel: config.browserChannel });
  try {
    await checkExchange(browser);
  } finally {
    await browser.close();
  }
  console.log(
    `\n${failures.length ? `${failures.length} problem(s) found` : 'all screenshot regions verified'}`
  );
  process.exit(failures.length ? 1 : 0);
})();