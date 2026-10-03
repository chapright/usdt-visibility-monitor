'use strict';

/* Detail page for a single exchange. The id comes from /exchange/:id. */

/* global $, fa, num, faTime, faDateTime, relative, parseNum, escapeHtml,
   STATE_LABEL, stateFor, badgeFor, applyGlow, syncPolicy, syncInterval,
   setPill, wireTopbar, tickCountdown, renderHistoryRows */

// The id is the segment after '/exchange/', wherever the site is rooted
// (the local server serves /exchange/:id; Pages serves /<repo>/exchange/<id>/).
const segs = location.pathname.split('/').filter(Boolean);
const exchangeId =
  segs.length >= 2 && segs[segs.length - 2] === 'exchange'
    ? decodeURIComponent(segs[segs.length - 1])
    : '';

let nextAt = null;
let lastProbeSig = null;
let lastShotSig = null;

/* ---------------- rendering ---------------- */

function render(data) {
  const r = data.report;
  const st = data.stats;
  const ui = stateFor(r);

  nextAt = data.nextCheckAt;
  syncPolicy(data.policy);
  syncInterval(data.intervalMs);
  applyGlow(ui);

  setPill(
    ui,
    r.state === 'violation'
      ? 'تخلف — قیمت نمایش داده شد'
      : r.state === 'unknown'
        ? 'وضعیت نامشخص'
        : 'دستور رعایت شده است',
    data.checking
  );

  document.title = `${data.name} — پایش قیمت تتر`;

  const hero = $('hero');
  hero.dataset.state = data.checking && !r ? 'loading' : ui;

  $('heroTitle').textContent = r ? r.title : 'در انتظار اولین بررسی…';
  $('heroDesc').textContent = r ? r.description : 'لطفاً چند لحظه صبر کنید تا این صرافی بررسی شود.';
  $('heroBadge').textContent = badgeFor(r);

  // The price block renders only in the violation state. The unit comes from
  // the exchange, because not every site quotes in Toman.
  const priceBox = $('priceBox');
  if (r && r.priceVisible && r.price) {
    priceBox.hidden = false;
    $('priceValue').textContent = r.price.formatted;
    $('priceUnit').textContent = r.price.unit || 'تومان';
  } else {
    priceBox.hidden = true;
  }

  const flash = $('flashNote');
  if (r && r.flashNote) {
    flash.hidden = false;
    $('flashText').textContent = r.flashNote;
  } else {
    flash.hidden = true;
  }

  $('metaName').textContent = data.name;
  $('metaHost').textContent = data.host;
  $('metaChecked').textContent = r ? `${faDateTime(r.checkedAt)} (${relative(r.checkedAt)})` : '—';
  tickCountdown(nextAt);

  renderStats(st);
  renderProbes(r);
  renderShots(r);
  renderHistoryRows(data.history || [], null);
}

function renderStats(st) {
  const rate = st.compliancePercent;
  const rateEl = $('statCompliance');
  if (rate == null) {
    rateEl.textContent = '—';
    rateEl.className = 'stat-value';
  } else {
    rateEl.textContent = fa(rate.toFixed(1)) + '٪';
    rateEl.className = 'stat-value ' + (rate >= 99 ? 'ok' : rate > 0 ? 'warn' : 'bad');
  }
  $('statComplianceHint').textContent =
    `${fa(st.compliantChecks)} رعایت • ${fa(st.violationChecks)} تخلف • ${fa(st.unknownChecks)} نامشخص`;

  const v = $('statViolations');
  v.textContent = st.violationChecks ? fa(st.violationChecks) : 'بدون تخلف';
  v.className = 'stat-value ' + (st.violationChecks ? 'bad' : 'ok');
  $('statViolationsHint').textContent = st.currentStateSince
    ? `وضعیت فعلی از ${relative(st.currentStateSince)} است`
    : '—';

  const lv = $('statLastViolation');
  if (st.lastViolationAt) {
    lv.textContent = relative(st.lastViolationAt);
    lv.className = 'stat-value bad';
    $('statLastViolationHint').textContent = `در ${faDateTime(st.lastViolationAt)}`;
  } else {
    lv.textContent = 'ثبت نشده';
    lv.className = 'stat-value ok';
    $('statLastViolationHint').textContent = 'تا این لحظه هیچ تخلفی مشاهده نشده است';
  }

  $('statDuration').textContent =
    st.avgDurationMs != null ? `${fa((st.avgDurationMs / 1000).toFixed(1))} ثانیه` : '—';
}

/** Every place on the page where the price could have appeared. */
function renderProbes(r) {
  const list = $('probeList');
  const tag = $('probeTag');

  // Only rebuild when something changed — the page polls every few seconds and
  // rewriting unchanged DOM causes flicker.
  const sig = JSON.stringify([r && r.checkedAt, r && r.detail, r && r.api, r && r.probes]);
  if (sig === lastProbeSig) return;
  lastProbeSig = sig;

  if (!r || !Object.keys(r.probes || {}).length) {
    list.innerHTML = '<p class="ex-desc">هنوز داده‌ای برای نمایش وجود ندارد.</p>';
    tag.textContent = '—';
    $('detailNote').textContent = '—';
    return;
  }

  const rows = Object.entries(r.probes).map(([key, p]) => {
    const n = parseNum(p.raw);
    // A price that exists in the DOM but is off-screen or clipped is neither a
    // violation nor clean compliance — mark it so the operator can see why.
    const hiddenPrice = n > 0 && p.visible === false;
    const cls = hiddenPrice ? 'warn' : n > 0 ? 'ok' : p.raw == null || p.raw === '' ? 'dim' : 'hidden';
    const shown = hiddenPrice ? num(n) : n > 0 ? num(n) : p.raw == null || p.raw === '' ? 'خالی' : `«${escapeHtml(p.raw)}»`;
    const note = hiddenPrice ? ' <span class="vis-note">در صفحه هست ولی دیده نمی‌شود</span>' : '';
    return `<div class="ex-probe">
      <span class="ex-probe-k">${escapeHtml(p.label)}</span>
      <span class="ex-probe-v ${cls} mono">${shown}${note}</span>
    </div>`;
  });

  const api = r.api && r.api.price
    ? `<div class="ex-probe ex-api">
        <span class="ex-probe-k">قیمت در API عمومی صرافی</span>
        <span class="ex-probe-v warn mono">${num(r.api.price)} تومان</span>
      </div>`
    : '';

  list.innerHTML = rows.join('') + api;
  tag.textContent = `${fa(Object.keys(r.probes).length)} محل بررسی شد`;
  $('detailNote').textContent = r.detail || '—';
}

function renderShots(r) {
  const panel = $('shotPanel');
  const shots = (r && r.screenshots) || [];

  const sig = JSON.stringify(shots.map((s) => s.url));
  if (sig === lastShotSig) return;
  lastShotSig = sig;

  if (!shots.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const v = Date.parse(r.checkedAt) || 0;
  $('shotList').innerHTML = shots
    .map(
      (s) => `<div class="shot">
        <span class="shot-label">${escapeHtml(s.label)}</span>
        <img src="${escapeHtml(s.url)}?v=${v}" alt="${escapeHtml(s.label)}" />
      </div>`
    )
    .join('');
  $('shotTag').textContent = `ثبت‌شده در ${faTime(r.checkedAt)}`;
}

/* ---------------- data loop ---------------- */

async function load() {
  if (!exchangeId) return;
  try {
    const res = await api.exchange(exchangeId, 40);
    if (!res.ok) return;
    render(await res.json());
  } catch {
    /* server restarting */
  }
}

wireTopbar({
  onRefresh: async () => {
    // Scoped to this exchange — the other exchanges are left alone.
    await api.checkOne(exchangeId);
    await load();
  },
});

const POLL_MS = STATIC_MODE ? 30000 : 5000;

load();
setInterval(load, POLL_MS);
setInterval(() => tickCountdown(nextAt), 1000);