'use strict';

/**
 * Shared "can a user actually see this?" check.
 *
 * Text alone is not evidence: exchanges keep price values in DOM nodes that are
 * off-screen, inside `overflow:hidden` tracks, or behind `display:none`. Reading
 * such a node would report a violation no user could ever see — which is the
 * worst failure mode for a compliance monitor.
 *
 * `probeVisibility` is passed straight to `page.evaluate`, so it must stay
 * self-contained: no module scope, no imports, no outer references.
 */

/**
 * @param {{selectors: Record<string,string>}} arg  probe key -> CSS selector
 * @returns {Record<string,{found:boolean, visible:boolean, rect:object|null, reason:string}>}
 */
function probeVisibility({ selectors }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const styledVisible = (el) => {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
  };

  // An element can report display:flex and still be scrolled clean out of an
  // ancestor that clips (ramzinex's market carousel does exactly this), so walk
  // up and reject anything fully outside a clipping ancestor's box.
  const clippedAway = (el) => {
    const r = el.getBoundingClientRect();
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      const clips =
        cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.overflow === 'hidden';
      if (clips) {
        const pr = p.getBoundingClientRect();
        if (r.right <= pr.left || r.left >= pr.right || r.bottom <= pr.top || r.top >= pr.bottom) {
          return true;
        }
      }
      p = p.parentElement;
    }
    return false;
  };

  // Some exchanges present a price through a CSS blur (abantether uses
  // `blur-[6px]` behind a login prompt). The digits are still plain text in the
  // DOM, so a text scrape reads them — but nobody can read them on screen.
  // Anything blurred past BLUR_THRESHOLD counts as not displayed.
  const BLUR_THRESHOLD = 2; // px

  const blurRadius = (filter) => {
    if (!filter || filter === 'none') return 0;
    let max = 0;
    const re = /blur\(\s*([\d.]+)px\s*\)/g;
    let m;
    while ((m = re.exec(filter)) !== null) max = Math.max(max, parseFloat(m[1]));
    return max;
  };

  const blurredAway = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      // backdrop-filter blurs what sits BEHIND an element, not the element's
      // own text, so it is deliberately not treated as obfuscation.
      if (blurRadius(getComputedStyle(n).filter) >= BLUR_THRESHOLD) return true;
      n = n.parentElement;
    }
    return false;
  };

  const out = {};
  for (const key of Object.keys(selectors || {})) {
    const nodes = [...document.querySelectorAll(selectors[key])];
    if (!nodes.length) {
      out[key] = { found: false, visible: false, rect: null, reason: 'not-found' };
      continue;
    }

    let visible = false;
    let rect = null;
    let reason = 'hidden';

    for (const el of nodes) {
      if (!styledVisible(el)) { reason = 'not-rendered'; continue; }
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) { reason = 'zero-size'; continue; }
      if (blurredAway(el)) { reason = 'blurred'; continue; }
      if (clippedAway(el)) { reason = 'clipped'; continue; }
      if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) {
        reason = 'off-screen';
        continue;
      }
      visible = true;
      reason = 'visible';
      rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      break;
    }

    out[key] = { found: true, visible, rect, reason, copies: nodes.length };
  }
  return out;
}

/** Reason text shown to the operator when a price exists but cannot be seen. */
const HIDDEN_REASON_LABEL = {
  'not-found': 'پیدا نشد',
  'not-rendered': 'نمایش داده نمی‌شود',
  'zero-size': 'اندازه نمایشی ندارد',
  clipped: 'پشت بخش دیگری پنهان است',
  'off-screen': 'خارج از محدوده قابل مشاهده است',
};

module.exports = { probeVisibility, HIDDEN_REASON_LABEL };