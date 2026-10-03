'use strict';

/**
 * Central configuration. Every value can be overridden with an env var so the
 * app can be tuned without touching code. Exchange-specific details (URLs,
 * selectors, API endpoints) live in src/exchanges/.
 */
module.exports = {
  port: Number(process.env.PORT || 3000),

  // Compliance policy. 'hidden' = the platforms have been instructed to stop
  // showing this price, so a hidden price is CORRECT and a visible price is a
  // VIOLATION. 'shown' inverts both meanings.
  expect: process.env.EXPECT || 'hidden',

  checkIntervalMs: Number(process.env.CHECK_INTERVAL_MS || 600_000),
  navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS || 60_000),

  // How long to keep sampling a page before judging it. Exchanges render the
  // real price first and blank it out shortly after, so a single early read
  // would produce false violations. Measured flash duration for the exchanges
  // we watch tops out around 1.6s, so this leaves roughly 2.5x margin.
  settleMs: Number(process.env.SETTLE_MS || 4_000),
  sampleMs: Number(process.env.SAMPLE_MS || 350),
  // Timeout for the plain-HTTP path used by server-rendered exchanges, which
  // are read without a browser.
  fetchTimeoutMs: Number(process.env.FETCH_TIMEOUT_MS || 25_000),
  // If a price is STILL on screen after the settle window, watch this long
  // more before calling it a violation. How late the blanking happens varies
  // with page weight and connection speed, so a fixed settle window alone
  // would occasionally report a flash as a real breach.
  confirmMs: Number(process.env.CONFIRM_MS || 5_000),

  headless: process.env.HEADLESS !== 'false',
  // 'msedge' uses the locally installed Edge; falls back to bundled Chromium.
  // 'none' always uses the bundled Chromium (CI has no Edge installed).
  browserChannel:
    process.env.BROWSER_CHANNEL === 'none' ? undefined : process.env.BROWSER_CHANNEL || 'msedge',

  historyLimit: Number(process.env.HISTORY_LIMIT || 400),

  // Optional: POST a JSON payload whenever the compliance state changes.
  webhookUrl: process.env.WEBHOOK_URL || '',
};