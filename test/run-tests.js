'use strict';

/**
 * Exercises both verdict branches against a local page with bitpin's DOM shape,
 * plus the flash-detection rule (a price that appears only while the page is
 * still rendering must not count as a violation).
 */

const http = require('http');

const { classifyValue, buildReport } = require('../src/diagnose');

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

/* ---------- value classification ---------- */

console.log('=== classifyValue ===');
assert('persian number', classifyValue('۲۶۱,۵۰۰').value, 261500);
assert('latin number', classifyValue('262,620').value, 262620);
assert('dash', classifyValue('-').code, 'placeholder');
assert('triple dash', classifyValue('---').code, 'placeholder');
assert('persian zero', classifyValue('۰').code, 'zero');
assert('latin zero', classifyValue('0').code, 'zero');
assert('empty', classifyValue('').code, 'empty');
assert('text', classifyValue('abc').code, 'unparseable');
assert('with unit', classifyValue('۲۶۱,۵۰۰ تومان').value, 261500);
assert('negative', classifyValue('-۵').code, 'negative');
assert('null', classifyValue(null).code, 'absent');

/* ---------- verdicts from a settled page read ---------- */

const scrapeOk = (over = {}) => ({
  exchangeId: 'x',
  ready: true,
  feedLive: true,
  probes: {
    heading: { label: 'قیمت بالای صفحه', raw: '۲۶۱,۵۰۰', primary: true },
  },
  flashed: { detected: false, price: null, durationMs: 0 },
  ...over,
});

const apiPrice = { ok: true, price: 262000, change: 1.2, error: null };

console.log('\n=== price shown, policy=hidden (VIOLATION) ===');
const shown = buildReport({ scrape: scrapeOk(), api: apiPrice, expect: 'hidden' });
console.log('  ' + shown.title);
console.log('  ' + shown.description);
assert('state', shown.state, 'violation');
assert('priceVisible', shown.priceVisible, true);
assert('price', shown.price.value, 261500);
assert('formatted', shown.price.formatted, '۲۶۱,۵۰۰');
assert('no flash note', shown.flashNote, null);

console.log('\n=== price shown, policy=shown (COMPLIANT) ===');
assert('state', buildReport({ scrape: scrapeOk(), api: null, expect: 'shown' }).state, 'compliant');

console.log('\n=== price hidden, policy=hidden (COMPLIANT) ===');
const hiddenProbes = {
  heading: { label: 'قیمت بالای صفحه', raw: '0', primary: true },
  chart: { label: 'نمودار قیمت', raw: '---', primary: false },
  bestBuy: { label: 'بهترین قیمت خرید', raw: '۰', primary: false },
};
const hidden = buildReport({
  scrape: scrapeOk({ probes: hiddenProbes }),
  api: apiPrice,
  expect: 'hidden',
});
console.log('  ' + hidden.title);
console.log('  ' + hidden.description);
assert('state', hidden.state, 'compliant');
assert('priceVisible', hidden.priceVisible, false);
assert('price', hidden.price, null);
assert('reason comes from the primary probe', hidden.reasonLabel, 'نمایش صفر به‌جای قیمت');

console.log('\n=== price hidden, policy=shown (VIOLATION) ===');
assert(
  'state',
  buildReport({ scrape: scrapeOk({ probes: hiddenProbes }), api: null, expect: 'shown' }).state,
  'violation'
);

console.log('\n=== flash: price shown only during render (must PASS) ===');
const flashed = buildReport({
  scrape: scrapeOk({
    probes: hiddenProbes, // settled value: no price
    flashed: { detected: true, price: '262,000', durationMs: 1600 },
  }),
  api: apiPrice,
  expect: 'hidden',
});
console.log('  state: ' + flashed.state);
console.log('  ' + flashed.flashNote);
assert('still compliant', flashed.state, 'compliant');
assert('priceVisible false', flashed.priceVisible, false);
assert(
  'flash note present',
  typeof flashed.flashNote === 'string' && flashed.flashNote.includes('حذف شد'),
  true
);
assert(
  'flash note uses persian digits',
  flashed.flashNote.includes('۲۶۲,۰۰۰'),
  true
);

console.log('\n=== unreachable / not ready (UNKNOWN) ===');
const unreachable = buildReport({ scrape: { navError: 'timeout', exchangeId: 'x' }, api: null, expect: 'hidden' });
assert('unreachable state', unreachable.state, 'unknown');
const notReady = buildReport({
  scrape: { exchangeId: 'x', ready: false, probes: {}, flashed: { detected: false } },
  api: null,
  expect: 'hidden',
});
assert('not-ready state', notReady.state, 'unknown');
const stalled = buildReport({
  scrape: scrapeOk({ probes: hiddenProbes, feedLive: false }),
  api: null,
  expect: 'hidden',
});
assert('feed stalled is unknown, not compliant', stalled.state, 'unknown');

console.log('\n=== observation judging (load-flash handling) ===');
const { judgeObservation } = require('../src/scraper');
const r = (at, any, primary) => ({ at, any, primary });

// The ordinary case: price flashes then disappears -> NOT a violation.
{
  const j = judgeObservation([
    r(0, true, '262,000'), r(350, true, '262,000'), r(1600, true, '262,000'),
    r(1950, false, '0'), r(2300, false, '0'), r(3000, false, '0'),
  ]);
  assert('flash -> no price', j.finalAny, false);
  assert('flash detected', j.flashed.detected, true);
  assert('flash price recorded', j.flashed.price, '262,000');
  assert('flash duration ms', j.flashed.durationMs, 1600);
}

// A SLOW blanking that lands after the settle window — this is the case a
// fixed settle window used to report as a violation.
{
  const j = judgeObservation([
    r(0, true, '263,498'), r(2000, true, '263,498'), r(3000, true, '263,498'),
    r(3800, false, '0'), r(4200, false, '0'),
  ]);
  assert('late flash -> no price', j.finalAny, false);
  assert('late flash detected', j.flashed.detected, true);
  assert('late flash duration', j.flashed.durationMs, 3000);
}

// A genuine, persistent price -> a real violation, and no flash note.
{
  const j = judgeObservation([
    r(0, true, '261,500'), r(1500, true, '261,480'), r(3000, true, '261,510'),
    r(6000, true, '261,500'),
  ]);
  assert('persistent price -> violation', j.finalAny, true);
  assert('no flash when persistent', j.flashed.detected, false);
}

// Never showed a price at all.
{
  const j = judgeObservation([r(0, false, '0'), r(3000, false, '0')]);
  assert('always hidden', j.finalAny, false);
  assert('no flash', j.flashed.detected, false);
  assert('sawPrice false', j.sawPrice, false);
}

console.log('\n=== ramzinex-shaped pages ===');
const rxProbes = (headline, carousel) => ({
  headline: { label: 'قیمت تتر (بالای صفحه)', raw: headline, primary: true },
  carousel: { label: 'بازار معاملاتی', raw: carousel, primary: false },
});

const rxScrapes = (probes) => ({
  exchangeId: 'ramzinex', ready: true, feedLive: true,
  probes, flashed: { detected: false, price: null, durationMs: 0 }, durationMs: 3000,
});

const rxApi = { ok: true, price: 262000, change: null, error: null };

/**
 * A miniature wallex-shaped SSR document: the caption markup, the value spans,
 * and a __NEXT_DATA__ blob carrying the authoritative price.
 */
function wxHtml(o = {}) {
  const v = {
    headline: '258,118', dollar: '$1', converter: '258,118',
    current: '258,117', high: '258,138', low: '257,951', ...o,
  };
  return `<!doctype html><html lang="fa" dir="rtl"><body>
<div><div>
  <span>آخرین قیمت تتر</span><span>(بروزرسانی هر ۳۰ ثانیه)</span>
</div><div>
  <div class="mui-1v13ntz"><span>${v.headline}</span></div>
  <div>تومان</div>
</div></div>
<div><div><span>قیمت تتر به دلار</span></div>
  <div class="mui-wmne9r"><span>${v.dollar}</span></div></div>
<div><div>
  <div>قیمت تتر به تومان</div>
  <div>برابر است با: </div>
  <div><span>${v.converter}</span> </div>
</div></div>
<div><span>قیمت فعلی</span><div><span>${v.current}</span></div></div>
<div><span>بیشترین قیمت (۲۴ ساعت)</span><span>${v.high}</span></div>
<div><span>کمترین قیمت (۲۴ ساعت)</span><span>${v.low}</span></div>
</body></html>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      dehydratedState: {
        queries: [
          {
            queryKey: ['price-coin-list', ['USDT', 'quotes']],
            state: {
              data: {
                result: {
                  markets: [
                    { baseAsset: 'BTC', quotes: { TMN: { price: '223339954126' } } },
                    { baseAsset: 'USDT', quotes: { TMN: { price: '258117.8690078500000000', change24h: '0.52' } } },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  },
})}</script>`;
}

// Headline blanked, carousel still priced -> a breach, in ریال.
{
  const r = buildReport({
    scrape: rxScrapes(rxProbes('--', '2,625,000')),
    api: rxApi, expect: 'hidden', unitLabel: 'ریال',
  });
  console.log('  ' + r.title);
  console.log('  ' + r.description);
  assert('carousel price = violation', r.state, 'violation');
  assert('priceVisible', r.priceVisible, true);
  assert('price value', r.price.value, 2625000);
  assert('unit is ریال', r.price.unit, 'ریال');
  assert('named location', r.price.source, 'بازار معاملاتی');
}

// Both blanked -> compliant.
{
  const r = buildReport({
    scrape: rxScrapes(rxProbes('--', '0')),
    api: rxApi, expect: 'hidden', unitLabel: 'ریال',
  });
  console.log('  ' + r.title);
  assert('all hidden = compliant', r.state, 'compliant');
  assert('reason names the dash', r.reasonLabel, 'نمایش خط تیره به‌جای عدد');
}

// Headline blanked but carousel blanked too, with a flash -> still compliant.
{
  const s = rxScrapes(rxProbes('--', '0'));
  s.flashed = { detected: true, price: '2,619,997', durationMs: 1400 };
  const r = buildReport({ scrape: s, api: rxApi, expect: 'hidden', unitLabel: 'ریال' });
  assert('flash still compliant', r.state, 'compliant');
  assert('flash note kept', r.flashNote.includes('۲,۶۱۹,۹۹۷'), true);
}

console.log('\n=== visibility gating ===');
// A price sitting in the DOM but off-screen/clipped must NOT be a violation.
{
  const scrape = scrapeOk({
    probes: {
      heading: { label: 'قیمت بالای صفحه', raw: '--', primary: true, visible: true },
      carousel: { label: 'بازار معاملاتی', raw: '2,625,000', primary: false, visible: false },
    },
  });
  const r = buildReport({ scrape, api: rxApi, expect: 'hidden', unitLabel: 'ریال' });
  console.log('  ' + r.title);
  console.log('  ' + r.description);
  assert('hidden price is not a violation', r.state, 'compliant');
  assert('priceVisible false', r.priceVisible, false);
  assert('hidden price is called out', r.description.includes('قابل مشاهده نیست'), true);
  assert('hidden price value surfaced', r.description.includes('۲,۶۲۵,۰۰۰'), true);
}

// Same price, but actually visible -> violation.
{
  const scrape = scrapeOk({
    probes: {
      heading: { label: 'قیمت بالای صفحه', raw: '--', primary: true, visible: true },
      carousel: { label: 'بازار معاملاتی', raw: '2,625,000', primary: false, visible: true },
    },
  });
  const r = buildReport({ scrape, api: rxApi, expect: 'hidden', unitLabel: 'ریال' });
  assert('visible price is a violation', r.state, 'violation');
  assert('named location', r.price.source, 'بازار معاملاتی');
}

// Absent visibility means "unknown", so it is treated as visible (back-compat).
{
  const scrape = scrapeOk({
    probes: { heading: { label: 'قیمت بالای صفحه', raw: '۲۶۱,۵۰۰', primary: true } },
  });
  const r = buildReport({ scrape, api: null, expect: 'hidden' });
  assert('undefined visibility = visible', r.state, 'violation');
}


console.log('\n=== wallex: server-rendered probes ===');
const wallex = require('../src/exchanges/wallex');
const wxApi = { ok: true, price: 258118, change: 0.5, error: null };

// A page that discloses the price in every location -> violation.
{
  const out = wallex.fetchProbe(wxHtml({ headline: '258,118' }));
  assert('ready', out.ready, true);
  assert('feedLive', out.feedLive, true);
  const byKey = Object.fromEntries(out.probes.map((p) => [p.key, p.raw]));
  assert('headline', byKey.headline, '258,118');
  assert('dollar', byKey.dollar, '$1');
  assert('converter', byKey.converter, '258,118');
  assert('current', byKey.current, '258,117');
  assert('high', byKey.high, '258,138');
  assert('low', byKey.low, '257,951');
  const r = buildReport({
    scrape: { exchangeId: 'wallex', ready: true, feedLive: true, durationMs: 900,
      probes: Object.fromEntries(out.probes.map((p) => [p.key, { label: p.label, raw: p.raw, primary: !!p.primary, visible: true }])),
      flashed: { detected: false } },
    api: wxApi, expect: 'hidden', unitLabel: 'تومان',
  });
  assert('state', r.state, 'violation');
  assert('price', r.price.formatted, '۲۵۸,۱۱۸');
  assert('unit', r.price.unit, 'تومان');
  assert('source', r.price.source, 'قیمت اصلی');
}

// Every price blanked on the page -> compliant.
{
  const out = wallex.fetchProbe(wxHtml({ headline: '--', dollar: '--', current: '--', high: '--', low: '--', converter: '--' }));
  const r = buildReport({
    scrape: { exchangeId: 'wallex', ready: true, feedLive: true, durationMs: 900,
      probes: Object.fromEntries(out.probes.map((p) => [p.key, { label: p.label, raw: p.raw, primary: !!p.primary, visible: true }])),
      flashed: { detected: false } },
    api: wxApi, expect: 'hidden', unitLabel: 'تومان',
  });
  assert('all blanked -> compliant', r.state, 'compliant');
  assert('priceVisible', r.priceVisible, false);
}

// No price section at all -> not ready, so the verdict stays unknown.
{
  const out = wallex.fetchProbe('<html><body><div>صفحه بدون قیمت</div></body></html>');
  assert('no section -> not ready', out.ready, false);
  const r = buildReport({
    scrape: { exchangeId: 'wallex', ready: false, feedLive: false, durationMs: 100, probes: {} },
    api: null, expect: 'hidden', unitLabel: 'تومان',
  });
  assert('no section -> unknown', r.state, 'unknown');
}

// The __NEXT_DATA__ cross-check reads the authoritative price.
{
  const parsed = wallex.api.parse(wxHtml({ headline: '258,118' }));
  assert('api price parses', Math.round(parsed.price), 258118);
  assert('api is tomans', parsed.unitScale, 1);
}

console.log('\n=== tabdeal: only the CURRENT price counts ===');
const tdApi = { ok: true, price: 265410, change: 2.73, error: null };
const tdScrape = (probes) => ({
  exchangeId: 'tabdeal', ready: true, feedLive: true, durationMs: 11000,
  probes, flashed: { detected: false },
});
const tdProbes = (o) => Object.fromEntries(
  Object.entries(o).map(([k, raw], i) => [k, { label: k, raw, primary: i === 0, visible: true }])
);

// Current price disclosed -> violation.
{
  const r = buildReport({
    scrape: tdScrape(tdProbes({ headline: '265,460', approx: '265,460', lastTrade: '265,460', seoText: '265,460' })),
    api: tdApi, expect: 'hidden', unitLabel: 'تومان',
  });
  assert('current price -> violation', r.state, 'violation');
  assert('price', r.price.formatted, '۲۶۵,۴۶۰');
  assert('unit is tomans', r.price.unit, 'تومان');
}

// Only the 24h high/low remain -> NOT a violation; they are day-range stats.
// Probes carry the extracted value, or null when nothing was found — which is
// what the adapter produces. It never passes raw prose through, so a blanked
// "1 USDT = -- IRT" yields null rather than being read as the number 1.
{
  const r = buildReport({
    scrape: tdScrape(tdProbes({ headline: null, approx: null, lastTrade: null, seoText: null })),
    api: tdApi, expect: 'hidden', unitLabel: 'تومان',
  });
  assert('24h stats alone are not a breach', r.state, 'compliant');
}

// The page never finished hydrating -> unknown, not compliant.
{
  const r = buildReport({
    scrape: { exchangeId: 'tabdeal', ready: false, feedLive: false, durationMs: 400, probes: {} },
    api: null, expect: 'hidden', unitLabel: 'تومان',
  });
  assert('not ready -> unknown', r.state, 'unknown');
}

console.log('\n=== saraf: a display:none price is not displayed ===');
const sxf = (probes) => ({
  exchangeId: 'saraf', ready: true, feedLive: true, durationMs: 6000,
  probes, flashed: { detected: false },
});
const sxProbes = (o) => Object.fromEntries(
  Object.entries(o).map(([k, raw], idx) => [k, { label: k, raw, primary: idx === 0, visible: false, reason: 'not-rendered' }])
);

// The number is delivered in the HTML but the block is display:none.
{
  const r = buildReport({
    scrape: sxf(sxProbes({ headline: '266,025', latest: '266,025' })),
    api: null, expect: 'hidden', unitLabel: 'تومان',
  });
  console.log('  ' + r.description);
  assert('hidden block is compliant', r.state, 'compliant');
  assert('price not visible', r.priceVisible, false);
  assert('note explains display:none', r.description.includes('display:none'), true);
}

// Once the block is actually rendered, the same value IS a breach.
{
  const probes = Object.fromEntries(
    Object.entries({ headline: '266,025', latest: '266,025' })
      .map(([k, raw], idx) => [k, { label: k, raw, primary: idx === 0, visible: true, reason: 'visible' }])
  );
  const r = buildReport({
    scrape: sxf(probes), api: null, expect: 'hidden', unitLabel: 'تومان',
  });
  assert('rendered price is a violation', r.state, 'violation');
}

/* ---------- per-exchange statistics ---------- */

console.log('\n=== store: per-exchange statistics ===');
const store = require('../src/store');
const fake = (state, price, id) => ({
  checkedAt: new Date(Date.now() + store.overall().totalChecks * 1000).toISOString(),
  exchangeId: id || 'bitpin',
  state,
  priceVisible: state === 'violation',
  price: price ? { value: price, formatted: String(price) } : null,
  change: null,
  durationMs: 100,
});

store.add(fake('compliant'));
store.add(fake('compliant'));
const bs = store.store('bitpin').stats();
assert('compliant counted', bs.compliantChecks, 2);
assert('rate 100%', bs.compliancePercent, 100);
assert('last violation null', bs.lastViolationAt, null);

store.add(fake('unknown'));
assert('unknown not a pass', store.store('bitpin').stats().compliancePercent, 100);
assert('unknown tracked', store.store('bitpin').stats().unknownChecks, 1);

store.add(fake('violation', 261500));
store.add(fake('violation', 262000));
let st = store.store('bitpin').stats();
assert('violations counted', st.violationChecks, 2);
assert('violation streak', st.consecutiveViolations, 2);
assert('rate 50%', st.compliancePercent, 50);
assert('last violation price', st.lastViolationPrice, 262000);

store.add(fake('compliant', null, 'nobitex'));
let overall = store.overall();
assert('ten exchanges', overall.exchangeCount, 10);
assert('overall violation', overall.state, 'violation');
assert('total violations summed', overall.totalViolations, 2);
assert('bitpin rate unchanged by other exchange', store.store('bitpin').stats().compliancePercent, 50);
assert('nobitex rate', store.store('nobitex').stats().compliancePercent, 100);

store.add(fake('compliant'));
assert('overall recovers to compliant', store.overall().state, 'compliant');
assert('last violation kept', store.overall().lastViolationAt !== null, true);

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} checks passed -> ${passed === checks.length ? 'PASS' : 'FAIL'}`);
process.exit(passed === checks.length ? 0 : 1);