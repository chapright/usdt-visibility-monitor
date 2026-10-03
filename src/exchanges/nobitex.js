'use strict';

/**
 * نوبیتکس (nobitex.ir) — adapter.
 *
 * The USDT price lives on https://nobitex.ir/buy/usdt/ in three places, all of
 * which are read so a single visible value is enough to flag a violation:
 *
 *   1. the heading price   — #landing-coin__irt-price
 *   2. the chart header    — "نمودار قیمت تتر" block
 *   3. "بهترین قیمت خرید"  — the best-buy block
 *
 * IMPORTANT: the server sends a real price in the initial HTML, and roughly
 * 1.5s later the client renders 0 in its place. The page therefore has a price
 * "flash" before it settles. The scraper samples repeatedly and judges the
 * settled value; see scrape() in ../scraper.js.
 */
module.exports = {
  id: 'nobitex',
  name: 'نوبیتکس',
  host: 'nobitex.ir',
  coin: 'USDT',
  market: 'usdt-rls',
  url: 'https://nobitex.ir/buy/usdt/',
  currency: 'IRT',
  unit: 'IRT',
  unitLabel: 'تومان',

  api: {
    url: 'https://apiv2.nobitex.ir/market/stats',
    parse(text) {
      const json = JSON.parse(text);
      const stats = (json && json.stats) || {};
      const m = stats['usdt-rls'];
      if (!m) return null;
      const price = Number(m.latest);
      const change = Number(m.dayChange);
      return {
        price: Number.isFinite(price) ? price : null,
        change: Number.isFinite(change) ? change : null,
        // nobitex quotes this market in Rial; the site displays Toman.
        unitScale: 0.1,
      };
    },
  },

  probeInPage() {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

    // This probe runs many times per page load. Clear tags from earlier
    // samples first, otherwise a mid-hydration layout difference can leave two
    // elements tagged and the screenshot step would match more than one.
    document.querySelectorAll('[data-monitor],[data-probe]').forEach((el) => {
      el.removeAttribute('data-monitor');
      el.removeAttribute('data-probe');
    });

    const heading = document.querySelector('#landing-coin__irt-price');
    const headingRaw = heading
      ? norm((heading.querySelector('span') || heading).textContent)
      : null;

    // Chart header: the block titled "نمودار قیمت تتر".
    let chartRaw = null;
    const chartTitle = [...document.querySelectorAll('h2')].find(
      (h) => norm(h.textContent) === 'نمودار قیمت تتر'
    );
    if (chartTitle && chartTitle.parentElement && chartTitle.parentElement.parentElement) {
      // Walk down to the flex row that holds the price and its unit.
      const scope = chartTitle.parentElement.parentElement;
      const numeric = [...scope.querySelectorAll('div')]
        .filter((d) => d.children.length === 0)
        .map((d) => norm(d.textContent))
        .filter((t) => /^-{2,}$|^[\d۰-۹.,٬\s]+$/.test(t));
      if (numeric.length) chartRaw = numeric[0];
    }

    // "بهترین قیمت خرید" block.
    let bestBuyRaw = null;
    let bestBuyEl = null;
    const bestLabel = [...document.querySelectorAll('div')].find(
      (d) => d.children.length === 0 && norm(d.textContent) === 'بهترین قیمت خرید'
    );
if (bestLabel && bestLabel.parentElement) {
      bestBuyEl = [...bestLabel.parentElement.querySelectorAll('span, div')].find(
        (d) => d.children.length === 0 && /^-{2,}$|^[\d۰-۹.,٬\s]+$/.test(norm(d.textContent))
      );
      bestBuyRaw = bestBuyEl ? norm(bestBuyEl.textContent) : null;
    }

    // Tag elements for screenshots. Scope the chart capture to its price row
    // (the coin icons + price + change) rather than the whole chart section,
    // which is far too tall to be useful evidence.
    const headingBlock = document.querySelector('#heading-title');
    if (headingBlock) headingBlock.dataset.monitor = 'heading';
    // Tag the exact elements the prices were read from, so the scraper can
    // check that a user can actually see them.
    if (heading) heading.dataset.probe = 'heading';
    if (bestBuyEl) bestBuyEl.dataset.probe = 'bestBuy';

    let chartTarget = null;
    const chartBlock = chartTitle && chartTitle.closest('div.flex.flex-col.gap-32');
    if (chartBlock) {
      chartTarget = chartBlock.querySelector('div.z-10') || chartBlock;
      chartTarget.dataset.monitor = 'chart';
      chartTarget.dataset.probe = 'chart';
    }

    // The page is alive when its client-side tabs have rendered.
    const feedLive = !!document.querySelector('#landing-sticky-bar-markets-table');

    return {
      ready: !!heading,
      feedLive,
      probes: [
        { key: 'heading', label: 'قیمت بالای صفحه', raw: headingRaw, primary: true },
        { key: 'chart', label: 'نمودار قیمت', raw: chartRaw, primary: false },
        { key: 'bestBuy', label: 'بهترین قیمت خرید', raw: bestBuyRaw, primary: false },
      ],
      shots: [
        { key: 'heading', label: 'قیمت تتر در بالای صفحه' },
        { key: 'chart', label: 'بخش نمودار قیمت تتر' },
      ],
    };
  },
};