'use strict';

/**
 * Shared between the overview page and the per-exchange detail pages.
 * Persian formatting, state mapping, and the top bar wiring both pages need.
 */

const FA = '۰۱۲۳۴۵۶۷۸۹';
const fa = (s) => String(s).replace(/[0-9]/g, (d) => FA[Number(d)]);
const num = (n) => fa(Math.round(n).toLocaleString('en-US'));

const $ = (id) => document.getElementById(id);

/* ---------------- deployment mode ---------------- */

// The committed default runs against the local Express server. The CI build
// overwrites config-site.js to flip the pages into static mode, where they
// read the data/*.json files published by scripts/run-once.js instead of the
// live /api/* endpoints.
const STATIC_MODE = window.MONITOR_STATIC === true;

// Static mode appends a cache-buster because GitHub Pages caches aggressively
// (max-age=600) and the data changes on every workflow run.
const api = {
  status: () =>
    fetch(STATIC_MODE ? `data/status.json?t=${Date.now()}` : '/api/status'),
  history: (limit) =>
    fetch(STATIC_MODE ? `data/history.json?t=${Date.now()}` : `/api/history?limit=${limit}`),
  exchange: (id, limit) =>
    fetch(
      STATIC_MODE
        ? `data/exchange/${encodeURIComponent(id)}.json?t=${Date.now()}`
        : `/api/exchange/${encodeURIComponent(id)}?limit=${limit}`
    ),
  check: () => fetch('/api/check', { method: 'POST' }),
  checkOne: (id) => fetch(`/api/check/${encodeURIComponent(id)}`, { method: 'POST' }),
  interval: (seconds) =>
    fetch('/api/interval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seconds }),
    }),
};

// No server to talk to in static mode: hide the manual controls via CSS.
if (STATIC_MODE) document.documentElement.classList.add('static');

function faTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d);
}

function faDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    dateStyle: 'medium', timeStyle: 'medium',
  }).format(d);
}

function relative(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return 'همین حالا';
  if (s < 60) return `${fa(s)} ثانیه پیش`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${fa(m)} دقیقه پیش`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${fa(h)} ساعت پیش`;
  return `${fa(Math.floor(h / 24))} روز پیش`;
}

function countdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const t = Math.round(ms / 1000);
  return fa(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
}

/** Is this raw page value a real (>0) price? Mirrors the server rule. */
function parseNum(raw) {
  if (raw == null) return 0;
  const s = String(raw).replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)));
  const v = Number(s.replace(/[,\s]/g, '').replace(/[^\d.]/g, ''));
  return Number.isFinite(v) ? v : 0;
}

const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/* ---------------- state mapping ---------------- */

const STATE_UI = { compliant: 'ok', violation: 'bad', unknown: 'unknown' };
const STATE_LABEL = { compliant: 'رعایت شده', violation: 'تخلف', unknown: 'نامشخص' };
const STATE_TITLE = {
  compliant: 'رعایت دستور',
  violation: 'تخلف',
  unknown: 'نامشخص',
};

/** CSS state for a report, defaulting to 'unknown' when there is no report. */
function stateFor(report) {
  return STATE_UI[report && report.state] || 'unknown';
}

/** The report's own badge, falling back to the generic label for unknown. */
function badgeFor(report) {
  return (report && report.badge) || STATE_LABEL[(report && report.state) || 'unknown'];
}

function badgeClass(report) {
  return stateFor(report);
}

/* ---------------- top bar ---------------- */

const GLOWS = {
  ok: { id: 'glowOk', cls: 'glow-ok' },
  bad: { id: 'glowBad', cls: 'glow-bad' },
  unknown: { id: 'glowWarn', cls: 'glow-warn' },
};

/** Light the background glow that matches a CSS state. */
function applyGlow(ui) {
  for (const g of Object.values(GLOWS)) {
    const el = $(g.id);
    if (el) el.className = `glow ${g.cls}`;
  }
  const target = GLOWS[ui] || GLOWS.unknown;
  const el = $(target.id);
  if (el) el.className += ' on';
}

function syncPolicy(policy) {
  const el = $('policyLabel');
  if (!el || !policy) return;
  el.textContent = policy.expect === 'shown' ? 'نمایش قیمت' : 'پنهان بودن قیمت';
}

/** Keep the interval dropdown in step with what the server is really doing. */
function syncInterval(intervalMs) {
  if (!intervalMs) return;
  const sel = $('intervalSelect');
  if (!sel) return;
  const secs = String(Math.round(intervalMs / 1000));
  if (sel.value !== secs && [...sel.options].some((o) => o.value === secs)) sel.value = secs;
}

function setPill(ui, text, checking) {
  const pill = $('livePill');
  if (!pill) return;
  pill.dataset.state = checking ? 'loading' : ui;
  const label = $('livePillText');
  if (label) label.textContent = checking ? 'در حال بررسی…' : text;
}

/** Wire the refresh button and the interval dropdown both pages share. */
function wireTopbar({ onRefresh }) {
  // Static deployments have no API server, so the manual controls stay hidden.
  if (STATIC_MODE) return;

  const btn = $('refreshBtn');
  if (btn && onRefresh) {
    btn.addEventListener('click', async () => {
      btn.classList.add('loading');
      btn.disabled = true;
      try {
        await onRefresh();
      } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
      }
    });
  }

  const sel = $('intervalSelect');
  if (sel) {
    sel.addEventListener('change', async (e) => {
      await api.interval(Number(e.target.value));
    });
  }
}

/** Countdown to the next scheduled check, refreshed by the caller's timer. */
function tickCountdown(nextAtIso) {
  const el = $('metaNext');
  if (!el) return;
  el.textContent = nextAtIso ? countdown(new Date(nextAtIso).getTime() - Date.now()) : '—';
}

/** History rows are rendered the same way on both pages. */
function historyRow(entry, nameOf) {
  const label =
    entry.state === 'compliant' ? 'رعایت دستور' : entry.state === 'violation' ? 'تخلف' : 'نامشخص';
  const cls = entry.state === 'compliant' ? 'ok' : entry.state === 'violation' ? 'bad' : 'warn';
  const price = entry.priceVisible ? (entry.price ? num(entry.price) : '—') : 'پنهان';
  const note = entry.flash ? 'نمایش لحظه‌ای هنگام بارگذاری' : '—';
  return `
    <tr>
      <td class="num">${faTime(entry.checkedAt)}</td>
      ${nameOf ? `<td>${escapeHtml(nameOf(entry))}</td>` : ''}
      <td><span class="badge ${cls}">${label}</span></td>
      <td class="num">${price}</td>
      <td class="${entry.flash ? 'flash' : ''}">${note}</td>
    </tr>`;
}

function renderHistoryRows(entries, nameOf) {
  const tbody = $('logBody');
  const tag = $('historyTag');
  if (!entries.length) {
    tbody.innerHTML = `<tr class="empty"><td colspan="${nameOf ? 5 : 4}">هنوز بررسی‌ای انجام نشده است.</td></tr>`;
    if (tag) tag.textContent = '—';
    return;
  }
  tbody.innerHTML = entries.map((e) => historyRow(e, nameOf)).join('');
  if (tag) tag.textContent = fa(entries.length) + ' بررسی اخیر';
}