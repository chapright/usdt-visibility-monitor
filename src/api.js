'use strict';

/**
 * Reads the current price from an exchange's own public market feed.
 *
 * This is a cross-check only: if the API still serves a price while the page
 * shows none, the market data is intact and the order was carried out on the
 * visible page only — which is a materially different fact.
 */
async function fetchApiPrice(adapter) {
  if (!adapter.api) {
    return { ok: false, price: null, change: null, error: 'برای این صرافی تنظیم نشده است' };
  }
  try {
    // Most feeds are a plain GET; some (GraphQL) need a POST with a body.
    const init = { headers: { accept: 'application/json' } };
    if (adapter.api.method === 'POST') {
      init.method = 'POST';
      init.headers['content-type'] = 'application/json';
      init.body = typeof adapter.api.body === 'string'
        ? adapter.api.body
        : JSON.stringify(adapter.api.body || {});
    }
    const res = await fetch(adapter.api.url, {
      ...init,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        ...init.headers,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, price: null, change: null, error: `HTTP ${res.status}` };

    // The body is passed as text so an adapter can parse JSON (most feeds) or
    // scrape markup (wallex publishes its price in its own server-rendered
    // document rather than a price endpoint).
    const parsed = adapter.api.parse(await res.text());
    if (!parsed || !parsed.price || parsed.price <= 0) {
      return { ok: false, price: null, change: null, error: 'قیمت در پاسخ API یافت نشد' };
    }
    return {
      ok: true,
      // Normalise every exchange to Toman so prices are comparable.
      price: parsed.price * (parsed.unitScale ?? 1),
      change: parsed.change ?? null,
      error: null,
    };
  } catch (err) {
    return { ok: false, price: null, change: null, error: err.message };
  }
}

module.exports = { fetchApiPrice };