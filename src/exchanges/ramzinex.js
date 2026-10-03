'use strict';

/**
 * رمزینکس (ramzinex.ir) — adapter.
 *
 * Market 11 is USDT/IRR. Two places are read, and a price in EITHER one counts
 * as a breach:
 *
 *   1. the headline "قیمت تتر" block in .market-overview
 *   2. the market carousel item for this pair
 *
 * Order-book rows, recent-trades rows and the page title are deliberately NOT
 * read: they are trading data rather than a displayed price quote.
 *
 * This page quotes in ریال, not تومان, so values are labelled as IRR.
 */
module.exports = {
  id: 'ramzinex',
  name: 'رمزینکس',
  host: 'ramzinex.ir',
  coin: 'USDT',
  market: 'USDT_IRR',
  marketId: 11,
  unit: 'IRR',
  unitLabel: 'ریال',
  url: 'https://ramzinex.ir/app/markets/11/spot/',
  currency: 'IRR',

  api: {
    // Public and unauthenticated. data[0] is the most recent trade; its first
    // element is the price in ریال.
    url: 'https://publicapi.ramzinex.ir/exchange/api/v1.0/exchange/orderbooks/11/trades?duration=24h',
    parse(text) {
      const json = JSON.parse(text);
      const rows = (json && json.data) || [];
      if (!Array.isArray(rows) || !rows.length) return null;
      const price = Number(rows[0][0]);
      return {
        price: Number.isFinite(price) ? price : null,
        change: null,
        // ریال -> تومان, so prices are comparable with the other exchanges.
        unitScale: 0.1,
      };
    },
  },

  probeInPage({ marketId }) {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const id = marketId || 11;

    // This probe runs many times per page load; clear earlier tags first so a
    // screenshot selector can never match more than one element.
    document.querySelectorAll('[data-monitor],[data-probe]').forEach((el) => {
      el.removeAttribute('data-monitor');
      el.removeAttribute('data-probe');
    });

    const isNumeric = (t) => /^[\d۰-۹٠-٩.,٬\s]+$/.test(t) && /[\d۰-۹٠-٩]/.test(t);

    /* ---- headline: the block captioned "قیمت تتر" ---- */
    let headlineRaw = null;
    let headlineBlock = null;
    const overview = document.querySelector('.market-overview');
    if (overview) {
      for (const el of overview.querySelectorAll('div.flex-col-start-between')) {
        const cap = el.querySelector('span');
        if (cap && norm(cap.textContent) === 'قیمت تتر') {
          headlineBlock = el;
          const ps = [...el.querySelectorAll('p')].map((p) => norm(p.textContent)).filter(Boolean);
          headlineRaw = ps.length ? ps[0] : null;
          break;
        }
      }
    }

    /* ---- carousel: the market list item for this pair ---- */
    const path = `/app/markets/${id}/spot`;
    const candidates = [...document.querySelectorAll('a.slide-item')].filter((a) =>
      (a.getAttribute('href') || '').includes(path)
    );

    // The price span shares its class with a long warning sentence, so pick by
    // content rather than by class.
    const priceOf = (a) => {
      const nums = [...a.querySelectorAll('span')]
        .map((s) => norm(s.textContent))
        .filter(isNumeric);
      return nums.length ? nums[nums.length - 1] : null;
    };
    const onScreen = (a) => {
      const r = a.getBoundingClientRect();
      return r.right > 0 && r.left < window.innerWidth;
    };

    // The market strip is an auto-scrolling marquee (a 270s `slide` animation)
    // inside an overflow:hidden track, so at any instant the tether chip may be
    // scrolled out of sight. We read the page exactly as it loads and never
    // pause, scroll or otherwise alter it, so the verdict reflects what a user
    // would actually see at that moment.
    const priced = candidates.map((a) => ({ el: a, raw: priceOf(a) })).filter((c) => c.raw);
    const chosen =
      priced.find((c) => onScreen(c.el)) ||
      priced.slice().sort((a, b) => a.el.getBoundingClientRect().left - b.el.getBoundingClientRect().left)[0] ||
      null;
    const item = chosen ? chosen.el : candidates[0] || null;
    const carouselRaw = chosen ? chosen.raw : null;

    /* ---- screenshots ---- */
    // Only the headline row is captured. The market strip scrolls automatically
    // and sits clipped at the very bottom edge, so a screenshot of it would be
    // blank or half-cut most of the time. The strip is still read as a probe.
    if (headlineBlock) {
      const row = headlineBlock.closest('div.flex-row-between-center') || headlineBlock;
      row.dataset.monitor = 'headline';
      headlineBlock.dataset.probe = 'headline';
    }
    // Tag the chip for the visibility check even though it is not captured.
    if (item) item.dataset.probe = 'carousel';

    const shots = [{ key: 'headline', label: 'قیمت تتر در بالای صفحه' }];

    const feedLive =
      !!document.querySelector('.market-overview') &&
      !!document.querySelector('.markets-container') &&
      document.readyState !== 'loading';

    return {
      ready: !!overview,
      feedLive,
      probes: [
        { key: 'headline', label: 'قیمت تتر (بالای صفحه)', raw: headlineRaw, primary: true },
        { key: 'carousel', label: 'بازار معاملاتی', raw: carouselRaw, primary: false },
      ],
      shots,
    };
  },
};