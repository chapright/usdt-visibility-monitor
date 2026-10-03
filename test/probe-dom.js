'use strict';

/**
 * Browser-level test for the DOM probes, run against a local fixture rather
 * than the live site. Guards the parsing rules that have already caused real
 * bugs: value leaves carrying a unit suffix, prices buried in prose, decoy
 * numbers that must never be read, and the `data-probe` tags the shared
 * visibility check depends on.
 *
 *   node test/probe-dom.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const checks = [];
function assert(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push(pass);
  console.log(
    `  ${pass ? 'PASS' : 'FAIL'}  ${name} -> ${JSON.stringify(actual)}${
      pass ? '' : ` (expected ${JSON.stringify(expected)})`
    }`
  );
}

/** A tabdeal-shaped page including every decoy we have to ignore. */
function tabdealHtml(o = {}) {
  const v = {
    headline: '265,460', approx: '265,460', lastTrade: '265,460', seo: '265,460',
    dollar: '1', change: '+2.73% %', volume: '3,988,749.0734',
    high: '266,500', low: '254,000', hiddenGain: '+40.44% %',
    ...o,
  };
  return `<!doctype html><html lang="fa" dir="rtl"><body>
<div class="market-selection-card" style="visibility:hidden">
  <div>${v.hiddenGain}</div>
</div>

<div class="flex flex-col items-stretch w-full gap-1 rounded-lg p-4">
  <div class="flex justify-between items-center">
    <span>آخرین قیمت تتر</span><span> (به‌روزرسانی هر ۳۰ ثانیه) </span>
  </div>
  <div class="flex items-center gap-2 mt-2">
    <span>${v.dollar}</span><span>$</span>
  </div>
  <div class="flex flex-row-reverse items-center justify-between">
    <span dir="ltr">${v.change}</span>
    <div class="flex items-center gap-x-1">
      <span>${v.headline}</span><span> تومان </span>
    </div>
  </div>
</div>

<div class="w-full flex items-center justify-start my-6">
  <button type="button">swap</button>
  <div class="mr-2">
    <p>قیمت تقریبی</p>
    <p dir="ltr">1 USDT = ${v.approx} IRT</p>
  </div>
</div>

<div class="grid">
  <div><p>قیمت آخرین معامله</p><span dir="ltr">${v.lastTrade} تومان</span></div>
  <div><p>بالاترین قیمت ۲۴ ساعت گذشته</p><span dir="ltr">${v.high} تومان</span></div>
  <div><p>پایین‌ترین قیمت ۲۴ ساعت گذشته</p><span dir="ltr">${v.low} تومان</span></div>
  <div><p>حجم ۲۴ ساعته (تتر)</p><span dir="ltr">${v.volume} تتر</span></div>
</div>

<div class="market-chart">
  <svg><text x="10" y="20">258,000</text><text x="10" y="40">260,000</text>
  <text x="10" y="60">262,000</text><text x="10" y="80">264,000</text>
  <text x="10" y="100">266,000</text></svg>
</div>

<p class="seo">هم اکنون قیمت لحظه‌ای تتر ${v.seo} تومان، معادل 1 دلار آمریکا است.</p>
</body></html>`;
}

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(tabdealHtml());
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ locale: 'fa-IR', viewport: { width: 1440, height: 1200 } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  const tabdeal = require('../src/exchanges/tabdeal');
  const out = await page.evaluate(tabdeal.probeInPage, { coin: tabdeal.coin });
  const byKey = Object.fromEntries(out.probes.map((p) => [p.key, p.raw]));

  console.log('\n=== tabdeal probe ===');
  assert('ready', out.ready, true);
  assert('headline', byKey.headline, '265,460');
  assert('approx', byKey.approx, '265,460');
  // Value leaf is "265,460 تومان" — a unit suffix must not break extraction.
  assert('lastTrade', byKey.lastTrade, '265,460');
  // Price is embedded in prose.
  assert('seoText', byKey.seoText, '265,460');

  console.log('\n=== decoys must not be read ===');
  const all = Object.values(byKey);
  assert('never reads the static dollar "1"', all.includes('1'), false);
  assert('never reads a chart axis tick', all.includes('258,000'), false);
  assert('never reads a 24h high', all.includes('266,500'), false);
  assert('never reads a 24h low', all.includes('254,000'), false);
  assert('never reads a decimal volume', all.includes('3,988,749.0734'), false);
  assert('never reads the hidden gainers %', all.some((v) => String(v).includes('40.44')), false);

  console.log('\n=== data-probe tags (the visibility check reads these) ===');
  const tagged = await page.evaluate(() =>
    Object.fromEntries(
      ['headline', 'approx', 'lastTrade', 'seoText'].map((k) => [
        k, document.querySelectorAll(`[data-probe="${k}"]`).length,
      ])
    )
  );
  assert('headline tagged', tagged.headline >= 1, true);
  assert('approx tagged', tagged.approx >= 1, true);
  assert('lastTrade tagged', tagged.lastTrade >= 1, true);
  assert('seoText tagged', tagged.seoText >= 1, true);

  /* ---------- abantether: a blurred price is not a displayed price ---------- */

  // Digits are plain text in the DOM, split one <span> per character, behind a
  // CSS blur and a "log in" prompt. The text scrape must still find the value,
  // but visibility must call it obscured.
  const blurredPage = `<!doctype html><html lang="fa" dir="rtl"><body>
<div class="flex items-center gap-1">
  <span class="group relative inline-flex">
    <button type="button" aria-label="جهت مشاهده قیمت لحظه‌ای تتر وارد حساب کاربری خود شوید">
      <div class="pointer-events-none select-none" style="filter:blur(6px)">
        <div class="inline-flex items-center gap-1">
          <span>IRT</span>
          <span class="tabular-nums">
            <span>۲</span><span>۶</span><span>۷</span><span>,</span><span>۰</span><span>۵</span><span>۰</span>
          </span>
        </div>
      </div>
    </button>
  </span>
  <span>≈</span>
</div>
</body></html>`;

  // Same markup, but the blur is gone -> the price is readable -> a violation.
  const unblurredPage = blurredPage.replace(' style="filter:blur(6px)"', '');

  const abantether = require('../src/exchanges/abantether');
  const { buildReport } = require('../src/diagnose');

  async function readAbantether(html) {
    const p2 = await browser.newPage({ locale: 'fa-IR', viewport: { width: 1440, height: 1200 } });
    await p2.setContent(html, { waitUntil: 'domcontentloaded' });
    const snap = await p2.evaluate(abantether.probeInPage, { coin: abantether.coin });
    const selectors = {};
    for (const pr of snap.probes) selectors[pr.key] = `[data-probe="${pr.key}"]`;
    const { probeVisibility } = require('../src/visibility');
    const vis = await p2.evaluate(probeVisibility, { selectors });
    await p2.close();
    const probes = {};
    for (const pr of snap.probes) {
      probes[pr.key] = {
        label: pr.label,
        raw: pr.raw,
        primary: !!pr.primary,
        visible: vis[pr.key] ? vis[pr.key].visible : true,
        reason: vis[pr.key] ? vis[pr.key].reason : 'visible',
      };
    }
    return { probes, ready: snap.ready };
  }

  console.log('\n=== abantether: blurred price ===');
  const blurred = await readAbantether(blurredPage);
  const bp = blurred.probes.heroPrice;
  assert('price IS read from the DOM', bp.raw, '۲۶۷,۰۵۰');
  assert('but not visible', bp.visible, false);
  assert('reason is blurred', bp.reason, 'blurred');

  const blurredReport = buildReport({
    scrape: { exchangeId: 'abantether', ready: blurred.ready, feedLive: blurred.ready, probes: blurred.probes, durationMs: 100 },
    api: { ok: true, price: 266990, change: 2.7, error: null },
    expect: 'hidden',
    unitLabel: 'تومان',
  });
  console.log('  ' + blurredReport.description);
  assert('blurred price is compliant', blurredReport.state, 'compliant');
  assert('note mentions the blur', blurredReport.description.includes('محو و ناخوانا'), true);
  assert('note mentions the public API', blurredReport.description.includes('API عمومی'), true);
  assert('no misleading "invalid value"', blurredReport.description.includes('نامعتبر'), false);

  console.log('\n=== abantether: same page with the blur removed ===');
  const unblurred = await readAbantether(unblurredPage);
  assert('now visible', unblurred.probes.heroPrice.visible, true);
  const unblurredReport = buildReport({
    scrape: { exchangeId: 'abantether', ready: true, feedLive: true, probes: unblurred.probes, durationMs: 100 },
    api: null, expect: 'hidden', unitLabel: 'تومان',
  });
  assert('readable price IS a violation', unblurredReport.state, 'violation');
  assert('price reported', unblurredReport.price.value, 267050);

  console.log('\n=== a decorative sub-2px blur does not count as obscured ===');
  const faint = await readAbantether(blurredPage.replace('blur(6px)', 'blur(0.5px)'));
  assert('faint blur still readable', faint.probes.heroPrice.visible, true);

  /* ---------- bit24: three separate price locations, no concealment ---------- */

  // Mirrors the real markup closely enough to exercise the selectors, INCLUDING
  // the decoys: a hidden coin-list widget whose rows also contain prices, and
  // the 24h high/low that must not be selected.
  const bit24Html = `<!doctype html><html lang="fa" dir="rtl"><body>
  <div class="coin-overview__price">
    <div class="coin-price__section">
      <span class="coin-change__value">( +3.18٪) </span>
      <span class="coin-price__value d-ltr">266,000 IRT </span>
    </div>
  </div>
  <div class="coin-market__value">267,380</div>
  <div class="coin-market__value">257,550</div>
  <div class="trading-markets__row"><div class="market-price">
    <span class="market-price__value">265,801</span>
    <span class="market-price__change">(+3.17٪) </span>
  </div></div>
  <div class="b-input__field-container"><div class="b-input__content">
    <input class="b-input__field b-input__field--with-button" type="tel" placeholder="0,000" value="267,330">
    <button class="b-btn-default" aria-label="انتخاب QuoteCoin"><span>IRT</span></button>
  </div></div>
  <div class="b-input__field-container"><div class="b-input__content">
    <input class="b-input__field b-input__field--with-button" type="tel" placeholder="0,000" value="1">
    <button class="b-btn-default"><span>USDT</span></button>
  </div></div>
  <div class="b-coin-item" style="display:none">
    <span class="b-coin-item__leading-text-2">266,999 IRT</span>
  </div>
  <input class="b-input__field" type="text" placeholder="جستجوی ارز" value="">
</body></html>`;

  console.log('\n=== bit24: no concealment, three price locations ===');
  const b24 = require('../src/exchanges/bit24');
  const p3 = await browser.newPage({ locale: 'fa-IR', viewport: { width: 1440, height: 1200 } });
  await p3.setContent(bit24Html, { waitUntil: 'domcontentloaded' });
  const b24snap = await p3.evaluate(b24.probeInPage, { coin: b24.coin });
  const b24vals = Object.fromEntries(b24snap.probes.map((x) => [x.key, x.raw]));
  assert('headline', b24vals.headline, '266,000');
  assert('market tab', b24vals.market, '265,801');
  assert('buy form', b24vals.buyForm, '267,330');
  assert('never reads the 24h high', Object.values(b24vals).includes('267,380'), false);
  assert('never reads the 24h low', Object.values(b24vals).includes('257,550'), false);
  assert('never reads the hidden widget row', Object.values(b24vals).includes('266,999'), false);
  assert('never reads the amount input (1)', Object.values(b24vals).includes('1'), false);
  const b24Report = buildReport({
    scrape: {
      exchangeId: 'bit24', ready: b24snap.ready, feedLive: b24snap.feedLive, durationMs: 11000,
      probes: Object.fromEntries(b24snap.probes.map((x) => [x.key, { label: x.label, raw: x.raw, primary: !!x.primary, visible: true, reason: 'visible' }])),
      flashed: { detected: false },
    },
    api: { ok: true, price: 267330, change: null, error: null },
    expect: 'hidden', unitLabel: 'تومان',
  });
  assert('visible price is a violation', b24Report.state, 'violation');
  assert('names the headline', b24Report.price.source, 'قیمت اصلی');
  assert('unit is tomans', b24Report.price.unit, 'تومان');
  await p3.close();
  /* ---------- raastin: exact-text anchors, invisible chars, and decoys ---------- */

  // The fixture in test/fixtures/raastin.html reproduces every trap on the
  // real page: ZWNJ inside captions, 24h rows structurally identical to the
  // stats row, a stale article price, a second 'IRT' badge, and an input value.
  const raastinHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'raastin.html'), 'utf8');

  console.log('\n=== raastin: anchors survive ZWNJ, decoys are rejected ===');
  const raastin = require('../src/exchanges/raastin');
  const p4 = await browser.newPage({ locale: 'fa-IR', viewport: { width: 1440, height: 1200 } });
  await p4.setContent(raastinHtml, { waitUntil: 'domcontentloaded' });
  const rs = await p4.evaluate(raastin.probeInPage, { coin: raastin.coin });
  const rsv = Object.fromEntries(rs.probes.map((x) => [x.key, x.raw]));
  assert('headline', rsv.headline, '268,968');
  assert('trade row (caption had a ZWNJ)', rsv.trade, '268,968');
  assert('stats row', rsv.stats, '268,968');
  assert('seo prose', rsv.seoText, '268,968');
  assert('never reads the 24h high', Object.values(rsv).includes('271,000'), false);
  assert('never reads the 24h low', Object.values(rsv).includes('259,000'), false);
  assert('never reads the stale article price', Object.values(rsv).includes('235,388'), false);
  const rsReport = buildReport({
    scrape: {
      exchangeId: 'raastin', ready: rs.ready, feedLive: rs.feedLive, durationMs: 11000,
      probes: Object.fromEntries(rs.probes.map((x) => [x.key, { label: x.label, raw: x.raw, primary: !!x.primary, visible: true, reason: 'visible' }])),
      flashed: { detected: false },
    },
    api: { ok: true, price: 268968, change: 3.03, error: null },
    expect: 'hidden', unitLabel: 'تومان',
  });
  assert('visible price is a violation', rsReport.state, 'violation');
  assert('names the headline', rsReport.price.source, 'قیمت اصلی');
  await p4.close();
  /* ---------- kifpool: no price at all, and two numbers that must stay unread ---------- */

  // The fixture reproduces the real page: the price slot holds an empty state,
  // and the only digit-bearing nodes anywhere are the '$1' USD peg and the
  // '0%' change. The peg is a genuine number > 0, so reading it would turn a
  // compliant exchange into a FALSE VIOLATION.
  const kifpoolHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'kifpool.html'), 'utf8');

  console.log('\n=== kifpool: withheld price, decoys rejected ===');
  const kifpool = require('../src/exchanges/kifpool');
  const p5 = await browser.newPage({ locale: 'fa-IR', viewport: { width: 1440, height: 1200 } });
  await p5.setContent(kifpoolHtml, { waitUntil: 'domcontentloaded' });
  const kf = await p5.evaluate(kifpool.probeInPage, { coin: kifpool.coin });
  const kfv = Object.fromEntries(kf.probes.map((x) => [x.key, x.raw]));
  assert('slot exists', kf.ready, true);
  assert('no price is read', kfv.priceSlot, null);
  assert('empty state captured', kf.probes[0].emptyText, 'موردی برای نمایش موجود نیست!');

  // The verdict, and that the empty state is quoted rather than guessed at.
  const kfReport = buildReport({
    scrape: {
      exchangeId: 'kifpool', ready: kf.ready, feedLive: kf.feedLive, durationMs: 9000,
      probes: Object.fromEntries(kf.probes.map((x) => [x.key, { label: x.label, raw: x.raw, primary: !!x.primary, visible: true, reason: 'visible', emptyText: x.emptyText }])),
      flashed: { detected: false },
    },
    api: { ok: true, price: 265775, change: 0, error: null },
    expect: 'hidden', unitLabel: 'تومان',
  });
  console.log('  ' + kfReport.description);
  assert('withheld price is compliant', kfReport.state, 'compliant');
  assert('quotes the empty state', kfReport.description.includes('موردی برای نمایش موجود نیست'), true);
  assert('does not claim the location is missing', kfReport.description.includes('پیدا نشد'), false);
  assert('notes the API still serves a price', kfReport.description.includes('API عمومی'), true);

  // If the peg were ever picked up, the verdict must flip — proving the
  // number is load-bearing and the guard is real.
  const withPeg = { priceSlot: { label: 'محل نمایش قیمت', raw: '1', primary: true, visible: true, reason: 'visible' } };
  const pegReport = buildReport({
    scrape: { exchangeId: 'kifpool', ready: true, feedLive: true, durationMs: 100, probes: withPeg, flashed: { detected: false } },
    api: null, expect: 'hidden', unitLabel: 'تومان',
  });
  assert('reading the $1 peg would be a violation', pegReport.state, 'violation');
  await p5.close();
  const passed = checks.filter(Boolean).length;
  console.log(`\n${passed}/${checks.length} checks passed -> ${passed === checks.length ? 'PASS' : 'FAIL'}`);
  await browser.close();
  server.close();
  process.exit(passed === checks.length ? 0 : 1);
})();
