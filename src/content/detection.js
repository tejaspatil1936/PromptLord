/**
 * Layer 1 — Detection. A generic scorer that picks the page's real prompt box
 * (and its send button) from all visible editables, with NO site-specific
 * selectors. Disqualifiers carry the precision and are applied first;
 * language-agnostic signals dominate the score; text matching is minor.
 *
 * Output of `detect()` / `detectFocused()` is always { input, sendButton, score,
 * runnerUp, confident } so the positioning layer gets both rects it needs.
 */
import { clamp01, clamp, isVisible, isFullyOffscreen, ascend, viewport } from "./util.js";

/** The set of elements considered prompt-box candidates. Shared so the
 *  orchestrator's dormant early-out and the scorer agree on what "an editable" is. */
export const EDITABLE_SELECTOR = 'textarea, [contenteditable="true"], [role="textbox"]';

/* ---- tunables ---- */
const WEIGHTS = { afford: 0.42, geom: 0.18, vert: 0.1, type: 0.12, text: 0.18 };
const THRESHOLD = 0.5; // absolute confidence to attach proactively
const MARGIN = 0.12; // top must beat runner-up by this much
const SOLO_THRESHOLD = 0.45; // single unambiguous candidate
const FOCUS_THRESHOLD = 0.34; // lower bar when the user is actually typing there

/* ---- text signals (minor weight) ---- */
const POS_RE = /(message|ask|prompt|reply|chat|talk|compose|write|how can i help|ask anything|type a message|send a message)/i;
const STRONG_POS_RE = /(ask anything|ask gemini|message chatgpt|message claude|talk to|type a message|send a message)/i;
const NEG_RE = /(search|find|comment|username|user name|e-?mail|password|phone|address|\burl\b|website|filter|caption|\bnote\b|\btitle\b)/i;

/* ---- send-button signals ---- */
const SEND_RE = /\b(send|submit)\b/i;
const SEND_MSG_RE = /\bsend\b.*\b(message|prompt|chat|reply)\b/i;
const NOT_SEND_RE = /(search|cancel|close|delete|remove|menu|setting|attach|file|upload|image|photo|mic|microphone|voice|record|\bstop\b|copy|share|like|emoji|format|bold|expand|collapse|scroll)/i;

const BAD_INPUT_TYPES = ["password", "email", "search", "tel", "url", "number"];

/* ---------- candidate gathering + disqualifiers ---------- */

function gatherCandidates(root) {
  return Array.from(new Set(root.querySelectorAll(EDITABLE_SELECTOR)));
}

/* ---------- composer container (used by the positioning layer) ---------- */

/** Lowest common ancestor of two elements, or null. */
function lowestCommonAncestor(a, b) {
  const seen = new Set();
  for (let n = a; n; n = n.parentElement) seen.add(n);
  for (let n = b; n; n = n.parentElement) if (seen.has(n)) return n;
  return null;
}

/**
 * The bounded composer container — the stable anchor the positioning layer
 * measures against (NOT the send button alone). It's the lowest common ancestor
 * of the input and send button, capped at `maxLevels` above the input so a
 * distant/portaled send button can't balloon it to the whole page. Falls back to
 * the enclosing form or a small ascend when there's no send button.
 */
export function findComposerContainer(input, sendButton, maxLevels = 6) {
  if (sendButton) {
    const lca = lowestCommonAncestor(input, sendButton);
    if (lca) {
      let depth = 0;
      let n = input;
      while (n && n !== lca) { n = n.parentElement; depth++; }
      if (n === lca && depth <= maxLevels) return lca;
      return ascend(input, maxLevels);
    }
  }
  return input.closest("form") || ascend(input, 3);
}

/** ≥1 visible interactive control other than send → a real cluster, not a lone wrapper. */
function hasOtherControl(row, sendButton) {
  const others = row.querySelectorAll('button, [role="button"], [aria-haspopup], a[href], select');
  for (const el of others) {
    if (el !== sendButton && !(el.dataset && el.dataset.promptlord != null) && el.getBoundingClientRect().width > 0) {
      return true;
    }
  }
  return false;
}

/**
 * A fixed-width button wrapper to climb PAST (e.g. Claude's `shrink-0 w-8` / `w-control` around
 * send): it can't make room for a wide pill, so it's never the toolbar even if it nests a control.
 * A row with gap, its own flex-grow, or a growable child can reflow → NOT a wrapper, so real
 * gap-based toolbars and growable rows are never skipped. Class-agnostic (computed style only).
 */
function isNonGrowableWrapper(row, cs, sendRect, maxWidthRatio) {
  if ((parseFloat(cs.flexGrow) || 0) > 0) return false;          // grows with its parent → real row
  if ((parseFloat(cs.columnGap || cs.gap) || 0) > 0) return false; // gap-based spacing → real row
  for (const ch of row.children) {
    if ((parseFloat(getComputedStyle(ch).flexGrow) || 0) > 0) return false; // has a grow/spacer child
  }
  if ((parseFloat(cs.flexShrink) || 0) !== 0) return false;       // shrinkable → not a fixed wrapper
  return row.getBoundingClientRect().width <= sendRect.width * maxWidthRatio; // ~send-sized → a wrapper
}

/**
 * The host's control row — the horizontal flex/grid toolbar that lays out the
 * send button alongside other controls (model picker, mic, attach). This is the
 * insertion target for the flex-child placement: dropping a sibling here lets the
 * host's own layout engine reflow and make room.
 *
 * Deliberately NULL-BIASED — returning null (→ overlay fallback) is safer than a
 * marginal insertion. Rejects an absolutely/fixed-positioned send button (no in-flow
 * row to join), an ancestor taller than ~2× the send button (the composer shell), and
 * distributed (`space-*`) rows. Climbs PAST non-growable fixed-width wrappers (Claude's
 * deeply-nested `w-8`/`w-control` around send) to reach the real growable row.
 *
 * @returns {{ row: Element, ref: Element } | null} `row` = the flex/grid container,
 *   `ref` = the child of `row` on the path to send (insert the wrapper before it).
 */
export function findControlRow(sendButton, opts = {}) {
  if (!sendButton) return null;
  const maxClimb = opts.maxClimb ?? 6;
  const maxHeightRatio = opts.maxHeightRatio ?? 2.2;
  const wrapperMaxWidthRatio = opts.wrapperMaxWidthRatio ?? 2.5;

  const sStyle = getComputedStyle(sendButton);
  if (sStyle.position === "absolute" || sStyle.position === "fixed") return null;
  const sendRect = sendButton.getBoundingClientRect();
  if (sendRect.height <= 0) return null;

  let ref = sendButton;
  for (let i = 0; i < maxClimb && ref.parentElement; i++) {
    const row = ref.parentElement;
    const cs = getComputedStyle(row);
    const disp = cs.display;
    const isFlex = disp === "flex" || disp === "inline-flex";
    const isGrid = disp === "grid" || disp === "inline-grid";

    if (isFlex || isGrid) {
      // Must be a horizontal cluster, not a vertical/column stack.
      if (isFlex && (cs.flexDirection || "row").startsWith("column")) { ref = row; continue; }
      // Distributed rows shift everything when a child is added — leave to fallback (the send-side
      // sub-cluster, e.g. Stitch's justify-end group, is reached at a lower level).
      if (/space-(between|around|evenly)/.test(cs.justifyContent || "")) { ref = row; continue; }
      // A control row is about one control tall; taller means we've reached the shell.
      if (row.getBoundingClientRect().height > sendRect.height * maxHeightRatio) return null;
      // Fixed-width non-growable wrapper around send (Claude) — climb past it even if it nests a
      // control; a wide pill can't fit here, the real growable row is higher up.
      if (isNonGrowableWrapper(row, cs, sendRect, wrapperMaxWidthRatio)) { ref = row; continue; }
      // Require at least one other interactive control → it's a real cluster.
      if (hasOtherControl(row, sendButton)) return { row, ref };
      // Lonely flex wrapper around send — climb once more to find the real toolbar.
    }
    ref = row;
  }
  return null;
}

/** Hard rejects — applied before any scoring. */
export function isDisqualified(el) {
  if (el.tagName === "INPUT" && BAD_INPUT_TYPES.includes((el.type || "").toLowerCase())) return true;
  if (el.disabled || el.getAttribute("aria-disabled") === "true") return true;
  if (el.readOnly || el.hasAttribute("readonly")) return true;
  if (el.closest('nav, header, [role="navigation"], [role="banner"]')) return true;
  if (!isVisible(el)) return true; // covers zero-size + display:none + visibility:hidden
  if (isFullyOffscreen(el.getBoundingClientRect())) return true;
  return false;
}

/* ---------- send button detection ---------- */

function labelOf(el) {
  return [
    el.getAttribute("aria-label"),
    el.getAttribute("title"),
    el.getAttribute("data-testid"),
    el.getAttribute("name"),
    el.value,
    (el.textContent || "").trim().slice(0, 40),
  ].filter(Boolean).join(" ").toLowerCase();
}

function sendLikeness(btn) {
  const label = labelOf(btn);
  if (NOT_SEND_RE.test(label) && !SEND_RE.test(label)) return 0;

  let s = 0;
  if (btn.type === "submit") s = 0.6;
  if (SEND_RE.test(label)) s = Math.max(s, 1);
  if (SEND_MSG_RE.test(label)) s = 1;

  // Icon-only square button near the input (arrow / paper-plane heuristic).
  if (s === 0) {
    const r = btn.getBoundingClientRect();
    const hasGlyph = !!btn.querySelector('svg, img, [class*="icon" i]');
    const squareish = r.width > 0 && Math.abs(r.width - r.height) <= Math.max(10, r.height * 0.6);
    if (hasGlyph && squareish && r.width <= 72) s = 0.45;
  }
  return s;
}

/** Geometric closeness of a button to the input (1 ≈ inside/adjacent, 0 ≈ far). */
function proximity(inputRect, btn) {
  const r = btn.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return 0;
  const icx = inputRect.left + inputRect.width / 2;
  const icy = inputRect.top + inputRect.height / 2;
  const bcx = r.left + r.width / 2;
  const bcy = r.top + r.height / 2;
  const dist = Math.hypot(bcx - icx, bcy - icy);
  const scale = Math.max(inputRect.width, inputRect.height, 1);
  return clamp01(1 - dist / (scale * 1.3));
}

/** Score every send-like button inside `scope`, returning the best { button, strength }. */
function searchSendIn(scope, inputRect) {
  const btns = scope
    ? scope.querySelectorAll('button, [role="button"], input[type="submit"], input[type="image"]')
    : [];

  let best = null;
  let bestStrength = 0;
  let i = 0;
  for (const btn of btns) {
    if (++i > 80) break; // bound cost on pathological pages
    if (btn.dataset && btn.dataset.promptlord) continue; // never our own button
    const like = sendLikeness(btn);
    if (like <= 0) continue;
    const prox = proximity(inputRect, btn);
    if (prox <= 0) continue;
    const strength = like * prox;
    if (strength > bestStrength) {
      bestStrength = strength;
      best = btn;
    }
  }
  return { button: best, strength: bestStrength };
}

/**
 * Find the best send button paired with `input`. Returns { button, strength }
 * where strength (0..1) feeds the highest-weighted signal. Honors an adapter
 * `send` selector override when supplied.
 */
function findSendButton(input, adapter) {
  const inputRect = input.getBoundingClientRect();

  if (adapter?.send) {
    const scope = adapter.container ? document.querySelector(adapter.container) : document;
    const btn = scope?.querySelector(adapter.send);
    if (btn && isVisible(btn)) return { button: btn, strength: 1 };
  }

  // Tight scope first (cheap, precise). Widen only on a MISS — some composers (Gemini) nest the send
  // button in a sibling subtree above the input, beyond the form / ascend(4) scope, so the close
  // search finds nothing. Proximity weighting keeps the wider search from grabbing a distant button.
  let result = searchSendIn(input.closest("form") || ascend(input, 4), inputRect);
  if (!result.button) result = searchSendIn(ascend(input, 8), inputRect);
  return result;
}

/** Public: find the send button paired with a given input (for memory hits). */
export function resolveSend(input, adapter) {
  return findSendButton(input, adapter).button;
}

/* ---------- per-signal scoring ---------- */

function geometryScore(rect) {
  const { width } = viewport();
  const target = Math.min(width, 900);
  const wScore = clamp01((rect.width - 120) / (target - 120));
  const hScore = rect.height >= 40 ? 1 : clamp01((rect.height - 20) / 20);
  let geom = 0.5 * wScore + 0.5 * hScore;
  if (rect.width < 180) geom *= 0.5; // penalize narrow boxes
  return clamp01(geom);
}

function verticalScore(rect) {
  const { height } = viewport();
  const cy = rect.top + rect.height / 2;
  return clamp01(cy / height); // lower in viewport → closer to 1 (soft)
}

function typeScore(el) {
  if (el.tagName === "TEXTAREA") return 1;
  if (el.getAttribute("contenteditable") === "true" || el.isContentEditable) return 0.95;
  return 0.5; // bare role=textbox
}

function textScore(el) {
  const t = [
    el.getAttribute("placeholder"),
    el.getAttribute("data-placeholder"),
    el.getAttribute("aria-label"),
    el.getAttribute("title"),
  ].filter(Boolean).join(" ");
  if (!t) return 0;
  let s = 0;
  if (POS_RE.test(t)) s += 0.7;
  if (STRONG_POS_RE.test(t)) s = 1;
  if (NEG_RE.test(t)) s -= 1;
  return clamp(s, -1, 1);
}

/** Score one candidate; returns the breakdown plus the paired send button. */
function scoreCandidate(el, adapter) {
  const rect = el.getBoundingClientRect();
  const send = findSendButton(el, adapter);
  const parts = {
    afford: send.strength,
    geom: geometryScore(rect),
    vert: verticalScore(rect),
    type: typeScore(el),
    text: textScore(el),
  };
  const score =
    WEIGHTS.afford * parts.afford +
    WEIGHTS.geom * parts.geom +
    WEIGHTS.vert * parts.vert +
    WEIGHTS.type * parts.type +
    WEIGHTS.text * parts.text; // text can be negative → pushes below threshold
  return { input: el, sendButton: send.button, score, parts };
}

/* ---------- public API ---------- */

/**
 * Run full detection over the document (optionally scoped/overridden by an
 * adapter). Returns the best candidate with confidence, or null if there is
 * nothing worth attaching to yet.
 */
export function detect(adapter) {
  // Adapter hard override: a forced input selector skips scoring entirely.
  if (adapter?.input) {
    const scope = adapter.container ? document.querySelector(adapter.container) : document;
    const el = scope?.querySelector(adapter.input);
    if (el && isVisible(el) && !isDisqualified(el)) {
      const send = findSendButton(el, adapter);
      return { input: el, sendButton: send.button, score: 1, runnerUp: 0, confident: true };
    }
  }

  const root = adapter?.container ? document.querySelector(adapter.container) || document : document;
  const candidates = gatherCandidates(root).filter((el) => !isDisqualified(el));
  if (candidates.length === 0) return null;

  const scored = candidates.map((el) => scoreCandidate(el, adapter)).sort((a, b) => b.score - a.score);
  const top = scored[0];
  const runnerUp = scored[1] ? scored[1].score : 0;

  const confident =
    scored.length === 1
      ? top.score >= SOLO_THRESHOLD
      : top.score >= THRESHOLD && top.score - runnerUp >= MARGIN;

  return { input: top.input, sendButton: top.sendButton, score: top.score, runnerUp, confident };
}

/**
 * Focus-as-ground-truth tiebreaker. If the user focused a valid editable, accept
 * it under a lower threshold — observing where they type beats predicting.
 */
export function detectFocused(el, adapter) {
  if (!el || isDisqualified(el)) return null;
  if (!el.matches(EDITABLE_SELECTOR)) return null;
  const r = scoreCandidate(el, adapter);
  if (r.score < FOCUS_THRESHOLD) return null;
  return { input: r.input, sendButton: r.sendButton, score: r.score, runnerUp: 0, confident: true };
}

/* ---------- per-host memory descriptors ---------- */

function stableId(id) {
  if (!id) return "";
  // Drop ids that look framework-generated (long, contain :radix: or digit runs).
  if (id.length > 32 || /:|\d{4,}/.test(id)) return "";
  return id;
}

/** Build a stable, framework-agnostic descriptor of a confirmed prompt box. */
export function buildDescriptor(el) {
  return {
    tag: el.tagName.toLowerCase(),
    id: stableId(el.id),
    role: el.getAttribute("role") || "",
    al: el.getAttribute("aria-label") || "",
    ph: el.getAttribute("placeholder") || el.getAttribute("data-placeholder") || "",
    ce: el.getAttribute("contenteditable") === "true",
  };
}

/** Resolve a stored descriptor back to a live element on revisit, or null. */
export function matchDescriptor(desc) {
  if (!desc) return null;
  if (desc.id) {
    const byId = document.getElementById(desc.id);
    if (byId && isVisible(byId) && !isDisqualified(byId)) return byId;
  }
  const candidates = gatherCandidates(document).filter((el) => !isDisqualified(el));
  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    if (el.tagName.toLowerCase() !== desc.tag) continue;
    let s = 1;
    if (desc.role && el.getAttribute("role") === desc.role) s++;
    if (desc.al && el.getAttribute("aria-label") === desc.al) s += 2;
    if (desc.ph && (el.getAttribute("placeholder") === desc.ph || el.getAttribute("data-placeholder") === desc.ph)) s += 2;
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  // Require more than just a tag match to trust memory.
  return bestScore >= 3 ? best : null;
}
