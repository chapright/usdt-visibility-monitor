'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const config = require('./config');
const { toLatinDigits } = require('./persian');
const { probeVisibility } = require('./visibility');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SHOTS_DIR = path.join(__dirname, '..', 'shots');
const MAX_SHOTS = 60;

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const opts = { headless: config.headless };
      try {
        return await chromium.launch({ ...opts, channel: config.browserChannel });
      } catch {
        return await chromium.launch(opts);
      }
    })();
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    (await pending).close();
  } catch {
    /* already gone */
  }
}

/** Does this raw string read as a real (greater than zero) price? */
function isRealPrice(raw) {
  if (raw == null) return false;
  const t = String(raw).replace(/\s+/g, ' ').trim();
  if (t === '' || /^[-–—_.،,\s]+$/.test(t)) return false;
  if (/^-{2,}$/.test(t)) return false; // "---" as nobitex uses
  const latin = toLatinDigits(t).trim();
  if (/^[-−]/.test(latin)) return false;
  const n = Number(latin.replace(/[,\s٬]/g, '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0;
}

/* ---------------- screenshots ---------------- */

function ensureShotsDir() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

function pruneShots() {
  const files = fs.readdirSync(SHOTS_DIR).filter((f) => f.endsWith('.png')).sort();
  while (files.length > MAX_SHOTS) {
    try {
      fs.unlinkSync(path.join(SHOTS_DIR, files.shift()));
    } catch {
      /* ignore */
    }
  }
}

/** Screenshot one tagged element, with padding, after scrolling it into view. */
async function captureShot(page, exchangeId, kind, label) {
  try {
    const el = page.locator(`[data-monitor="${kind}"]`);
    if ((await el.count()) === 0) return null;
    // Defensive: the probe de-duplicates tags, but never let an ambiguous
    // match throw and silently drop the evidence image.
    const target = (await el.count()) === 1 ? el : el.first();

    await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await page.waitForTimeout(220);

    const box = await target.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) return null;

    const pad = 12;
    // Clip to the padded box intersected with the viewport. Clamping (rather
    // than subtracting from the viewport size) keeps this non-negative when the
    // element sits off-screen, so a stray layout cannot silently skip a shot.
    const left = Math.max(0, box.x - pad);
    const top = Math.max(0, box.y - pad);
    const right = Math.min(viewport.width, box.x + box.width + pad);
    const bottom = Math.min(viewport.height, box.y + box.height + pad);
    const clip = { x: left, y: top, width: right - left, height: bottom - top };
    if (clip.width <= 4 || clip.height <= 4) return null;

    ensureShotsDir();
    const file = `${exchangeId}-${kind}-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SHOTS_DIR, file), clip });
    pruneShots();
    return { key: kind, label, file, url: `/shots/${file}` };
  } catch {
    return null;
  }
}

/* ---------------- sampling ---------------- */

/**
 * Decide the verdict from the collected readings.
 *
 * The last reading wins, because that is the page a user ends up looking at.
 * A price that was visible earlier but is gone by the end is the render flash.
 */
function judgeObservation(readings) {
  const final = readings.length ? readings[readings.length - 1] : null;
  const finalAny = final ? final.any : false;
  const withPrice = readings.filter((r) => r.any);
  return {
    final,
    finalAny,
    sawPrice: withPrice.length > 0,
    flashed:
      !finalAny && withPrice.length > 0
        ? {
            detected: true,
            price: withPrice[0].primary ?? null,
            durationMs: withPrice[withPrice.length - 1].at,
          }
        : { detected: false, price: null, durationMs: 0 },
  };
}

/**
 * Read the page repeatedly until it has settled, then judge.
 *
 * Exchanges send a real price in the initial HTML and blank it out a moment
 * later, so judging the first reading would report a violation nobody sees.
 * The blanking time varies with how long hydration takes, so a fixed window is
 * not enough on its own: if a price is STILL on screen after the settle window
 * we watch a while longer to make sure it is not a late flash.
 */
async function sampleUntilSettled(page, adapter) {
  // Serializable slice of the adapter for the in-page probe.
  const probeArg = { coin: adapter.coin, marketId: adapter.marketId };
  const started = Date.now();
  const readings = [];
  let feedLive = false;
  let shots = [];
  let sawReady = false;

  const sampleOnce = async () => {
    let snap = null;
    try {
      snap = await page.evaluate(adapter.probeInPage, probeArg);
    } catch {
      return;
    }
    if (!snap) return;
    feedLive = feedLive || !!snap.feedLive;
    shots = snap.shots || [];
    if (!snap.ready) return;
    sawReady = true;

    // A price only counts if a user could actually see it. Text alone is not
    // evidence: exchanges keep prices in off-screen or clipped DOM nodes, and
    // reporting those would be a violation nobody could ever observe.
    const selectors = {};
    for (const p of snap.probes || []) selectors[p.key] = `[data-probe="${p.key}"]`;
    let vis = {};
    try {
      vis = await page.evaluate(probeVisibility, { selectors });
    } catch {
      vis = {};
    }
    const visibleOf = (key) => (vis[key] ? vis[key].visible : true);
    const reasonOf = (key) => (vis[key] ? vis[key].reason : 'visible');

    readings.push({
      at: Date.now() - started,
      probes: snap.probes.map((p) => ({
        ...p,
        visible: visibleOf(p.key),
        reason: reasonOf(p.key),
      })),
      primary: (snap.probes.find((p) => p.primary) || {}).raw ?? null,
      any: snap.probes.some((p) => isRealPrice(p.raw) && visibleOf(p.key)),
    });
  };

  const lastAny = () => (readings.length ? readings[readings.length - 1].any : false);

  // Phase 1 — let the page settle.
  while (Date.now() - started < config.settleMs) {
    await sampleOnce();
    await page.waitForTimeout(config.sampleMs);
  }
  await sampleOnce();

  // Phase 2 — a price still on screen might be a slow flash, so confirm it
  // persists before calling it a violation.
  if (lastAny() && config.confirmMs > 0) {
    const deadline = Date.now() + config.confirmMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(config.sampleMs);
      await sampleOnce();
      if (!lastAny()) break; // it disappeared: a late flash, not a violation
    }
  }

  const judged = judgeObservation(readings);

  return {
    readings: readings.map((r) => ({ at: r.at, primary: r.primary, any: r.any })),
    final: judged.final,
    finalAny: judged.finalAny,
    sawReady,
    feedLive,
    shots,
    flashed: judged.flashed,
  };
}

/* ---------------- main ---------------- */

/** Render an exchange's page in a browser and report its settled price state. */
async function scrapeBrowser(adapter) {
  const startedAt = Date.now();
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'fa-IR',
    viewport: { width: 1440, height: 1200 },
    deviceScaleFactor: 2,
    userAgent: USER_AGENT,
  });

  try {
    const page = await context.newPage();
    let navError = null;

    try {
      await page.goto(adapter.url, {
        waitUntil: 'domcontentloaded',
        timeout: config.navTimeoutMs,
      });
    } catch (err) {
      navError = err.message;
    }

    let sample = {
      readings: [], final: null, sawReady: false, feedLive: false,
      shots: [], flashed: { detected: false, price: null, durationMs: 0 },
    };
    if (!navError) sample = await sampleUntilSettled(page, adapter);

    const screenshots = [];
    for (const s of sample.shots) {
      const shot = await captureShot(page, adapter.id, s.key, s.label);
      if (shot) screenshots.push(shot);
    }

    const probes = {};
    if (sample.final) {
      for (const p of sample.final.probes) {
        probes[p.key] = {
          label: p.label,
          raw: p.raw,
          primary: !!p.primary,
          visible: p.visible !== false,
          reason: p.reason || 'visible',
          // Optional: what the slot says when it holds no number (an empty
          // state), so the report can describe it instead of guessing.
          ...(p.emptyText ? { emptyText: p.emptyText } : {}),
        };
      }
    }

    return {
      exchangeId: adapter.id,
      navError,
      ready: sample.sawReady,
      feedLive: sample.feedLive,
      probes,
      flashed: sample.flashed,
      screenshots,
      durationMs: Date.now() - startedAt,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Read an exchange whose page is fully server-rendered, using plain HTTP and
 * no browser at all.
 *
 * Some sites (wallex.ir) permanently lock their main thread shortly after load,
 * which makes any in-page evaluation — including Playwright's own injected
 * script — hang indefinitely. For those we fetch the document and parse the
 * markup directly. The price is in the served HTML, so nothing is lost, but
 * there is no layout to photograph, so this mode produces no screenshots.
 */
async function scrapeStatic(adapter) {
  const startedAt = Date.now();
  const failed = (navError) => ({
    exchangeId: adapter.id,
    navError,
    ready: false,
    feedLive: false,
    probes: {},
    flashed: { detected: false, price: null, durationMs: 0 },
    screenshots: [],
    durationMs: Date.now() - startedAt,
    fetchedAt: new Date().toISOString(),
  });

  let html;
  try {
    const res = await fetch(adapter.url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
    });
    if (!res.ok) return failed(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    return failed(err.message);
  }

  let out;
  try {
    out = adapter.fetchProbe(html);
  } catch (err) {
    return failed(`parse failed: ${err.message}`);
  }

  // Anchoring each probe on its caption means we cannot accidentally pick up a
  // hidden or zero-size duplicate the way a naive text scrape would, so a
  // static read is treated as visible.
  const probes = {};
  for (const p of out.probes || []) {
    probes[p.key] = { label: p.label, raw: p.raw, primary: !!p.primary, visible: true };
  }

  return {
    exchangeId: adapter.id,
    navError: null,
    ready: !!out.ready,
    feedLive: !!out.feedLive,
    probes,
    flashed: { detected: false, price: null, durationMs: 0 },
    screenshots: [],
    durationMs: Date.now() - startedAt,
    fetchedAt: new Date().toISOString(),
  };
}

async function scrapeExchange(adapter) {
  if (typeof adapter.fetchProbe === 'function') return scrapeStatic(adapter);
  return scrapeBrowser(adapter);
}

module.exports = { scrapeExchange, closeBrowser, getBrowser, isRealPrice, judgeObservation };