'use strict';

/**
 * A local page with the same DOM shape as nobitex.ir/buy/usdt/, showing a real
 * price. Used to exercise the VIOLATION path in the live dashboard, which the
 * real site cannot show while it is compliant.
 *
 *   node test/fixture-server.js 3999
 */

const http = require('http');

const port = Number(process.argv[2]) || 3999;

const page = ({ price, chart, bestBuy }) => `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<style>
 body{font-family:Tahoma,sans-serif;background:#fff;color:#111;margin:0;padding:24px}
 .flex{display:flex}.flex-col{flex-direction:column}.gap-32{gap:32px}.gap-16{gap:16px}
 .gap-4{gap:4px}.items-center{align-items:center}.items-start{align-items:start}
 .justify-between{justify-content:space-between}.z-10{z-index:10}
 .gap-32-2{gap:32px}.hidden{display:none}
</style></head><body>

<div id="heading-title" class="flex flex-row justify-between" style="gap:16px;align-items:center;border-bottom:1px solid #eee;padding-bottom:16px">
  <div class="flex items-center" style="gap:16px">
    <img alt="usdt" width="56" height="56" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Ccircle cx='28' cy='28' r='28' fill='%2326a17b'/%3E%3C/svg%3E">
    <h1 id="landing-coin__title" style="margin:0;font-size:28px">خرید تتر</h1>
  </div>
  <div class="flex flex-row items-center gap-x-8">
    <div class="flex flex-row items-center gap-x-4" id="landing-coin__irt-price">
      <span style="font-size:28px;font-weight:700">${price}</span>
      <span style="font-size:16px">تومان</span>
    </div>
  </div>
</div>

<button id="landing-sticky-bar-markets-table" type="button" style="margin:24px 0">بازار معاملاتی</button>

<div class="flex flex-col gap-32">
  <h2 class="text-headline-medium">نمودار قیمت تتر</h2>
  <div class="z-10 flex gap-16 items-center" style="min-height:94px;border:1px solid #eee;border-radius:12px;padding:16px">
    <img alt="usdt" width="64" height="64" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%2326a17b'/%3E%3C/svg%3E">
    <div class="flex flex-col items-start">
      <div class="flex items-center gap-4">
        <div class="text-headline-xLarge" style="font-size:30px;font-weight:700">${chart}</div>
        <div class="text-headline-xSmall">تومان</div>
      </div>
      <div class="flex items-center gap-4" style="margin-top:6px">
        <div dir="ltr" style="font-size:16px">+ ۱.۲۳ ٪</div>
      </div>
    </div>
  </div>
</div>

<div style="margin-top:24px;border:1px solid #eee;border-radius:12px;padding:16px" class="flex justify-between">
  <div>بهترین قیمت خرید</div>
  <div class="flex flex-row-reverse items-center justify-start gap-4">
    <div class="text-body-medium uppercase">irt</div>
    <div class="text-body-bold-medium">${bestBuy}</div>
  </div>
</div>

</body></html>`;

const VIOLATION = page({ price: '۲۶۱,۵۰۰', chart: '۲۶۱,۴۹۸', bestBuy: '۲۶۱,۴۲۰' });
const COMPLIANT = page({ price: '0', chart: '---', bestBuy: '0' });

/** A local page with ramzinex.ir's DOM shape (USDT/IRR, market 11). */
const rxPage = ({ headline, carousel }) => `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<style>
 body{font-family:Tahoma,sans-serif;background:#fff;color:#111;margin:0;padding:24px}
 .market-overview{border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:16px}
 .markets-container{display:flex;gap:8px;flex-wrap:wrap}
 .flex-row-between-center{display:flex;gap:24px;align-items:center}
 .flex-col-start-between{display:flex;flex-direction:column}
 .slide-item{display:inline-flex;gap:12px;align-items:center;border:1px solid #eee;
   border-radius:8px;padding:6px 12px;text-decoration:none;color:inherit}
</style></head><body>

<div class="market-overview">
  <div class="flex-row-between-center">
    <div class="flex-col-start-between">
      <div><span>قیمت تتر</span></div>
      <div><p>${headline}</p><p>IRR</p></div>
    </div>
    <div class="flex-col-start-between">
      <div><span>تغییرات ۲۴ ساعته</span></div>
      <div><span>1.66%</span></div>
    </div>
    <div class="flex-col-start-between">
      <div><span>بیشترین قیمت روزانه</span></div>
      <div><span>2,620,000</span></div>
    </div>
  </div>
</div>

<div class="markets-container">
  <a class="slide-item" href="/app/markets/11/spot">
    <span>تتر</span>
    <div><span>1.66%</span></div>
    <span>${carousel}</span>
  </a>
</div>
</body></html>`;

const RX_VIOLATION = rxPage({ headline: '--', carousel: '2,625,000' });
const RX_COMPLIANT = rxPage({ headline: '--', carousel: '0' });

/**
 * Reproduces the ramzinex false-positive bug: a real tether price that exists
 * in the DOM but is scrolled outside a clipped track, so no user can see it.
 * The headline is genuinely blanked. The monitor must report this as
 * COMPLIANT (with a note), never as a violation.
 */
const RX_HIDDEN_PRICE = rxPage({ headline: '--', carousel: '2,625,000' }).replace(
  '<div class="markets-container">',
  '<div class="markets-container" style="overflow:hidden;width:420px;position:relative;height:60px">'
).replace(
  '<a class="slide-item" href="/app/markets/11/spot">',
  '<a class="slide-item" href="/app/markets/11/spot" style="position:absolute;left:900px;top:8px">'
);


/** A local page with tabdeal.org's DOM shape, showing the tether price. */
const TD_VIOLATION = `<!doctype html><html lang="fa" dir="rtl"><body>
<div class="market-selection-card" style="visibility:hidden"><div>+40.44% %</div></div>
<div class="flex flex-col items-stretch w-full gap-1 rounded-lg p-4">
  <div class="flex justify-between items-center">
    <span>آخرین قیمت تتر</span><span> (به‌روزرسانی هر ۳۰ ثانیه) </span>
  </div>
  <div class="flex items-center gap-2 mt-2"><span>1</span><span>$</span></div>
  <div class="flex flex-row-reverse items-center justify-between">
    <span dir="ltr">+2.73% %</span>
    <div class="flex items-center gap-x-1"><span>265,460</span><span> تومان </span></div>
  </div>
</div>
<div class="w-full flex items-center justify-start my-6">
  <div class="mr-2">
    <p>قیمت تقریبی</p>
    <p dir="ltr">1 USDT = 265,460 IRT</p>
  </div>
</div>
<div class="grid">
  <div><p>قیمت آخرین معامله</p><span dir="ltr">265,460 تومان</span></div>
  <div><p>بالاترین قیمت ۲۴ ساعت گذشته</p><span dir="ltr">266,500 تومان</span></div>
  <div><p>پایین‌ترین قیمت ۲۴ ساعت گذشته</p><span dir="ltr">254,000 تومان</span></div>
</div>
<div class="market-chart"><svg><text>258,000</text><text>262,000</text><text>266,000</text></svg></div>
<p class="seo">هم اکنون قیمت لحظه‌ای تتر 265,460 تومان، معادل 1 دلار آمریکا است.</p>
</body></html>`;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url.startsWith('/tabdeal')) {
      res.end(TD_VIOLATION);
    } else if (req.url.startsWith('/ramzinex')) {
      if (req.url.includes('hidden')) res.end(RX_HIDDEN_PRICE);
      else if (req.url.includes('compliant')) res.end(RX_COMPLIANT);
      else res.end(RX_VIOLATION);
    } else {
      res.end(req.url.startsWith('/compliant') ? COMPLIANT : VIOLATION);
    }
  })
  .listen(port, () => {
    console.log(
      `fixture on http://127.0.0.1:${port}/\n` +
        `  /                       nobitex shape, price shown (violation)\n` +
        `  /compliant              nobitex shape, price hidden\n` +
        `  /ramzinex               ramzinex shape, headline -- carousel priced (violation)\n` +
        `  /ramzinex/hidden        price present in DOM but clipped off-screen (must be compliant)\n` +
        `  /ramzinex/compliant     ramzinex shape, nothing priced
` +
        `  /tabdeal               tabdeal shape, price shown (violation)`
    );
  });