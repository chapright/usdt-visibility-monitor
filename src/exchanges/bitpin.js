'use strict';

/**
 * بیت‌پین (bitpin.ir) — adapter.
 *
 * The USDT price appears in two places on the homepage: the market table row
 * "USDT / IRT", and the horizontally scrollable ticker strip. Both are read.
 */
module.exports = {
  id: 'bitpin',
  name: 'بیت‌پین',
  host: 'bitpin.ir',
  coin: 'USDT',
  market: 'USDT_IRT',
  url: 'https://bitpin.ir/',
  currency: 'IRT',
  unit: 'IRT',
  unitLabel: 'تومان',

  api: {
    url: 'https://api.bitpin.ir/v5/mkt/markets/?quote=IRT&limit=10&exclude_tags=57',
    parse(text) {
      const json = JSON.parse(text);
      const results = Array.isArray(json) ? json : (json && json.results) || [];
      const m = results.find((r) => r && r.code === 'USDT_IRT');
      if (!m || !m.price_info) return null;
      const price = Number(m.price_info.price);
      const change = Number(m.price_info.change);
      return {
        price: Number.isFinite(price) ? price : null,
        change: Number.isFinite(change) ? change : null,
        // bitpin already quotes this market in Toman.
        unitScale: 1,
      };
    },
  },

  /**
   * Runs in the page (serialized, so it must be self-contained).
   * Tags the two elements we read so they can be screenshotted afterwards.
   */
  probeInPage({ coin }) {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    // This probe runs many times per page load; clear earlier tags first so a
    // screenshot selector can never match more than one element.
    document.querySelectorAll('[data-monitor],[data-probe]').forEach((el) => {
      el.removeAttribute('data-monitor');
      el.removeAttribute('data-probe');
    });
    const digits = (s) =>
      String(s || '')
        .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const num = (s) => {
      const n = Number(digits(s).replace(/[^\d.]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    const rows = [...document.querySelectorAll('tr')]
      .map((tr) => {
        const tds = [...tr.querySelectorAll('td')];
        const m = norm(tr.innerText).match(/^([A-Z0-9]+)\s*\/\s*IRT/);
        if (!m) return null;
        return {
          code: m[1],
          price: tds[1] ? norm(tds[1].innerText) : '',
          el: tr,
        };
      })
      .filter(Boolean);

    const row = rows.find((r) => r.code === coin) || null;
    if (row) {
      row.el.dataset.monitor = 'row';
      row.el.dataset.probe = 'row';
    }

    const links = [...document.querySelectorAll(`a[href="/coin/${coin}/"]`)];
    const tel =
      links.find((a) => String(a.className).includes('basis-80')) ||
      links.find((a) => /\(.*\)/.test(norm(a.innerText))) ||
      null;

    let tickerRaw = null;
    if (tel) {
      tel.dataset.monitor = 'ticker';
      tel.dataset.probe = 'ticker';
      const leaves = [...tel.querySelectorAll('span')]
        .filter((s) => !s.querySelector('span'))
        .map((s) => norm(s.textContent))
        .filter(Boolean);
      const hasDigit = (s) => /[۰-۹0-9]/.test(s);
      const isSigned = (s) => /^[+\-−]/.test(s.trim());
      // The price is the numeric span that is not a signed change.
      tickerRaw = leaves.find((s) => hasDigit(s) && !isSigned(s)) || null;
      if (tickerRaw == null) {
        const full = norm(tel.innerText);
        const paren = full.match(/\(([^)]*)\)/);
        const outside = full.replace(/\([^)]*\) */g, '').trim();
        const tail = outside.match(/([\d۰-۹][\d.,٬\s]*)\s*$/);
        const parenValue = paren ? norm(paren[1]) : null;
        if (tail) tickerRaw = norm(tail[1]);
        else if (parenValue && !isSigned(parenValue)) tickerRaw = parenValue;
      }
    }

    return {
      ready: !!row,
      feedLive: rows.some((r) => r.code !== coin && num(r.price) > 0),
      probes: [
        { key: 'row', label: 'جدول بازار', raw: row ? row.price : null, primary: true },
        { key: 'ticker', label: 'نوار قیمت', raw: tickerRaw, primary: false },
      ],
      shots: [
        { key: 'row', label: 'ردیف تتر در جدول بازار' },
        { key: 'ticker', label: 'تتر در نوار قیمت' },
      ],
    };
  },
};