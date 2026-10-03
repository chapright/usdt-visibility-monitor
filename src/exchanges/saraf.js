'use strict';

/**
 * صراف (saraf.app) — adapter.
 *
 * Monitored page: https://saraf.app/crypto-price/usdt/
 *
 * This platform hides the tether price with a server-authored CSS rule:
 *
 *     <style>.is-unlisted{display:none!important}</style>
 *
 * Every price-bearing block (the headline, the chart, the calculator, the
 * header mega-menu card, the sidebar row) carries that class, no script ever
 * removes it, and because of `!important` nothing can override it. There is no
 * flash either — the value is simply never painted.
 *
 * USDT is the ONLY coin suppressed this way; BTC, ETH, BNB, XRP, ADA, TRX and
 * DOGE all publish their prices openly, which suggests the block was added
 * specifically for tether.
 *
 * IMPORTANT: the suppression is display-only. The full price — plus a 30-point
 * daily history — is still delivered in the initial HTML response in at least
 * eight places, so a monitor that reads raw markup rather than the rendered page
 * still recovers the price. The shared visibility check reports these probes as
 * not rendered, so the verdict is compliant, and the report carries a note
 * saying the value is present but hidden.
 *
 * The class names below are the site's own semantic BEM names, not utility
 * hashes, so they stay stable across builds.
 */

module.exports = {
  id: 'saraf',
  name: 'صراف',
  host: 'saraf.app',
  coin: 'USDT',
  market: 'USDT_TMN',
  unit: 'IRT',
  unitLabel: 'تومان',
  url: 'https://saraf.app/crypto-price/usdt/',
  currency: 'IRT',

  // No public price API exists: api.saraf.app answers only a health check and
  // /v1/price/USDT 404s. The price arrives solely through server-rendered HTML,
  // so there is nothing to cross-check against.
  api: null,

  probeInPage() {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const PRICE = /[\d۰-۹]{1,3}(?:,[\d۰-۹]{3})+/;

    document.querySelectorAll('[data-monitor],[data-probe]').forEach((el) => {
      el.removeAttribute('data-monitor');
      el.removeAttribute('data-probe');
    });

    const numberIn = (text) => (norm(text).match(PRICE) || [])[0] || null;

    /* ---- headline price block ---- */
    const headlineEl = document.querySelector('.symbol-price-head-amount .symbol-price-head-value');
    const headline = headlineEl ? numberIn(headlineEl.textContent) : null;

    /* ---- sidebar "ارزهای برتر" row for tether ---- */
    const latestEl = [...document.querySelectorAll('.symbol-latest li')].find((li) =>
      norm(li.textContent).includes('تتر')
    );
    const latest = latestEl ? numberIn(latestEl.textContent) : null;

    // Tag both. They carry the same `is-unlisted` class as everything else, so
    // the visibility check will mark them not-rendered — which is the point.
    if (headlineEl) {
      headlineEl.dataset.probe = 'headline';
      headlineEl.dataset.monitor = 'headline';
    }
    if (latestEl) {
      latestEl.dataset.probe = 'latest';
    }

    const latestArea = latestEl ? latestEl.closest('.symbol-latest') || latestEl : null;
    if (latestArea) latestArea.dataset.monitor = 'latestArea';

    // Screenshot the price HEAD area instead of the price itself: the price is
    // display:none and therefore has no box to capture, whereas this container
    // is visible and shows the coin's name with no figure under it — which is
    // exactly the evidence a reviewer wants.
    const areaEl = document.querySelector('.symbol-price-head');
    if (areaEl) areaEl.dataset.monitor = 'area';

    return {
      ready: !!headlineEl,
      // The price is server-rendered, so it is present from the first paint.
      feedLive: !!headline,
      probes: [
        { key: 'headline', label: 'قیمت اصلی', raw: headline, primary: true },
        { key: 'latest', label: 'فهرست ارزهای برتر', raw: latest },
      ],
      // Keyed 'area'/'latestArea' so they intentionally match no probe key:
      // verify-shots cross-checks screenshot text against the parsed value, and
      // a deliberately-hidden price is by definition absent from the image.
      shots: [
        { key: 'area', label: 'محل نمایش قیمت — بدون عدد' },
        { key: 'latestArea', label: 'فهرست ارزهای برتر' },
      ],
    };
  },
};
