'use strict';

/**
 * آبان‌تتر (abantether.com) — adapter.
 *
 * Monitored page: https://abantether.com/coin/USDT
 *
 * This exchange does not blank the price — it renders the real digits and then
 * applies `filter: blur(6px)` behind a "log in to see the live price" prompt.
 * The digits are plain text in the DOM, one <span> per character, so a plain
 * text scrape WOULD read them and would report a violation that no user can
 * possibly see.
 *
 * The shared visibility check (src/visibility.js) treats a blur of 2px or more
 * as "not displayed", so the verdict here is compliant, with a note stating
 * that the price is present but deliberately obscured — plus the note that the
 * API still serves it in cleartext.
 *
 * Worth recording: the obscurity is PRESENTATIONAL ONLY. The price arrives in
 * plaintext in the page's RSC payload, and
 * api.abantether.com/api/v2/manager/coins serves every coin's buy/sell price
 * with no authentication. Blurring the screen does not make the price private.
 */

module.exports = {
  id: 'abantether',
  name: 'آبان‌تتر',
  host: 'abantether.com',
  coin: 'USDT',
  market: 'USDT_IRT',
  unit: 'IRT',
  unitLabel: 'تومان',
  url: 'https://abantether.com/coin/USDT',
  currency: 'IRT',

  api: {
    // Unauthenticated. Cross-check only: the verdict comes from what the page
    // displays, so blurring the page counts as removal even though this
    // endpoint keeps serving the price.
    url: 'https://api.abantether.com/api/v2/manager/coins',
    parse(text) {
      const json = JSON.parse(text);
      const list = (json && json.data) || json || [];
      const entries = Array.isArray(list) ? list : list.coins || [];
      const usdt = entries.find((c) => c && (c.symbol === 'USDT' || c.name === 'تتر'));
      if (!usdt) return null;
      const price = Number(usdt.price_buy);
      const change = Number(usdt.percent_change_24h);
      return {
        price: Number.isFinite(price) ? price : null,
        change: Number.isFinite(change) ? change : null,
        // Quoted in Toman.
        unitScale: 1,
      };
    },
  },

  probeInPage() {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const PRICE = /[\d۰-۹]{1,3}(?:,[\d۰-۹]{3})+/;

    document.querySelectorAll('[data-monitor],[data-probe]').forEach((el) => {
      el.removeAttribute('data-monitor');
      el.removeAttribute('data-probe');
    });

    // Anchored on the accessible name, so nothing depends on Tailwind classes
    // or on the build-hashed data-v-* scope hashes.
    const loginBtn = [...document.querySelectorAll('button[aria-label]')].find((b) =>
      norm(b.getAttribute('aria-label')).includes('قیمت لحظه‌ای تتر')
    );

    // The digits live in one span each, so read the container's text rather
    // than any individual node.
    const priceRaw = loginBtn ? (norm(loginBtn.textContent).match(PRICE) || [])[0] || null : null;

    // The blur is applied to a DESCENDANT of the button, so tag the innermost
    // blurred node rather than the button itself: if the site ever drops the
    // blur, no blurred descendant exists and the button falls back to being
    // tagged — which is exactly when the price becomes readable again.
    const BLUR = /blur\(\s*([\d.]+)px\s*\)/;
    let target = loginBtn;
    if (loginBtn) {
      const blurred = [...loginBtn.querySelectorAll('*')].find((el) => {
        const f = getComputedStyle(el).filter;
        if (!f || f === 'none') return false;
        const m = BLUR.exec(f);
        return m && parseFloat(m[1]) >= 2;
      });
      if (blurred) target = blurred;
    }

    if (target) {
      target.dataset.probe = 'heroPrice';
      target.dataset.monitor = 'heroPrice';
    }

    return {
      ready: !!loginBtn,
      // The page renders the price block as soon as the coin data arrives.
      feedLive: !!loginBtn && !!priceRaw,
      probes: [{ key: 'heroPrice', label: 'قیمت تتر (پشت شیشه)', raw: priceRaw, primary: true }],
      shots: [{ key: 'heroPrice', label: 'قیمت تتر — نمایش محو' }],
    };
  },
};
