'use strict';

const path = require('path');
const express = require('express');

const config = require('./src/config');
const monitor = require('./src/monitor');
const store = require('./src/store');
const { closeBrowser } = require('./src/scraper');
const { get: getExchange } = require('./src/exchanges');

const app = express();
const publicDir = path.join(__dirname, 'public');
const page = (file) => (req, res) => res.sendFile(path.join(publicDir, file));

app.use(express.json());

/* ---------- pages ---------- */

// Declared before the static mount so these win over express.static.
app.get('/', page('index.html'));
app.get('/exchange/:id', (req, res) =>
  getExchange(req.params.id) ? page('exchange.html')(req, res) : notFound(res)
);
app.use('/shots', express.static(path.join(__dirname, 'shots'), { maxAge: '1h' }));
app.use(express.static(publicDir));

/* ---------- api ---------- */

app.get('/api/status', (req, res) => {
  res.json(monitor.status());
});

/** Everything one detail page needs, in a single round trip. */
app.get('/api/exchange/:id', (req, res) => {
  const ex = getExchange(req.params.id);
  if (!ex) return notFound(res);
  const limit = Math.min(Number(req.query.limit) || 40, 400);
  res.json({
    id: ex.id,
    name: ex.name,
    host: ex.host,
    url: ex.url,
    coin: ex.coin,
    report: store.report(ex.id),
    stats: store.store(ex.id).stats(),
    history: store.store(ex.id).recent(limit),
    checking: monitor.isChecking(),
    intervalMs: config.checkIntervalMs,
    nextCheckAt: monitor.nextCheckAt(),
    policy: { expect: config.expect },
  });
});

app.get('/api/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 40, store.overall().totalChecks || 1);
  res.json({ entries: store.recent(limit), overall: store.overall() });
});

app.post('/api/check', async (req, res) => {
  await monitor.runCheck({ reason: 'manual' });
  res.json(monitor.status());
});

/** Re-check a single exchange — used by the detail page's refresh button. */
app.post('/api/check/:id', async (req, res) => {
  const ex = getExchange(req.params.id);
  if (!ex) return notFound(res);
  await monitor.runCheck({ reason: 'manual', only: ex.id });
  res.json({ ok: true, id: ex.id });
});

app.post('/api/interval', (req, res) => {
  const seconds = Number(req.body && req.body.seconds);
  if (!Number.isFinite(seconds) || seconds < 15 || seconds > 3600) {
    return res.status(400).json({ error: 'بازه زمانی باید بین ۱۵ ثانیه تا ۱ ساعت باشد.' });
  }
  monitor.setIntervalMs(seconds * 1000);
  res.json({ ok: true, intervalMs: config.checkIntervalMs });
});

function notFound(res) {
  res.status(404);
  if (res.req && res.req.path.startsWith('/api/')) {
    return res.json({ error: 'صرافی مورد نظر یافت نشد.' });
  }
  return res.sendFile(path.join(publicDir, '404.html'));
}

app.listen(config.port, () => {
  console.log(`داشبورد پایش قیمت تتر روی http://localhost:${config.port} در حال اجراست`);
  monitor.start();
});

async function shutdown() {
  console.log('\nدر حال بستن برنامه...');
  await closeBrowser();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);