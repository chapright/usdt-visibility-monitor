'use strict';

/**
 * تبدیل (tabdeal.org) — adapter.
 *
 * Monitored page: https://tabdeal.org/usdt-price
 *
 * Nuxt/Vue app. The price is CLIENT-ONLY — it never appears in the initial
 * HTML — so this exchange needs the browser, unlike wallex.
 *
 * Good news: this page has no load-flash. The price paints at roughly 1.2s and
 * then holds continuously, so the settle window is enough on its own.
 *
 * UNIT WARNING: the page prints "1 USDT = 265,140 IRT", but IRT here is
 * Tabdeal's market code for TOMAN, not Iranian Rial — it is the same number as
 * the card, not ten times it. Their own config confirms it:
 * FIAT="irt" and representation_name:"تومان". Reading IRT as rial would be
 * wrong by 10x.
 */

module.exports = {
  id: 'tabdeal',
  name: 'تبدیل',
  host: 'tabdeal.org',
  coin: 'USDT',
  market: 'IRT',
  unit: 'IRT',
  unitLabel: 'تومان',
  url: 'https://tabdeal.org/usdt-price/',
  currency: 'IRT',

  api: {
    // Unauthenticated, no headers required. Used ONLY as a cross-check: the
    // verdict comes from what the page displays, so that removing the price
    // from the page counts even while this endpoint keeps serving it.
    url: 'https://api-web.tabdeal.org/r/plots/currencies/dynamic-info/',
    parse(text) {
      const json = JSON.parse(text);
      const pair =
        json && json.currencies && json.currencies.USDT && json.currencies.USDT.IRT;
      if (!pair) return null;
      const price = Number(pair.price);
      const change = Number(pair.change_percent_24);
      return {
        price: Number.isFinite(price) ? price : null,
        change: Number.isFinite(change) ? change : null,
        // Already quoted in Toman.
        unitScale: 1,
      };
    },
  },

  probeInPage() {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

    // Strictly a comma-grouped integer: 265,140. This is what keeps the chart's
    // SVG axis ticks (258,000 ... 266,000) and decimal volumes like
    // 3,988,749.0734 from ever being read as a price.
    const PRICE = /^\d{1,3}(?:,\d{3})+$/;
    // Same idea, for scanning a run of prose. The lookahead stops the regex
    // matching the integer head of a decimal number.
    const PRICE_IN_TEXT = /\d{1,3}(?:,\d{3})+(?![\d.,])/;

    const leafByText = (predicate) =>
      [...document.querySelectorAll('span,div,p')].find(
        (e) => e.children.length === 0 && predicate(norm(e.textContent))
      );

    /** Exact-caption lookup, so nothing depends on build-hashed data-v-* classes. */
    const byCaption = (text) => leafByText((t) => t === text);

    /** Walk up from a caption until an ancestor matches `need`. */
    const scopeWith = (el, need, levels = 8) => {
      let n = el;
      for (let i = 0; i < levels && n && n !== document.body; i++) {
        if (need.test(norm(n.textContent))) return n;
        n = n.parentElement;
      }
      return null;
    };

    /** First leaf whose own text is exactly a comma-grouped price. */
    const firstPrice = (root) => {
      if (!root) return null;
      for (const el of root.querySelectorAll('span,div,p')) {
        if (el.children.length) continue;
        const t = norm(el.textContent);
        if (PRICE.test(t)) return t;
      }
      return null;
    };

    /**
     * First comma-grouped price inside arbitrary text. Needed where the value
     * shares its leaf with a unit ("265,460 تومان") or with surrounding prose.
     * The lookahead stops it matching the integer head of a decimal volume
     * such as 3,988,749.0734.
     */
    const firstPriceIn = (text) => (norm(text).match(PRICE_IN_TEXT) || [])[0] || null;

    // ---- headline card: «آخرین قیمت تتر» ----
    const headlineEl = byCaption('آخرین قیمت تتر');
    const headlineCard = scopeWith(headlineEl, /تومان/);
    const headline = firstPrice(headlineCard);

    // ---- «قیمت تقریبی» — "1 USDT = 265,140 IRT" ----
    const approxEl = leafByText((t) => /USDT\s*=/.test(t));
    const approx = approxEl ? firstPriceIn(approxEl.textContent) : null;

    // ---- «قیمت آخرین معامله» stat tile ----
    // Its value leaf carries the unit ("265,460 تومان"), so it cannot be
    // matched exactly — scan the tile's text for a price instead.
    const lastTradeEl = byCaption('قیمت آخرین معامله');
    const lastTradeScope = scopeWith(lastTradeEl, /\d/);
    const lastTrade = lastTradeScope ? firstPriceIn(lastTradeScope.textContent) : null;

    // ---- SEO sentence: «هم اکنون قیمت لحظه‌ای تتر 265,140 تومان…» ----
    const seoEl =
      leafByText((t) => t.includes('هم اکنون قیمت لحظه‌ای')) ||
      [...document.querySelectorAll('span,p')]
        .reverse()
        .find((e) => norm(e.textContent).includes('هم اکنون قیمت لحظه‌ای')) ||
      null;
    const seoText = seoEl ? firstPriceIn(seoEl.textContent) : null;

    /* ---- evidence tags ----
     * `data-probe` is what the shared visibility check runs against, so every
     * probe needs one. Without it the price is treated as not visible and
     * silently ignored — which would report a price on screen as compliant.
     */
    if (headlineCard) headlineCard.dataset.probe = 'headline';
    if (approxEl) approxEl.dataset.probe = 'approx';
    if (lastTradeScope) lastTradeScope.dataset.probe = 'lastTrade';
    if (seoEl) seoEl.dataset.probe = 'seoText';

    if (headlineCard) headlineCard.dataset.monitor = 'headline';
    if (approxEl) approxEl.dataset.monitor = 'approx';

    // Deliberately NOT probed:
    //  - the "1" / "$" pair: static decoration for "1 USDT in dollars", it
    //    never changes, so counting it would mean a permanent false violation;
    //  - بیشترین/پایین‌ترین قیمت ۲۴ ساعته: day-range statistics, not the
    //    current price (same reasoning that excluded the ramzinex order book);
    //  - the visibility:hidden .market-selection-card gainers list, which
    //    belongs to a different asset entirely.

    // The Nuxt shell renders at once but the price data lands ~1.2s later, so
    // the page only counts as live once a data-bound figure has actually
    // appeared. Without this an early sample would read as "hidden" and pass.
    const feedLive = ['قیمت تقریبی', 'بیشترین قیمت ۲۴ ساعته', 'قیمت آخرین معامله'].some((caption) => {
      const el = byCaption(caption);
      return !!(el && scopeWith(el, /\d/));
    });

    return {
      ready: !!headlineEl,
      feedLive,
      probes: [
        { key: 'headline', label: 'قیمت اصلی', raw: headline, primary: true },
        { key: 'approx', label: 'قیمت تقریبی', raw: approx },
        { key: 'lastTrade', label: 'قیمت آخرین معامله', raw: lastTrade },
        { key: 'seoText', label: 'متن قیمت لحظه‌ای', raw: seoText },
      ],
      shots: [
        { key: 'headline', label: 'قیمت تتر در کارت اصلی' },
        { key: 'approx', label: 'قیمت تقریبی USDT' },
      ],
    };
  },
};
