'use strict';

const { toLatinDigits, toPersianDigits, formatMoney, formatPercent } = require('./persian');

/**
 * The platforms under watch have been instructed to stop displaying this price.
 *
 * So a hidden price is the CORRECT, expected outcome, and a price that is still
 * on screen is a VIOLATION. This module turns a raw page read into that verdict.
 */

/* ------------------------------------------------------------------ *
 * Reading a value out of the page
 * ------------------------------------------------------------------ */

/**
 * Decide whether a raw string is a real price. A dash, "---", a zero, an empty
 * cell or unreadable text all mean "no price shown".
 */
function classifyValue(raw) {
  if (raw === null || raw === undefined) {
    return { ok: false, code: 'absent', value: null, raw: '' };
  }
  const text = String(raw).replace(/\s+/g, ' ').trim();
  if (text === '') return { ok: false, code: 'empty', value: null, raw: text };
  if (/^[-–—_.،,٫\s]+$/.test(text)) {
    return { ok: false, code: 'placeholder', value: null, raw: text };
  }
  if (/^-{2,}$/.test(text)) {
    return { ok: false, code: 'placeholder', value: null, raw: text };
  }

  const latin = toLatinDigits(text).trim();
  if (/^[-−]/.test(latin)) return { ok: false, code: 'negative', value: null, raw: text };

  const digits = latin.replace(/[,\s٬]/g, '');
  const numeric = digits.replace(/[^\d.]/g, '');
  if (numeric === '') return { ok: false, code: 'unparseable', value: null, raw: text };

  const value = Number(numeric);
  if (!Number.isFinite(value)) return { ok: false, code: 'unparseable', value: null, raw: text };
  if (value < 0) return { ok: false, code: 'negative', value: null, raw: text };
  if (value === 0) return { ok: false, code: 'zero', value: null, raw: text };
  return { ok: true, code: 'ok', value, raw: text };
}

/* ------------------------------------------------------------------ *
 * Labels
 * ------------------------------------------------------------------ */

const REASON_LABEL = {
  placeholder: 'نمایش خط تیره به‌جای عدد',
  zero: 'نمایش صفر به‌جای قیمت',
  empty: 'قیمت خالی است',
  unparseable: 'مقدار نامعتبر',
  negative: 'مقدار منفی',
  absent: 'محل قیمت پیدا نشد',
  unreachable: 'سایت در دسترس نبود',
  feed_stalled: 'صفحه کامل بارگذاری نشد',
  error: 'خطا در بررسی',
};

const POLICY_LABEL = {
  hidden: 'پنهان بودن قیمت',
  shown: 'نمایش قیمت',
};

function buildDetail(probes) {
  return Object.entries(probes || {})
    .map(([key, p]) => `${p.label}: «${p.raw == null || p.raw === '' ? 'خالی' : p.raw}»`)
    .join(' • ');
}

/** "۲ دقیقه" — how long the current state has held. */
function durationPhrase(from, now) {
  if (!from) return null;
  const mins = Math.floor((now - new Date(from).getTime()) / 60000);
  if (mins < 1) return 'کمتر از یک دقیقه';
  if (mins < 60) return `${toPersianDigits(mins)} دقیقه`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${toPersianDigits(hours)} ساعت و ${toPersianDigits(mins % 60)} دقیقه`;
  return `${toPersianDigits(Math.floor(hours / 24))} روز`;
}

/** The note about a price that was visible while the page was still rendering. */
function flashNote(flashed) {
  if (!flashed || !flashed.detected) return null;
  const secs = Math.max(1, Math.round((flashed.durationMs || 0) / 1000));
  const parsed = classifyValue(flashed.price);
  const value = parsed.ok ? ` (${formatMoney(parsed.value)} تومان)` : '';
  return `قیمت تتر در ابتدای بارگذاری صفحه${value} حدود ${toPersianDigits(secs)} ثانیه نمایش داده شد و پس از کامل شدن بارگذاری حذف شد.`;
}

/* ------------------------------------------------------------------ *
 * Observation -> judgement
 * ------------------------------------------------------------------ */

/**
 * @param {object} scrape  result of scrapeExchange() for one exchange
 * @param {object} api     cross-check from that exchange's public feed
 * @param {string} expect  policy: 'hidden' | 'shown'
 * @param {object} context { since } — when the current state began
 * @param {string} unitLabel  currency the page itself quotes in ('تومان' / 'ریال')
 */
function buildReport({ scrape, api, expect = 'hidden', context = {}, unitLabel = 'تومان' }) {
  const at = new Date().toISOString();
  const now = Date.parse(at);
  const policy = { expect, label: POLICY_LABEL[expect] || expect };
  const base = {
    checkedAt: at,
    policy,
    exchangeId: scrape ? scrape.exchangeId : null,
    priceVisible: false,
    state: 'unknown',
    durationMs: (scrape && scrape.durationMs) || 0,
    flashNote: flashNote(scrape && scrape.flashed),
  };

  /* ---- could not read the page ---- */
  if (!scrape || scrape.navError) {
    return {
      ...base,
      reasonCode: 'unreachable',
      reasonLabel: REASON_LABEL.unreachable,
      title: 'وضعیت نامشخص',
      description: 'صفحه باز نشد.',
      detail: (scrape && scrape.navError) || 'خطای نامشخص',
      price: null,
      probes: {},
      api,
    };
  }

  if (!scrape.ready) {
    return {
      ...base,
      reasonCode: 'feed_stalled',
      reasonLabel: REASON_LABEL.feed_stalled,
      title: 'وضعیت نامشخص',
      description: 'بخش قیمت در صفحه ظاهر نشد.',
      detail: buildDetail(scrape.probes),
      price: null,
      probes: scrape.probes,
      api,
    };
  }

  const probes = scrape.probes || {};
  const entries = Object.entries(probes).map(([key, p]) => ({ key, ...p, ...classifyValue(p.raw) }));
  // Only a price a user can SEE counts. Probes carry `visible` from the
  // scraper; absent means "unknown", which we treat as visible so older data
  // (and unit tests) keep working.
  const visibleEntry = entries.find((e) => e.ok && e.visible !== false);
  const hiddenPriceEntry = entries.find((e) => e.ok && e.visible === false);
  const primaryEntry = entries.find((e) => e.primary) || entries[0];
  const visible = !!visibleEntry;
  const compliant = expect === 'hidden' ? !visible : visible;

  /* ---- the page never finished rendering ---- */
  if (!scrape.feedLive && !visible) {
    return {
      ...base,
      reasonCode: 'feed_stalled',
      reasonLabel: REASON_LABEL.feed_stalled,
      title: 'وضعیت نامشخص',
      description: 'صفحه کامل بارگذاری نشد.',
      detail: buildDetail(probes),
      price: null,
      probes,
      api,
    };
  }

  /* ---- price is on screen ---- */
  if (visible) {
    const p = visibleEntry;
    const parts = [
      `قیمت تتر با مقدار ${formatMoney(p.value)} ${unitLabel} در صفحه نمایش داده می‌شود.`,
      `محل نمایش: ${p.label}.`,
    ];
    if (context.since) parts.push(`مدت این وضعیت: ${durationPhrase(context.since, now)}.`);

    return {
      ...base,
      priceVisible: true,
      state: compliant ? 'compliant' : 'violation',
      reasonCode: 'shown',
      reasonLabel: 'قیمت روی صفحه است',
      title:
        expect === 'hidden' ? 'تخلف: قیمت تتر نمایش داده می‌شود' : 'قیمت تتر نمایش داده می‌شود',
      badge: expect === 'hidden' ? 'تخلف' : 'مطابق انتظار',
      description: parts.join(' '),
      detail: buildDetail(probes),
      price: { value: p.value, formatted: formatMoney(p.value), source: p.label, unit: unitLabel },
      change: null,
      probes,
      api,
    };
  }

  /* ---- price is not on screen ---- */
  // Report the most specific "no price" reason we found.
  // Report why the PRIMARY (most prominent) display shows no price; fall back to
  // any other usable probe when the primary was simply missing.
  let reason = primaryEntry;
  if (!reason || reason.code === 'absent' || reason.code === 'empty') {
    reason = entries.find((e) => e.code !== 'absent' && e.code !== 'empty') || primaryEntry;
  }

  const parts = ['قیمت تتر در صفحه نمایش داده نمی‌شود.'];
  // When the primary still parses as a real price, the "sign" is not an error
  // at all — it is a price that is present but hidden, which the specific note
  // below explains far better than a generic reason label would.
  if (reason.code !== 'ok') {
    // A slot that exists but says nothing is different from a missing one.
    if (reason.emptyText) {
      parts.push(`وضعیت این بخش: «${reason.emptyText}»`);
    } else {
      parts.push(`نشانه: ${REASON_LABEL[reason.code] || REASON_LABEL.unparseable}.`);
    }
  }
  // A price can sit in the DOM off-screen, clipped away, or deliberately
  // blurred. None of those is a breach, but each deserves to be said plainly
  // rather than passing silently.
  if (hiddenPriceEntry) {
    const where = `«${hiddenPriceEntry.label}» مقدار ${formatMoney(hiddenPriceEntry.value)}`;
    const reason = hiddenPriceEntry.reason;
    if (reason === 'blurred') {
      parts.push(
        `توجه: در ${where} وجود دارد، اما عمداً محو و ناخوانا نمایش داده شده و برای کاربر قابل خواندن نیست.`
      );
    } else if (reason === 'not-rendered' || reason === 'zero-size') {
      parts.push(
        `توجه: در ${where} وجود دارد، اما این بخش در صفحه نمایش داده نمی‌شود (با display:none مخفی شده است).`
      );
    } else {
      parts.push(
        `توجه: در ${where} وجود دارد، اما این بخش برای کاربر قابل مشاهده نیست (خارج از محدوده نمایش یا پشت بخش دیگری).`
      );
    }
  }
  if (api && api.price) parts.push('قیمت همچنان در API عمومی صرافی در دسترس است.');
  if (context.since) parts.push(`مدت این وضعیت: ${durationPhrase(context.since, now)}.`);

  return {
    ...base,
    priceVisible: false,
    state: compliant ? 'compliant' : 'violation',
    reasonCode: 'hidden',
    reasonLabel: REASON_LABEL[reason.code] || REASON_LABEL.unparseable,
    title:
      expect === 'hidden'
        ? 'دستور حذف قیمت تتر رعایت شده است'
        : 'تخلف: قیمت تتر نمایش داده نمی‌شود',
    badge: expect === 'hidden' ? 'رعایت شده' : 'تخلف',
    description: parts.join(' '),
    detail: buildDetail(probes),
    price: null,
    change: null,
    probes,
    api,
  };
}

function parseChange(raw) {
  if (!raw) return null;
  const digits = toLatinDigits(raw).replace(/[^\d.]/g, '');
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return { value: n, formatted: formatPercent(n), raw };
}

module.exports = { buildReport, classifyValue };