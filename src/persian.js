'use strict';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Convert Persian (۰-۹) and Arabic-Indic (٠-٩) digits to Latin digits. */
function toLatinDigits(input) {
  if (input == null) return '';
  return String(input)
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

/** Convert Latin digits to Persian digits for display. */
function toPersianDigits(input) {
  if (input == null) return '';
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** 261578 -> "۲۶۱,۵۷۸" */
function formatMoney(value) {
  if (!Number.isFinite(value)) return '—';
  return toPersianDigits(Math.round(value).toLocaleString('en-US'));
}

/** 4.0199 -> "۴٫۰۲٪" */
function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${toPersianDigits(value.toFixed(2).replace('.', '٫'))}٪`;
}

module.exports = {
  toLatinDigits,
  toPersianDigits,
  formatMoney,
  formatPercent,
};
