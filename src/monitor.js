'use strict';

const config = require('./config');
const { EXCHANGES } = require('./exchanges');
const { scrapeExchange } = require('./scraper');
const { fetchApiPrice } = require('./api');
const { buildReport } = require('./diagnose');
const store = require('./store');

let timer = null;
let running = false;
let nextCheckAt = null;
let lastError = null;
const previousStates = new Map();

/**
 * Check one exchange: scrape, cross-check the API, judge, store.
 */
async function checkExchange(adapter, reason) {
  const [scrape, api] = await Promise.all([scrapeExchange(adapter), fetchApiPrice(adapter)]);
  const since = store.store(adapter.id) ? store.store(adapter.id).contextSince() : null;
  const report = buildReport({
    scrape,
    api,
    expect: config.expect,
    context: { since },
    unitLabel: adapter.unitLabel || 'تومان',
  });
  report.screenshots = scrape ? scrape.screenshots : [];
  report.exchangeName = adapter.name;
  report.reason = reason;
  store.add(report);
  await notifyTransition(report);
  return report;
}

/**
 * Check every exchange, or just one when `only` names an exchange id.
 * Returns null when a check is already in flight.
 */
async function runCheck({ reason = 'scheduled', only = null } = {}) {
  if (running) return null;
  running = true;
  const reports = [];
  const list = only ? EXCHANGES.filter((e) => e.id === only) : EXCHANGES;
  try {
    for (const adapter of list) {
      try {
        reports.push(await checkExchange(adapter, reason));
      } catch (err) {
        // One exchange failing must not stop the others.
        const report = buildReport({ scrape: null, api: null, expect: config.expect });
        report.exchangeId = adapter.id;
        report.exchangeName = adapter.name;
        report.screenshots = [];
        report.error = err.message;
        report.reason = reason;
        store.add(report);
        reports.push(report);
      }
    }
    lastError = null;
    return reports;
  } catch (err) {
    lastError = err.message;
    return reports;
  } finally {
    running = false;
  }
}

/** Fire the webhook when an exchange's compliance state changes. */
async function notifyTransition(report) {
  if (!config.webhookUrl) return;
  const prev = previousStates.get(report.exchangeId);
  if (prev === undefined) {
    previousStates.set(report.exchangeId, report.state);
    return;
  }
  if (prev === report.state) return;
  previousStates.set(report.exchangeId, report.state);

  const name = report.exchangeName || report.exchangeId;
  const text =
    report.state === 'violation'
      ? `🚨 تخلف در ${name} — قیمت تتر روی صفحه نمایش داده می‌شود${
          report.price ? `: ${report.price.formatted} تومان` : ''
        }`
      : report.state === 'compliant'
        ? `✅ ${name} — بازگشت به وضعیت رعایت دستور (قیمت تتر پنهان است).`
        : `⚠️ ${name} — وضعیت نامشخص شد.`;

  try {
    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        exchangeId: report.exchangeId,
        exchangeName: name,
        state: report.state,
        priceVisible: report.priceVisible,
        price: report.price ? report.price.value : null,
        flashNote: report.flashNote || null,
        policy: config.expect,
        checkedAt: report.checkedAt,
        screenshots: report.screenshots || [],
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* webhook is best-effort */
  }
}

function schedule() {
  if (timer) clearInterval(timer);
  nextCheckAt = Date.now() + config.checkIntervalMs;
  timer = setInterval(() => {
    runCheck();
    nextCheckAt = Date.now() + config.checkIntervalMs;
  }, config.checkIntervalMs);
}

function start() {
  runCheck({ reason: 'startup' });
  schedule();
}

function setIntervalMs(ms) {
  config.checkIntervalMs = ms;
  schedule();
}

function status() {
  return {
    policy: { expect: config.expect },
    overall: store.overall(),
    exchanges: EXCHANGES.map((a) => ({
      id: a.id,
      name: a.name,
      host: a.host,
      url: a.url,
      coin: a.coin,
      report: store.report(a.id),
      stats: store.store(a.id).stats(),
    })),
    intervalMs: config.checkIntervalMs,
    nextCheckAt: nextCheckAt ? new Date(nextCheckAt).toISOString() : null,
    checking: running,
    lastError,
  };
}

module.exports = {
  start,
  runCheck,
  status,
  setIntervalMs,
  isChecking: () => running,
  nextCheckAt: () => (nextCheckAt ? new Date(nextCheckAt).toISOString() : null),
  // The last known state per exchange, for webhook transition detection to
  // survive a process restart (the CI entrypoint persists it).
  transitionStates: () => [...previousStates.entries()],
  restoreTransitionStates: (entries) => {
    for (const [id, state] of entries || []) previousStates.set(id, state);
  },
};