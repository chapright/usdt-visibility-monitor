'use strict';

/* Overview page: current status of every exchange under surveillance. */

/* global fa, num, faDateTime, relative, escapeHtml, STATE_LABEL, stateFor,
   badgeFor, applyGlow, syncPolicy, syncInterval, setPill, wireTopbar,
   tickCountdown, renderHistoryRows */

let nextAt = null;
let lastExchangeSig = null;
const names = {};

/* ---------------- rendering ---------------- */

function renderStatus(s) {
  nextAt = s.nextCheckAt;
  syncPolicy(s.policy);
  syncInterval(s.intervalMs);

  const overall = s.overall || {};
  const ui = stateFor({ state: overall.state });

  const hero = $('hero');
  const loading = s.checking && !overall.totalChecks;
  hero.dataset.state = loading ? 'loading' : ui;
  applyGlow(loading ? 'unknown' : ui);

  setPill(
    ui,
    overall.state === 'violation'
      ? 'تخلف در یکی از صرافی‌ها'
      : overall.state === 'unknown'
        ? 'وضعیت نامشخص'
        : 'دستور در همه صرافی‌ها رعایت شده است',
    s.checking
  );

  const titles = {
    compliant: 'دستور حذف قیمت تتر در همه صرافی‌ها رعایت شده است',
    violation: 'تخلف: قیمت تتر در دست‌کم یک صرافی نمایش داده می‌شود',
    unknown: 'وضعیت دست‌کم یک صرافی نامشخص است',
  };
  $('heroTitle').textContent = titles[overall.state] || 'در حال بررسی…';
  $('heroDesc').textContent =
    overall.state === 'violation'
      ? 'یکی از صرافی‌های تحت نظارت قیمت تتر را روی صفحه نشان می‌دهد. برای دیدن جزئیات، وارد کارت همان صرافی شوید.'
      : `قیمت تتر در هر ${fa(s.exchanges.length)} صرافی تحت نظارت از صفحه حذف شده است.`;
  $('heroBadge').textContent = STATE_LABEL[overall.state] || '—';

  const newest = s.exchanges
    .map((e) => e.report)
    .filter(Boolean)
    .sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1))[0];
  $('metaChecked').textContent = newest
    ? `${faDateTime(newest.checkedAt)} (${relative(newest.checkedAt)})`
    : '—';
  $('metaCount').textContent = s.exchanges.map((e) => e.name).join('، ');
  tickCountdown(nextAt);

  renderStats(overall, s.exchanges);
  renderExchanges(s.exchanges);
}

function renderStats(overall, exchanges) {
  const rate = overall.compliancePercent;
  const rateEl = $('statCompliance');
  if (rate == null) {
    rateEl.textContent = '—';
    rateEl.className = 'stat-value';
  } else {
    rateEl.textContent = fa(rate.toFixed(1)) + '٪';
    rateEl.className = 'stat-value ' + (rate >= 99 ? 'ok' : rate > 0 ? 'warn' : 'bad');
  }
  $('statComplianceHint').textContent = overall.startedAt
    ? `از ${faDateTime(overall.startedAt)} • ${fa(overall.decidedChecks || 0)} بررسی قطعی`
    : '—';

  const v = overall.totalViolations || 0;
  const vEl = $('statViolations');
  vEl.textContent = v ? fa(v) : 'بدون تخلف';
  vEl.className = 'stat-value ' + (v ? 'bad' : 'ok');
  const offenders = exchanges.filter((e) => e.stats.violationChecks > 0).map((e) => e.name);
  $('statViolationsHint').textContent = offenders.length
    ? `صرافی‌های دارای تخلف: ${offenders.join('، ')}`
    : '—';

  const lv = $('statLastViolation');
  if (overall.lastViolationAt) {
    lv.textContent = relative(overall.lastViolationAt);
    lv.className = 'stat-value bad';
    $('statLastViolationHint').textContent = `در ${faDateTime(overall.lastViolationAt)}`;
  } else {
    lv.textContent = 'ثبت نشده';
    lv.className = 'stat-value ok';
    $('statLastViolationHint').textContent = 'تا این لحظه هیچ تخلفی مشاهده نشده است';
  }

  $('statTotal').textContent = fa(overall.totalChecks || 0);
  const sum = (k) => exchanges.reduce((a, e) => a + (e.stats[k] || 0), 0);
  $('statSplit').textContent =
    `${fa(sum('compliantChecks'))} رعایت • ${fa(sum('violationChecks'))} تخلف • ${fa(sum('unknownChecks'))} نامشخص`;
}

/** One compact, clickable card per exchange. */
function renderExchanges(exchanges) {
  for (const ex of exchanges) names[ex.id] = ex.name;

  // The page re-renders every few seconds, but the cards are links. Rewriting
  // them unconditionally would pull a card out from under the pointer if the
  // user happened to be hovering or clicking, so only touch the DOM when the
  // rendered content actually differs.
  const sig = JSON.stringify(
    exchanges.map((e) => {
      const r = e.report;
      return [e.id, e.host, r && r.checkedAt, r && r.state, r && r.priceVisible, !!(r && r.flashNote)];
    })
  );
  if (sig === lastExchangeSig) return;
  lastExchangeSig = sig;

  $('exchangeList').innerHTML = exchanges.map((ex) => {
    names[ex.id] = ex.name;
    const r = ex.report;
    if (!r) {
      return `<a class="ex-card" data-state="unknown" href="exchange/${encodeURIComponent(ex.id)}/">
        <div class="ex-head">
          <div class="ex-id"><h3>${escapeHtml(ex.name)}</h3><span class="ex-host">${escapeHtml(ex.host)}</span></div>
          <span class="badge warn">در انتظار بررسی</span>
        </div>
      </a>`;
    }

    const ui = stateFor(r);
    // A price is only ever shown when there is a violation; otherwise it is
    // hidden. The unit comes from the exchange (not every site uses Toman).
    const priceRow = r.priceVisible && r.price
      ? `<span class="ex-card-price bad">${escapeHtml(r.price.formatted)} ${escapeHtml(r.price.unit || 'تومان')}</span>`
      : `<span class="ex-card-price hidden">قیمت پنهان است</span>`;

    const flash = r.flashNote
      ? `<span class="flash-tag">نمایش لحظه‌ای هنگام بارگذاری</span>`
      : '';

    return `<a class="ex-card" data-state="${ui}" href="exchange/${encodeURIComponent(ex.id)}/">
      <div class="ex-head">
        <div class="ex-id"><h3>${escapeHtml(ex.name)}</h3><span class="ex-host">${escapeHtml(ex.host)}</span></div>
        <span class="badge ${ui}">${escapeHtml(badgeFor(r))}</span>
      </div>
      <p class="ex-desc">${escapeHtml(r.title)}</p>
      <div class="ex-card-foot">
        ${priceRow}
        ${flash}
        <span class="ex-more">جزئیات</span>
      </div>
    </a>`;
  }).join('');
}

async function renderHistory() {
  try {
    const res = await api.history(15);
    const data = await res.json();
    renderHistoryRows(data.entries || [], (e) => names[e.exchangeId] || e.exchangeId);
  } catch {
    /* ignore transient network errors */
  }
}

/* ---------------- data loop ---------------- */

async function load() {
  try {
    const res = await api.status();
    renderStatus(await res.json());
  } catch {
    /* server restarting */
  }
}

wireTopbar({
  onRefresh: async () => {
    await api.check();
    await load();
    await renderHistory();
  },
});

const POLL_MS = STATIC_MODE ? 30000 : 5000;
const HISTORY_POLL_MS = STATIC_MODE ? 60000 : 15000;

load();
renderHistory();
setInterval(load, POLL_MS);
setInterval(() => tickCountdown(nextAt), 1000);
setInterval(renderHistory, HISTORY_POLL_MS);