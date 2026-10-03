'use strict';

/**
 * راستین (raastin.com) — adapter.
 *
 * Monitored page: https://raastin.com/price/tether
 *
 * Raastin applies NO concealment: the price is plainly visible in four places.
 *
 * The markup here is unusually awkward — the text elements are `<label>` tags,
 * and the only usable anchors are exact Persian caption strings. Two traps
 * follow from that:
 *
 *   1. PERSIAN TEXT NORMALISATION. These captions contain invisible characters
 *      (ZWNJ U+200C between words, RTL marks). A hand-typed literal can match
 *      ZERO elements and fail silently, degrading a probe to null instead of
 *      erroring. Every comparison below normalises both sides first.
 *
 *   2. DECOYS. The 24h high/low rows are STRUCTURALLY IDENTICAL to the
 *      "قیمت (تومان)" row — same classes at the same depth — so only exact
 *      caption text separates them. There is also a stale price (235,388) in
 *      the related-articles block, which is exactly the kind of number a naive
 *      scrape would grab.
 *
 * UNIT: `IRT` here is Toman, not Rial — the page labels it تومان and the API's
 * own price_usdt/price_irt ratio confirms the scale.
 */

module.exports = {
  id: 'raastin',
  name: 'راستین',
  host: 'raastin.com',
  coin: 'USDT',
  market: 'USDT_IRT',
  unit: 'IRT',
  unitLabel: 'تومان',
  url: 'https://raastin.com/price/tether',
  currency: 'IRT',

  api: {
    // Unauthenticated plain GET. Cross-check only — the verdict comes from the
    // page, so hiding the price would still count as removal.
    url: 'https://api.raastin.com/api/v1/asset/overview/',
    parse(text) {
      const json = JSON.parse(text);
      const rows = (json && json.high_volume) || [];
      // Index by symbol: the array order is not stable between requests.
      const usdt = rows.find((r) => r && r.symbol === 'USDT');
      if (!usdt) return null;
      const price = Number(usdt.price_irt);
      const change = Number(usdt.change_24h_irt);
      return {
        price: Number.isFinite(price) ? price : null,
        change: Number.isFinite(change) ? change : null,
        // Quoted in Toman.
        unitScale: 1,
      };
    },
  },

  probeInPage() {
    // Persian captions can separate words with a real space OR with a ZWNJ
    // (U+200C), and may carry bidi marks. Delete the formatting characters and
    // promote ZWNJ to a space, so "قیمت تتر" and "قیمت‌تتر" compare equal.
    // Written as escapes: literal invisible characters would be unreadable here
    // and easy to corrupt in transit.
    const FORMATTING = /[\u200B\u200D\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
    const norm = (s) =>
      (s || '')
        .replace(FORMATTING, '')
        .replace(/\u200C/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const PRICE = /^\d{1,3}(?:,\d{3})+$/;
    const numberIn = (text) => (norm(text).match(/[\d۰-۹]{1,3}(?:,[\d۰-۹]{3})+/) || [])[0] || null;
    const isPrice = (el) => PRICE.test(norm(el.textContent));

    const labelByText = (root, text) =>
      [...root.querySelectorAll('label')].find((l) => norm(l.textContent) === text) || null;

    /** A price label directly inside `root`. */
    const priceLabelIn = (root) => {
      if (!root) return null;
      return [...root.querySelectorAll('label')].find(isPrice) || null;
    };

    document.querySelectorAll('[data-monitor],[data-probe]').forEach((el) => {
      el.removeAttribute('data-monitor');
      el.removeAttribute('data-probe');
    });

    /* ---- headline: the IRT ticker beside the big figure ----
     * "IRT" appears on two labels (headline + trade-widget unit badge), so
     * require that the label's own parent also holds a price. */
    const irtLabel = [...document.querySelectorAll('label')].find(
      (l) => norm(l.textContent) === 'IRT' && !!priceLabelIn(l.parentElement)
    );
    const headlineEl = irtLabel ? priceLabelIn(irtLabel.parentElement) : null;

    /* ---- "قیمت تتر" summary row, scoped by the stable #price-trade panel ---- */
    const tradePanel = document.querySelector('#price-trade');
    const tradeCaption = tradePanel ? labelByText(tradePanel, 'قیمت تتر') : null;
    const tradeRow = tradeCaption ? tradeCaption.parentElement : null;
    const tradeEl = priceLabelIn(tradeRow);

    /* ---- "قیمت (تومان)" stats row.
     * Caption -> span -> row is TWO levels up; the intervening element is the
     * dotted divider. The 24h high/low rows share this exact structure, so only
     * the caption text distinguishes them. */
    const statsCaption = labelByText(document, 'قیمت (تومان)');
    const statsRow = statsCaption ? statsCaption.parentElement.parentElement : null;
    const statsEl = priceLabelIn(statsRow);

    /* ---- descriptive paragraph under the only screen-reader heading ---- */
    const srHeading = [...document.querySelectorAll('h2.sr-only')][0] || null;
    const seoSection = srHeading ? srHeading.closest('section') : null;
    const seoEl = seoSection ? seoSection.querySelector('label') : null;
    const seoText = seoEl ? numberIn(seoEl.textContent) : null;

    if (headlineEl) {
      headlineEl.dataset.probe = 'headline';
      headlineEl.dataset.monitor = 'headline';
    }
    if (tradeEl) {
      tradeEl.dataset.probe = 'trade';
      tradeEl.dataset.monitor = 'trade';
    }
    if (statsEl) {
      statsEl.dataset.probe = 'stats';
      statsEl.dataset.monitor = 'stats';
    }
    if (seoEl) {
      seoEl.dataset.probe = 'seoText';
      seoEl.dataset.monitor = 'seoText';
    }

    return {
      ready: !!headlineEl,
      // Server-rendered and never hidden, so it is live as soon as it paints.
      feedLive: !!headlineEl && !!headlineEl.textContent,
      probes: [
        { key: 'headline', label: 'قیمت اصلی', raw: headlineEl ? numberIn(headlineEl.textContent) : null, primary: true },
        { key: 'trade', label: 'قیمت تتر', raw: tradeEl ? numberIn(tradeEl.textContent) : null },
        { key: 'stats', label: 'قیمت (تومان)', raw: statsEl ? numberIn(statsEl.textContent) : null },
        { key: 'seoText', label: 'متن قیمت لحظه‌ای', raw: seoText },
      ],
      shots: [
        { key: 'headline', label: 'قیمت تتر — بالای صفحه' },
        { key: 'trade', label: 'قیمت تتر — کارت معامله' },
        { key: 'stats', label: 'قیمت (تومان) — جدول اطلاعات' },
      ],
    };
  },
};
