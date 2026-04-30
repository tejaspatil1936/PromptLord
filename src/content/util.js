/**
 * Shared geometry + DOM helpers used across layers. No state, no side effects.
 */

export const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
export const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/** Viewport size, preferring visualViewport so it tracks the mobile keyboard. */
export function viewport() {
  const vv = window.visualViewport;
  return {
    width: vv ? vv.width : window.innerWidth,
    height: vv ? vv.height : window.innerHeight,
  };
}

/** True when an element is rendered with non-zero size and not hidden by CSS. */
export function isVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 1 || r.height <= 1) return false;
  const st = getComputedStyle(el);
  if (st.visibility === "hidden" || st.display === "none") return false;
  return true;
}

/** True when a rect is entirely outside the viewport. */
export function isFullyOffscreen(r) {
  const { width, height } = viewport();
  return r.bottom <= 0 || r.right <= 0 || r.top >= height || r.left >= width;
}

/** Axis-aligned rectangle intersection test. */
export function intersects(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

/** Grow a rect by `px` on every side. Returns a fresh plain rect. */
export function inflate(r, px) {
  return {
    left: r.left - px,
    top: r.top - px,
    right: r.right + px,
    bottom: r.bottom + px,
    width: (r.right - r.left) + 2 * px,
    height: (r.bottom - r.top) + 2 * px,
  };
}

/** Area of the overlap between two rects (0 if they don't intersect). */
export function overlapArea(a, b) {
  const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return ox * oy;
}

/** Intersection rect of a and b, or null if they don't overlap. */
export function clipToRect(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Smallest rect enclosing all the (truthy) rects passed in. */
export function unionRect(...rects) {
  const rs = rects.filter(Boolean);
  if (rs.length === 0) return null;
  const left = Math.min(...rs.map((r) => r.left));
  const top = Math.min(...rs.map((r) => r.top));
  const right = Math.max(...rs.map((r) => r.right));
  const bottom = Math.max(...rs.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Walk up `levels` parents, returning the highest reachable ancestor. */
export function ascend(el, levels) {
  let c = el;
  for (let i = 0; i < levels && c.parentElement; i++) c = c.parentElement;
  return c;
}

/** Minimal HTML escape for safe innerHTML writes. */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
