'use strict';

/**
 * والکس (wallex.ir) — adapter.
 *
 * This exchange is read over plain HTTP against its server-rendered document,
 * with no browser. Two reasons:
 *
 *   1. the price is already in the initial HTML, so a browser adds nothing;
 *   2. the page permanently locks its main thread within a few seconds of load,
 *      which hangs any in-page evaluation — including Playwright's own injected
 *      script — so element screenshots are impossible here.
 *
 * Because of (2) this exchange produces no evidence screenshot.
 *
 * Selectors are anchored on caption TEXT, never on class names: the MUI classes
 * are build-hashed and the typography variant itself differs between the
 * server-rendered and hydrated markup (DisplayStrong -> TitleStrong). Anchoring
 * on the caption also means we can never pick up the zero-size hidden duplicate
 * of the price that a naive text scrape would grab.
 */

const PRICE = /^\d{1,3}(?:,\d{3})+$/;
const DOLLAR = /^\$[\d.,]+$/;

/** Strip tags and collapse whitespace, so a caption can be matched as text. */
function textOf(fragment) {
  return fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Find the first value matching `pattern` within `window` characters after a
 * caption. The caption is located by its text (tag-stripped), not by class,
 * because the MUI classes are build-hashed. Anchoring on the caption also
 * keeps the match local: it is what stops us from grabbing the zero-size
 * hidden duplicate of the price elsewhere in the document.
 */
function valueAfter(html, caption, pattern, window = 1200) {
  const at = html.indexOf(caption);
  if (at < 0) return null;
  const slice = html.slice(at, at + window);
  const spans = slice.match(/<span[^>]*>([^<]*)<\/span>/g) || [];
  for (const tag of spans) {
    const text = tag.replace(/<[^>]*>/g, '').trim();
    if (pattern.test(text)) return text;
  }
  return null;
}

/**
 * Same idea, for captions that the server splits across several spans (so a
 * tag-level search for the literal caption fails). Scans candidate tokens
 * after the caption and returns the first that matches `pattern`.
 */
function valueAfterText(html, caption, pattern, window = 1200) {
  const plain = textOf(html);
  const at = plain.indexOf(caption);
  if (at < 0) return null;
  const region = plain.slice(at + caption.length, at + window);
  const tokens = region.match(/\$?\d[\d,.]*/g) || [];
  for (const token of tokens) {
    const value = token.trim();
    if (pattern.test(value)) return value;
  }
  return null;
}

/** The page's own embedded state — the authoritative price. */
function readNextData(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]);
    const queries = j?.props?.pageProps?.dehydratedState?.queries;
    if (!Array.isArray(queries)) return null;
    const q = queries.find(
      (x) =>
        Array.isArray(x?.queryKey) &&
        x.queryKey[0] === 'price-coin-list' &&
        Array.isArray(x.queryKey[1]) &&
        x.queryKey[1][0] === 'USDT'
    );
    const markets = q?.state?.data?.result?.markets;
    if (!Array.isArray(markets)) return null;
    const usdt = markets.find((m2) => m2 && m2.baseAsset === 'USDT');
    return usdt || null;
  } catch {
    return null;
  }
}

module.exports = {
  id: 'wallex',
  name: 'والکس',
  host: 'wallex.ir',
  coin: 'USDT',
  market: 'TMN',
  unit: 'IRT',
  unitLabel: 'تومان',
  url: 'https://wallex.ir/price/usdt',
  currency: 'IRT',
  static: true,

  api: {
    // No public price endpoint exists: /market/coins is geo-gated and returns
    // 503. The served document carries the price in __NEXT_DATA__ instead.
    url: 'https://wallex.ir/price/usdt',
    parse(text) {
      const usdt = readNextData(text);
      if (!usdt || !usdt.quotes || !usdt.quotes.TMN) return null;
      const price = Number(usdt.quotes.TMN.price);
      const change = Number(usdt.quotes.TMN.change24h);
      return {
        price: Number.isFinite(price) ? price : null,
        change: Number.isFinite(change) ? change : null,
        // Already quoted in Toman.
        unitScale: 1,
      };
    },
  },

  fetchProbe(html) {
    const headline = valueAfter(html, 'آخرین قیمت تتر', PRICE);
    const probes = [
      { key: 'headline', label: 'قیمت اصلی', raw: headline, primary: true },
      { key: 'dollar', label: 'قیمت به دلار', raw: valueAfterText(html, 'قیمت تتر به دلار', DOLLAR, 200) },
      {
        key: 'converter',
        label: 'قیمت تبدیل کنار صفحه',
        raw: valueAfterText(html, 'برابر است با', PRICE, 200),
      },
      { key: 'current', label: 'قیمت فعلی', raw: valueAfter(html, 'قیمت فعلی', PRICE, 600) },
      {
        key: 'high',
        label: 'بیشترین قیمت ۲۴ ساعت',
        raw: valueAfterText(html, 'بیشترین قیمت', PRICE, 200),
      },
      {
        key: 'low',
        label: 'کمترین قیمت ۲۴ ساعت',
        raw: valueAfterText(html, 'کمترین قیمت', PRICE, 200),
      },
    ];

    return {
      ready: !!headline,
      feedLive: !!readNextData(html),
      probes,
    };
  },
};