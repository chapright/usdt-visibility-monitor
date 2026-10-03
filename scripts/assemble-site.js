'use strict';

/**
 * Assemble the static site that GitHub Pages serves:
 *
 *   _site/                        public/ (dashboard pages + assets)
 *   _site/data/                   the JSON files run-once.js wrote
 *   _site/shots/                  the latest evidence screenshots
 *   _site/exchange/<id>/index.html  a copy of exchange.html per exchange
 *
 * The detail-page copies get a <base href> injected so every relative URL
 * (styles, scripts, data files, screenshots) resolves from the site root even
 * when Pages serves the site under /<repo>/.
 *
 * Environment:
 *   PAGES_BASE  the site's base path, e.g. '/bitpin-usdt-monitor/' (default '/')
 *   DATA_DIR    where run-once.js wrote the data files (default: ./data)
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const { EXCHANGES } = require('../src/exchanges');

const publicDir = path.join(rootDir, 'public');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));
const shotsDir = path.join(rootDir, 'shots');
const outDir = path.join(rootDir, '_site');
const base = process.env.PAGES_BASE || '/';

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
copyDir(publicDir, outDir);
copyDir(dataDir, path.join(outDir, 'data'));
copyDir(shotsDir, path.join(outDir, 'shots'));

// Flip the deployed pages into static mode (they read data/*.json instead of
// the /api/* endpoints of the local server).
fs.writeFileSync(
  path.join(outDir, 'config-site.js'),
  `'use strict';\nwindow.MONITOR_STATIC = true;\n`
);

const detailSource = fs.readFileSync(path.join(publicDir, 'exchange.html'), 'utf8');
// Root-relative hrefs are right for the Express server but would escape the
// site on Pages; './' anchors back to the site root once <base> is in place.
// The href rewrite must run BEFORE the base injection so it cannot touch the
// <base> tag itself.
const detailWithBase = detailSource
  .replace(/href="\//g, 'href="./')
  .replace(/<head([^>]*)>/i, `<head$1>\n<base href="${base}" />`);
if (detailWithBase === detailSource) {
  throw new Error('could not inject <base> into exchange.html');
}
for (const ex of EXCHANGES) {
  const dir = path.join(outDir, 'exchange', ex.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), detailWithBase);
}

console.log(
  `سایت ایستا در _site ساخته شد (${EXCHANGES.length} صفحه جزئیات، مسیر پایه ${base}).`
);
