'use strict';

/**
 * Run exactly one check cycle and freeze the dashboard's data into static
 * JSON files with the same shapes as the /api/* endpoints.
 *
 * This is the CI entrypoint used by the GitHub Actions workflow: there is no
 * long-running server, so each workflow run restores the previous run's state
 * (statistics, history, webhook transition memory), performs one full check,
 * writes data/*.json for the static site, and saves the state snapshot back
 * for the next run.
 *
 * Environment:
 *   STATE_IN        previous state snapshot (optional)
 *   STATE_OUT       where to save the state snapshot (optional)
 *   DATA_DIR        where the data files are written (default: ./data)
 *   KEEPALIVE_FILE  tiny status file the workflow commits daily (optional)
 *   CHECK_REASON    label stored on the reports (default: scheduled)
 */

const fs = require('fs');
const path = require('path');

const config = require('../src/config');
const monitor = require('../src/monitor');
const store = require('../src/store');
const { EXCHANGES } = require('../src/exchanges');
const { closeBrowser } = require('../src/scraper');

const rootDir = path.join(__dirname, '..');
const stateIn = process.env.STATE_IN || '';
const stateOut = process.env.STATE_OUT || '';
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));
const keepalivePath = process.env.KEEPALIVE_FILE
  ? path.resolve(process.env.KEEPALIVE_FILE)
  : '';
const reason = process.env.CHECK_REASON || 'scheduled';

// The next run is whenever Actions fires next (the cron fires every 15
// minutes with some jitter); surface the nominal interval so the dashboard's
// countdown is honest instead of permanently empty.
const CI_INTERVAL_MS = Number(process.env.CI_INTERVAL_MS || 15 * 60 * 1000);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  console.log(`  wrote ${path.relative(rootDir, file)}`);
}

async function main() {
  if (stateIn && fs.existsSync(stateIn)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateIn, 'utf8'));
      if (store.restore(state.store)) {
        monitor.restoreTransitionStates(state.transitions || []);
        console.log(`حالت قبلی بازیابی شد (شروع از ${state.startedAt || '—'}).`);
      } else {
        console.log('فایل حالت قابل استفاده نبود؛ آمار از صفر شروع می‌شود.');
      }
    } catch (err) {
      console.log(`خواندن حالت قبلی ناموفق بود (${err.message})؛ آمار از صفر شروع می‌شود.`);
    }
  }

  console.log(`بررسی کامل صرافی‌ها (${reason})…`);
  await monitor.runCheck({ reason });

  // Evidence URLs must be relative so the static site works under /<repo>/.
  store.rewriteShotUrls();

  const overall = store.overall();
  const nextCheckAt = new Date(Date.now() + CI_INTERVAL_MS).toISOString();

  const status = monitor.status();
  status.nextCheckAt = nextCheckAt;
  writeJson(path.join(dataDir, 'status.json'), status);

  writeJson(path.join(dataDir, 'history.json'), {
    entries: store.recent(15),
    overall,
  });

  for (const ex of EXCHANGES) {
    const s = store.store(ex.id);
    writeJson(path.join(dataDir, 'exchange', `${ex.id}.json`), {
      id: ex.id,
      name: ex.name,
      host: ex.host,
      url: ex.url,
      coin: ex.coin,
      report: store.report(ex.id),
      stats: s.stats(),
      history: s.recent(40),
      checking: false,
      intervalMs: CI_INTERVAL_MS,
      nextCheckAt,
      policy: { expect: config.expect },
    });
  }

  if (keepalivePath) {
    writeJson(keepalivePath, {
      checkedAt: new Date().toISOString(),
      reason,
      state: overall.state,
      totalChecks: overall.totalChecks,
      totalViolations: overall.totalViolations,
    });
  }

  if (stateOut) {
    writeJson(stateOut, {
      savedAt: new Date().toISOString(),
      startedAt: store.startedAt,
      store: store.toJSON(),
      transitions: monitor.transitionStates(),
    });
  }

  console.log(
    `بررسی تمام شد: وضعیت کلی ${overall.state}، ${overall.totalChecks} بررسی انباشته.`
  );
}

main()
  .catch((err) => {
    console.error(`بررسی ناموفق بود: ${err.stack || err}`);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
