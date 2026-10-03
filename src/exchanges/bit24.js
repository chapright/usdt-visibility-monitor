'use strict';

/**
 * بیت۲۴ (bit24.cash) — adapter.
 *
 * Monitored page: https://bit24.cash/coins/usdt/
 *
 * Bit24 applies NO concealment: the tether price is plainly visible in several
 * places. Unlike b��ت‌پین/نوبیتکس (blanked), آبان‌تتر (blurred) and صراف
 * (display:none), there is nothing here to work around — which makes this the
 * clean baseline for comparison.
 *
 * Two things that shape this adapter:
 *
 * 1. THE MAIN PRICES ARE NOT SERVER-RENDERED. `.coin-price__value` and
 *    `.market-price__value` only appear after hydration (~1s), so this adapter
 *    reports `feedLive: false` until the headline has actually rendered. A
 *    check that lands before hydration is recorded as unknown rather than
 *    being allowed to read as "no price shown".
 *
 * 2. THE THREE LOCATIONS SHOW DIFFERENT NUMBERS BY DESIGN — last trade,
 *    exchange `each_price`, and the buy-side ask. They are reported
 *    separately rather than reconciled.
 *
 * UNIT: `IRT` here is Toman. Their own market API returns `"name":"Toman"`, and
 * the page's prose says "قیمت تومانی ارز USDT معادل 266,020 تومان است".
 *
 * The `data-v-*` scope attributes (69 of them) are build-specific and are never
 * used here; only the site's own semantic BEM class names are.
 */

module.exports = {
  id: 'bit24',
  name: 'بیت۲۴',
  host: 'bit24.cash',
  coin: 'USDT',
  market: 'USDT_IRT',
  unit: 'IRT',
  unitLabel: 'تومان',
  url: 'https://bit24.cash/coins/usdt/',
  currency: 'IRT',

  api: {
    // Unauthenticated. Cross-check only — the verdict comes from the page.
    url: 'https://otc-api.bit24.cash/api/v1/coins/convertor?from_coin=USDT&to_coin=IRT&amount=1&type=buy',
    parse(text) {
      const json = JSON.parse(text);
      // The response is enveloped: { success, data: { value, metas: { buy_price } } }
      const payload = (json && json.data) || json || {};
      const metas = payload.metas || {};
      const price = Number(metas.buy_price || payload.value);
      return {
        price: Number.isFinite(price) ? price : null,
        change: null,
        // Quoted in Toman.
        unitScale: 1,
      };
    },
  },

  probeInPage() {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const PRICE = /[\d۰-۹]{1,3}(?:,[\d۰-۹]{3})+/;
    const numberIn = (text) => (norm(text).match(PRICE) || [])[0] || null;

    document.querySelectorAll('[data-monitor],[data-probe]').forEach((el) => {
      el.removeAttribute('data-monitor');
      el.removeAttribute('data-probe');
    });

    /* ---- headline: "قیمت تتر" block ---- */
    const headlineEl = document.querySelector('.coin-overview__price .coin-price__value');
    const headline = headlineEl ? numberIn(headlineEl.textContent) : null;

    /* ---- trading-markets tab price ---- */
    const marketEls = [...document.querySelectorAll('.trading-markets__row .market-price__value')];
    // Several market rows exist; the tether one is the first that has a value.
    const marketEl = marketEls.find((el) => numberIn(el.textContent)) || null;
    const market = marketEl ? numberIn(marketEl.textContent) : null;

    /* ---- buy-form ask, the field sitting beside the IRT selector ---- */
    // `input.b-input__field` alone matches 40 elements across five different
    // kinds, so require type="tel" AND an IRT sibling to pick the price field
    // rather than, say, the search box or a comment textarea.
    let buyFormEl = null;
    for (const input of document.querySelectorAll('input[type="tel"]')) {
      const container = input.closest('.b-input__field-container') || input.parentElement;
      const hasIrt = container && /IRT/.test(norm(container.textContent));
      if (!hasIrt) continue;
      const v = input.getAttribute('value');
      const n = numberIn(v);
      // The other tel input in this form is the amount the user buys (1), not a
      // price, so require a comma-grouped value to accept it.
      if (n && /,/.test(v || '')) { buyFormEl = input; break; }
    }
    const buyForm = buyFormEl ? numberIn(buyFormEl.getAttribute('value')) : null;

    if (headlineEl) {
      headlineEl.dataset.probe = 'headline';
      headlineEl.dataset.monitor = 'headline';
    }
    if (marketEl) {
      marketEl.dataset.probe = 'market';
      marketEl.dataset.monitor = 'market';
    }
    if (buyFormEl) {
      buyFormEl.dataset.probe = 'buyForm';
      buyFormEl.dataset.monitor = 'buyForm';
    }

    return {
      ready: !!headlineEl,
      // Hydration-dependent: without the headline, the page has not finished.
      feedLive: !!headlineEl && !!headline,
      probes: [
        { key: 'headline', label: 'قیمت اصلی', raw: headline, primary: true },
        { key: 'market', label: 'بازار معاملات', raw: market },
        { key: 'buyForm', label: 'قیمت خرید', raw: buyForm },
      ],
      shots: [
        { key: 'headline', label: 'قیمت تتر — کارت اصلی' },
        { key: 'market', label: 'قیمت در تب بازار معاملات' },
        { key: 'buyForm', label: 'قیمت خرید در فرم معامله' },
      ],
    };
  },
};
