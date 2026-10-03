'use strict';

const config = require('./config');
const { EXCHANGES } = require('./exchanges');

/**
 * In-memory ring buffer of checks, kept per exchange, plus the derived
 * statistics a regulator cares about: compliance rate, violation count and
 * when the last violation happened.
 */
class ExchangeStore {
  constructor(id) {
    this.id = id;
    this.history = [];
    this.totalChecks = 0;
    this.compliantChecks = 0;
    this.violationChecks = 0;
    this.unknownChecks = 0;
    this.consecutiveCompliant = 0;
    this.consecutiveViolations = 0;
    this.currentState = null;
    this.currentStateSince = null;
    this.lastViolationAt = null;
    this.lastViolationPrice = null;
    this.durations = [];
  }

  add(report) {
    this.history.push({
      checkedAt: report.checkedAt,
      exchangeId: report.exchangeId,
      state: report.state,
      priceVisible: report.priceVisible,
      price: report.price ? report.price.value : null,
      flash: !!(report.flashNote),
      durationMs: report.durationMs,
    });
    if (this.history.length > config.historyLimit) {
      this.history.splice(0, this.history.length - config.historyLimit);
    }

    this.totalChecks += 1;
    this.durations.push(report.durationMs);
    if (this.durations.length > 100) this.durations.shift();

    if (report.state === 'compliant') this.compliantChecks += 1;
    else if (report.state === 'violation') this.violationChecks += 1;
    else this.unknownChecks += 1;

    this.consecutiveCompliant = report.state === 'compliant' ? this.consecutiveCompliant + 1 : 0;
    this.consecutiveViolations = report.state === 'violation' ? this.consecutiveViolations + 1 : 0;

    if (this.currentState !== report.state) {
      this.currentState = report.state;
      this.currentStateSince = report.checkedAt;
    }

    if (report.state === 'violation') {
      this.lastViolationAt = report.checkedAt;
      this.lastViolationPrice = report.price ? report.price.value : null;
    }
  }

  stats() {
    const decided = this.compliantChecks + this.violationChecks;
    return {
      exchangeId: this.id,
      totalChecks: this.totalChecks,
      compliantChecks: this.compliantChecks,
      violationChecks: this.violationChecks,
      unknownChecks: this.unknownChecks,
      // "unknown" is never counted as a pass.
      compliancePercent: decided ? (this.compliantChecks / decided) * 100 : null,
      decidedChecks: decided,
      consecutiveCompliant: this.consecutiveCompliant,
      consecutiveViolations: this.consecutiveViolations,
      currentState: this.currentState,
      currentStateSince: this.currentStateSince,
      lastViolationAt: this.lastViolationAt,
      lastViolationPrice: this.lastViolationPrice,
      avgDurationMs: this.durations.length
        ? this.durations.reduce((a, b) => a + b, 0) / this.durations.length
        : null,
    };
  }

  recent(limit = 30) {
    return this.history.slice(-limit).reverse();
  }

  contextSince() {
    return this.currentStateSince;
  }

  toJSON() {
    return {
      id: this.id,
      history: this.history,
      totalChecks: this.totalChecks,
      compliantChecks: this.compliantChecks,
      violationChecks: this.violationChecks,
      unknownChecks: this.unknownChecks,
      consecutiveCompliant: this.consecutiveCompliant,
      consecutiveViolations: this.consecutiveViolations,
      currentState: this.currentState,
      currentStateSince: this.currentStateSince,
      lastViolationAt: this.lastViolationAt,
      lastViolationPrice: this.lastViolationPrice,
      durations: this.durations,
    };
  }

  restore(json) {
    if (!json || json.id !== this.id) return false;
    this.history = Array.isArray(json.history)
      ? json.history.slice(-config.historyLimit)
      : [];
    this.totalChecks = Number(json.totalChecks) || 0;
    this.compliantChecks = Number(json.compliantChecks) || 0;
    this.violationChecks = Number(json.violationChecks) || 0;
    this.unknownChecks = Number(json.unknownChecks) || 0;
    this.consecutiveCompliant = Number(json.consecutiveCompliant) || 0;
    this.consecutiveViolations = Number(json.consecutiveViolations) || 0;
    this.currentState = json.currentState || null;
    this.currentStateSince = json.currentStateSince || null;
    this.lastViolationAt = json.lastViolationAt || null;
    this.lastViolationPrice = json.lastViolationPrice ?? null;
    this.durations = Array.isArray(json.durations) ? json.durations.slice(-100) : [];
    return true;
  }
}

class Store {
  constructor() {
    this.startedAt = new Date().toISOString();
    this.reports = new Map(); // latest report per exchange
    this.stores = new Map(EXCHANGES.map((e) => [e.id, new ExchangeStore(e.id)]));
  }

  add(report) {
    this.reports.set(report.exchangeId, report);
    const s = this.stores.get(report.exchangeId);
    if (s) s.add(report);
  }

  report(id) {
    return this.reports.get(id) || null;
  }

  store(id) {
    return this.stores.get(id);
  }

  /** Combined view across every exchange, worst state first. */
  overall() {
    const stats = [...this.stores.values()].map((s) => s.stats());
    const totalViolations = stats.reduce((a, s) => a + s.violationChecks, 0);
    const lastViolationAt = stats
      .map((s) => s.lastViolationAt)
      .filter(Boolean)
      .sort()
      .pop() || null;

    const decided = stats.reduce((a, s) => a + s.decidedChecks, 0);
    const compliant = stats.reduce((a, s) => a + s.compliantChecks, 0);

    let state = 'compliant';
    if (stats.some((s) => s.currentState === 'violation')) state = 'violation';
    else if (stats.some((s) => s.currentState === 'unknown')) state = 'unknown';

    return {
      startedAt: this.startedAt,
      state,
      totalChecks: stats.reduce((a, s) => a + s.totalChecks, 0),
      totalViolations,
      compliancePercent: decided ? (compliant / decided) * 100 : null,
      decidedChecks: decided,
      lastViolationAt,
      exchangeCount: stats.length,
    };
  }

  /** Interleaved history across exchanges, newest first. */
  recent(limit = 40) {
    const all = [];
    for (const s of this.stores.values()) all.push(...s.history);
    return all.sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1)).slice(0, limit);
  }

  toJSON() {
    return {
      version: 1,
      startedAt: this.startedAt,
      reports: [...this.reports.entries()],
      stores: [...this.stores.values()].map((s) => s.toJSON()),
    };
  }

  /** Rebuild state saved by toJSON, e.g. the previous CI run's snapshot. */
  restore(json) {
    if (!json || json.version !== 1) return false;
    if (typeof json.startedAt === 'string') this.startedAt = json.startedAt;
    for (const [id, report] of json.reports || []) {
      if (report && typeof report === 'object' && this.stores.has(id)) {
        this.reports.set(id, report);
      }
    }
    for (const saved of json.stores || []) {
      const target = this.stores.get(saved && saved.id);
      if (target) target.restore(saved);
    }
    return true;
  }

  /**
   * Make evidence URLs relative ('shots/x.png') instead of server-rooted
   * ('/shots/x.png'). The static build serves the site under /<repo>/ on
   * GitHub Pages, where a root-relative URL would escape the site.
   */
  rewriteShotUrls() {
    for (const report of this.reports.values()) {
      if (!report || !Array.isArray(report.screenshots)) continue;
      for (const shot of report.screenshots) {
        if (shot && typeof shot.url === 'string') shot.url = shot.url.replace(/^\/+/, '');
      }
    }
  }
}

module.exports = new Store();