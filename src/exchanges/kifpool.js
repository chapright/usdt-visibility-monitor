'use strict';

/**
 * کیف پول من (kifpool.me) — adapter.
 *
 * Monitored page: https://kifpool.me/wallet/tether-usdt
 *
 * Kifpool genuinely withholds the price — this is NOT a visual trick. There is
 * no blur, no opacity, no overlay, no login gate: the price slot is filled with
 * a server-rendered empty state that hydration never fills in.
 *
 *     <div role="status" ...>موردی برای نمایش موجود نیست!</div>
 *
 * The suppression is site-wide — their other price page behaves identically.
 *
 * IMPORTANT: the price is still published twice to an anonymous visitor, in
 * `__NUXT_DATA__` and in a public GraphQL response. That is recorded as a note,
 * not a breach, in line with the other exchanges that pass on screen.
 *
 * UNIT: `priceBuyIRT` is TOMAN. The field name says IRT, which is the legacy ISO
 * code for rial and invites the wrong reading; the evidence is the magnitude —
 * the site's own rate against USD is `priceBuyIRT / price = 265,750`, exactly
 * the band every other exchange reports for 1 USDT in تومان, and its copy
 * repeatedly says «به تومان».
 *
 * This adapter reads a single probe, and deliberately avoids the two numbers
 * that ARE on the page: the `$1` USD peg and the `0%` change. The peg is a real
 * number greater than zero — reading it would produce a false violation.
 */

const GRAPHQL_BODY = JSON.stringify([
  {
    operationName: 'getCoinDetail',
    variables: { slug: 'tether-usdt', page: 'wallet' },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: 'bc2f5ffe6212b1fa18acadd71643c0b137422247351049fb7f98aadc7fdd1a94',
      },
    },
  },
]);

module.exports = {
  id: 'kifpool',
  name: 'کیف پول من',
  host: 'kifpool.me',
  coin: 'USDT',
  market: 'USDT_IRT',
  unit: 'IRT',
  unitLabel: 'تومان',
  url: 'https://kifpool.me/wallet/tether-usdt',
  currency: 'IRT',

  api: {
    // Apollo persisted query: replayed verbatim, no auth required. Answering
    // this is a POST because the query is addressed by hash, not by text.
    url: 'https://kifpool.me/api/graphql',
    method: 'POST',
    body: GRAPHQL_BODY,
    parse(text) {
      const json = JSON.parse(text);
      // The endpoint answers with an array of operation results.
      const coin =
        (Array.isArray(json) && json[0] && json[0].data && json[0].data.coinDetail) ||
        (json && json.data && json.data.coinDetail);
      if (!coin) return null;
      const price = Number(coin.priceBuyIRT);
      const change = Number(coin.priceChangePercent);
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
    // A comma-grouped price only — this rejects the "$1" peg and the "0%"
    // change, and would reject a bare integer too.
    const PRICE = /[\d۰-۹]{1,3}(?:,[\d۰-۹]{3})+(?![\d.,])/;

    document.querySelectorAll('[data-monitor],[data-probe]').forEach((el) => {
      el.removeAttribute('data-monitor');
      el.removeAttribute('data-probe');
    });

    // The price card. On this page it holds only the empty state.
    const slot =
      document.querySelector('#chart') ||
      document.querySelector('a[aria-label="صفحه قیمت تتر"]') ||
      document.querySelector('#product');

    // Only look at this subtree, never the whole document: the page footer and
    // sidebar carry unrelated numbers.
    const raw = slot ? ((norm(slot.textContent).match(PRICE) || [])[0] || null) : null;

    // Record why the slot is empty so the report can say so, rather than
    // claiming the price location could not be found.
    const empty = slot
      ? (slot.querySelector('[role="status"]') || {}).textContent
      : null;
    const emptyText = empty ? norm(empty) : null;

    if (slot) {
      slot.dataset.probe = 'priceSlot';
      slot.dataset.monitor = 'priceSlot';
    }

    return {
      ready: !!slot,
      // Nothing on this page is client-populated, so the slot rendering is
      // enough to call the page live.
      feedLive: !!slot,
      probes: [
        {
          key: 'priceSlot',
          label: 'محل نمایش قیمت',
          raw,
          primary: true,
          emptyText,
        },
      ],
      shots: [{ key: 'priceSlot', label: 'محل نمایش قیمت تتر' }],
    };
  },
};
