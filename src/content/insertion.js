/**
 * Layer 3 (placement) — PRIMARY placement. Inserts the pill as a real flex child
 * of the host's control row so the host's own layout engine reflows the row and
 * makes room: native inline position + native spacing, which no coordinate solver
 * can produce for a wide label in a packed bar.
 *
 * The inserted node hosts the pill in its OWN shadow root (style isolation), is
 * tagged `dataset.promptlord` (observers ignore it), and is re-attached when a
 * framework re-render strips it. Insertion is verified by a before/after layout
 * diff; any regression → caller falls back to the overlay solver.
 */
import { intersects, inflate } from "./util.js";
import { findControlRow } from "./detection.js";

export const INSERTION = {
  MAX_ROW_CLIMB: 6, // how far above send to look for the control row (deep nesting, e.g. Claude)
  MAX_ROW_HEIGHT_RATIO: 2.2, // reject rows taller than this × the send button (composer shell)
  WRAPPER_MAX_WIDTH_RATIO: 2.5, // climb past non-growable wrappers up to this × send-button width
  INSERT_BEFORE_SEND: true, // place in the right-hand cluster, just before send
  METRIC_TOLERANCE_PX: 2,
  REINSERT_MAX: 4, // re-inserts allowed within the window before giving up to fallback
  REINSERT_WINDOW_MS: 2000,
};

export class InsertedPlacement {
  constructor(pill) {
    this.pill = pill; // borrowed: the ONE shared Pill, owned + moved by the Overlay facade
    this.row = null;
    this.ref = null;
    this.sendButton = null;
    this._retryCount = 0;
    this._retryWindowStart = 0;
    this._selfMutating = false;

    // Trust mode (adapter placement:"inline", e.g. Claude): skip the strict reflow-diff verify and
    // keep the pill glued to the toolbar via a synchronous re-insert watchdog. See setTrust().
    this._trust = false;
    this._guard = null;
    this._guardRow = null;
    this._scale = 1;  // adapter pillScale: multiplier on the matched FONT (drives the pill's width). See setScale().
    this._hScale = 1; // adapter pillHeightScale: multiplier on the matched HEIGHT (defaults to _scale).

    this.wrapper = document.createElement("div");
    this.wrapper.dataset.promptlord = "wrapper";
    // Minimal in-flow flex item so the host row reflows around it. Hidden until shown.
    this.wrapper.style.cssText = "display:none; align-items:center; pointer-events:auto;";
    // The facade mounts the shared pill into this shadow root when entering inserted mode.
    this.shadow = this.wrapper.attachShadow({ mode: "open" });
  }

  /** Our own node (for owns()/self-mutation checks). */
  isMine(node) {
    return node === this.wrapper;
  }

  isSelfMutating() {
    return this._selfMutating;
  }

  /** True if the single wrapper is currently attached anywhere in the document. */
  isPlaced() {
    return this.wrapper.isConnected;
  }

  /**
   * Enable trust mode for a host the generic scorer/verify mishandles (adapter placement:"inline",
   * e.g. Claude, whose tiptap composer re-renders break the before/after reflow diff). In trust mode
   * we anchor directly to the send button, skip the strict verify, and watchdog the placement.
   */
  setTrust(on) {
    this._trust = !!on;
    if (!on) this._disarmGuard();
  }

  /**
   * Scale the pill's matched font (→ width) and height for hosts whose controls are over/under-sized
   * relative to the pill (e.g. Gemini's tall composer). `s` scales the font/width; `h` scales the
   * height and defaults to `s` (uniform). 1 = match the neighbor exactly. Decoupled so a host can keep
   * the pill's width while nudging only its height.
   */
  setScale(s, h) {
    const v = parseFloat(s);
    this._scale = v > 0 ? v : 1;
    const hv = parseFloat(h);
    this._hScale = hv > 0 ? hv : this._scale;
  }

  /** Resolve the live control row for the current send button, or null. Never cached. */
  _resolveRow() {
    return findControlRow(this.sendButton, {
      maxClimb: INSERTION.MAX_ROW_CLIMB,
      maxHeightRatio: INSERTION.MAX_ROW_HEIGHT_RATIO,
      wrapperMaxWidthRatio: INSERTION.WRAPPER_MAX_WIDTH_RATIO,
    });
  }

  /**
   * Row resolver used everywhere: the strict generic finder, plus (trust mode only) a lenient
   * anchored fallback when the finder returns null on a live re-render. The fallback climbs from the
   * send button to its first horizontal flex/grid ancestor that is meaningfully wider than the send
   * button (the real toolbar, not a `w-8` wrapper) and inserts before the send-side child. No class
   * strings, no fixed pixels — pure computed-style + geometry.
   */
  _resolve() {
    const found = this._resolveRow();
    if (found || !this._trust) return found;
    return this._resolveRowAnchored();
  }

  _resolveRowAnchored() {
    const sb = this.sendButton;
    if (!sb || !sb.isConnected) return null;
    const sw = sb.getBoundingClientRect().width || 0;
    let ref = sb;
    for (let i = 0; i < INSERTION.MAX_ROW_CLIMB && ref.parentElement; i++) {
      const row = ref.parentElement;
      let cs;
      try { cs = getComputedStyle(row); } catch (_) { break; }
      const disp = cs.display;
      const isRow = disp === "flex" || disp === "inline-flex" || disp === "grid" || disp === "inline-grid";
      if (isRow && !(cs.flexDirection || "row").startsWith("column")) {
        const rw = row.getBoundingClientRect().width || 0;
        if (rw > sw * 1.5) return { row, ref }; // a real toolbar, wider than a lone send wrapper
      }
      ref = row;
    }
    return null;
  }

  /**
   * No-op-when-correct probe — no structural change. Re-resolves the row LIVE (never trusts the
   * cached node) and, if the single wrapper is already connected inside it, refreshes metrics and
   * returns true. Returns false when a real (re)placement is needed. Resets the failure budget
   * whenever we're correctly placed. The facade calls this to decide place vs. debounce.
   */
  tryRefresh(sendButton) {
    if (sendButton) this.sendButton = sendButton;
    if (!this.wrapper.isConnected) return false;
    // Trust mode: any connected, geometrically-sane placement counts as correct — we may be holding
    // the direct-before-send fallback anchor (not the strict findControlRow row), so re-matching the
    // strict row here would force needless re-placement flapping.
    if (this._trust) {
      if (this._sanePlacement(this.sendButton)) { this._retryCount = 0; return true; }
      return false;
    }
    const found = this._resolve();
    if (!found || this.wrapper.parentNode !== found.row) return false;
    this.row = found.row;
    this.ref = found.ref;
    this._matchMetrics(found.row, this.sendButton);
    this._retryCount = 0; // correctly placed → clear the failure budget
    return true;
  }

  /**
   * Ensure the pill is a verified flex child of the live control row. Idempotent: a no-op when
   * already correct; otherwise MOVES the single wrapper into the freshly-resolved row (never creates
   * a second). Returns true if placed/correct, false if it genuinely can't place (→ caller falls
   * back). The bounded retry counts ONLY failures, so many clean re-places across a re-render storm
   * never trip the fallback — only sustained inability to place does.
   */
  ensureOrAttach(input, sendButton) {
    if (sendButton) this.sendButton = sendButton;

    if (this.tryRefresh(this.sendButton)) return true; // already correct

    const found = this._resolve();
    if (!found) {
      // Transient teardown: no row to resolve right now. Keep any existing placement; fail soft.
      return this.wrapper.isConnected && this.row != null && this.row.isConnected;
    }

    // Bounded FAILURE retry within a sliding window.
    const now = Date.now();
    if (now - this._retryWindowStart > INSERTION.REINSERT_WINDOW_MS) {
      this._retryWindowStart = now;
      this._retryCount = 0;
    }
    if (this._retryCount >= INSERTION.REINSERT_MAX) return false; // sustained failure → fallback

    if (this._place(found, this.sendButton)) {
      this._retryCount = 0; // a clean (re)placement clears the failure budget
      return true;
    }
    this._retryCount++; // count only failures toward the escape hatch
    return false;
  }

  /**
   * Move the single wrapper into `found.row` and verify the reflow. Fails SOFT (skips this tick,
   * keeps current state) rather than throwing on a transient detached-parent state.
   */
  _place(found, sendButton) {
    if (sendButton) this.sendButton = sendButton;
    const { row, ref } = found;
    if (!row.isConnected) return this.wrapper.isConnected; // transient → keep what we have

    // Trust mode (Claude/Gemini): skip the strict reflow diff; require only a geometrically-sane spot,
    // with a direct-before-send fallback anchor for editors whose toolbar row collapses our node.
    if (this._trust) return this._trustedPlace(found);

    // Capture layout BEFORE inserting, to diff against after.
    const before = {
      rowH: row.getBoundingClientRect().height,
      sendRect: sendButton ? sendButton.getBoundingClientRect() : null,
      scrollW: row.scrollWidth,
    };

    this._selfMutating = true;
    try {
      if (INSERTION.INSERT_BEFORE_SEND && ref && ref.parentElement === row) {
        row.insertBefore(this.wrapper, ref); // moves the one wrapper (a node has a single parent)
      } else {
        row.appendChild(this.wrapper);
      }
    } catch (_) {
      return this.wrapper.isConnected; // transient DOM state — fail soft, keep current
    } finally {
      this._selfMutating = false;
    }

    this.wrapper.style.display = "inline-flex";
    this._matchMetrics(row, sendButton);

    if (!this._verify(row, sendButton, before)) {
      this._selfMutating = true;
      try { this.wrapper.remove(); } finally { this._selfMutating = false; }
      return false;
    }

    this.row = row;
    this.ref = ref;
    return true;
  }

  /* ---- trust-mode placement: geometric sanity instead of the strict reflow diff ---- */

  /**
   * Place the pill for a trust-mode host. The host's flex toolbar reflows around the pill on its own,
   * so the strict before/after diff isn't needed — but we MUST reject a geometrically-broken result
   * (zero size, or far from the send button), which is what made Gemini render an off-screen pill.
   * Two anchors are tried, accepted only if sane: (1) before the resolved send-side child in the
   * resolved toolbar row; (2) directly before the send button in its own parent cluster (mic|send),
   * a flex group that reflows on virtually every site. Arms the re-glue watchdog on success.
   */
  _trustedPlace(found) {
    if (found && found.row && found.row.isConnected &&
        this._tryInsert(found.row, found.ref) && this._sanePlacement(this.sendButton)) {
      this.row = found.row;
      this.ref = found.ref;
      this._armGuard(found.row);
      return true;
    }
    const sb = this.sendButton;
    if (sb && sb.isConnected && sb.parentElement &&
        this._tryInsert(sb.parentElement, sb) && this._sanePlacement(sb)) {
      this.row = sb.parentElement;
      this.ref = sb;
      this._armGuard(sb.parentElement);
      return true;
    }
    // No geometrically-sane inline spot — remove so we never render an off-screen/zero-size pill.
    this._selfMutating = true;
    try { this.wrapper.remove(); } finally { this._selfMutating = false; }
    return false;
  }

  /** Move the single wrapper before `ref` in `row` (append if ref isn't a child); match metrics. */
  _tryInsert(row, ref) {
    this._selfMutating = true;
    let ok = false;
    try {
      if (ref && ref.parentElement === row) row.insertBefore(this.wrapper, ref);
      else row.appendChild(this.wrapper);
      this.wrapper.style.display = "inline-flex";
      ok = true;
    } catch (_) {
      ok = this.wrapper.isConnected; // transient DOM state — keep whatever we have
    } finally {
      this._selfMutating = false;
    }
    if (ok) this._matchMetrics(row, this.sendButton);
    return ok;
  }

  /** A placement is sane if the pill has real size AND sits in the send button's horizontal band. */
  _sanePlacement(sendButton) {
    if (!this.wrapper.isConnected) return false;
    const wr = this.wrapper.getBoundingClientRect();
    if (wr.width <= 0 || wr.height <= 0) return false;          // collapsed (e.g. a fixed grid track)
    if (!sendButton || !sendButton.isConnected) return true;   // nothing to align against → accept
    const sr = sendButton.getBoundingClientRect();
    if (sr.height <= 0) return true;
    const wcy = wr.top + wr.height / 2;
    const scy = sr.top + sr.height / 2;
    return Math.abs(wcy - scy) <= Math.max(sr.height * 1.5, 40); // same toolbar row as the send button
  }

  /* ---- trust-mode watchdog: re-insert synchronously when the host strips our node ---- */

  /**
   * Watch the resolved toolbar for childList changes; if the host (Claude's tiptap re-render)
   * removes our wrapper, re-insert it from the observer callback — which runs in a microtask BEFORE
   * the browser paints, so the pill never visibly disappears. Idempotent per row.
   */
  _armGuard(row) {
    if (this._guard && this._guardRow === row && row.isConnected) return;
    this._disarmGuard();
    if (!row || !row.isConnected || typeof MutationObserver === "undefined") return;
    this._guardRow = row;
    this._guard = new MutationObserver(() => {
      if (this._selfMutating) return;          // ignore our own insert/remove
      if (!this.wrapper.isConnected) this._reglue();
    });
    try {
      this._guard.observe(row, { childList: true });
    } catch (_) {
      this._guard = null;
      this._guardRow = null;
    }
  }

  _disarmGuard() {
    if (this._guard) { try { this._guard.disconnect(); } catch (_) {} }
    this._guard = null;
    this._guardRow = null;
  }

  /**
   * Synchronous re-insert after a host strip (trust mode). Re-resolves the live row so a swapped-out
   * toolbar is handled, re-arms the guard on whatever row we land in, and re-matches metrics. Fails
   * soft (disarms) on a transient detached state — the facade's reconcile re-places next tick.
   */
  _reglue() {
    // Re-resolve live (a re-render may have swapped the row) and re-place through the same sane
    // two-anchor logic; _trustedPlace re-arms the guard on whatever row we land in.
    if (!this._trustedPlace(this._resolve())) this._disarmGuard();
  }

  /**
   * Confirm the insertion reflowed cleanly: the row didn't grow taller (no wrap),
   * the send button didn't shrink or get pushed out of the row, no horizontal
   * overflow was induced, and we don't overlap the send button.
   */
  _verify(row, sendButton, before) {
    const tol = INSERTION.METRIC_TOLERANCE_PX;
    if (!this.wrapper.isConnected) return false;
    const wr = this.wrapper.getBoundingClientRect();
    if (wr.width <= 0 || wr.height <= 0) return false;

    const rowRect = row.getBoundingClientRect();
    if (rowRect.height > before.rowH + tol) return false; // row wrapped / grew a line
    if (row.scrollWidth > row.clientWidth + tol) return false; // induced horizontal overflow

    if (sendButton && before.sendRect) {
      const sNow = sendButton.getBoundingClientRect();
      if (sNow.width < before.sendRect.width - tol) return false; // send got squashed
      if (sNow.right > rowRect.right + tol || sNow.left < rowRect.left - tol) return false; // shoved out
      if (intersects(inflate(wr, -1), sNow)) return false; // overlapping send
    }
    return true;
  }

  /** Size/space the pill to match the host's own controls (cached on the wrapper). */
  _matchMetrics(row, neighbor) {
    const w = this.wrapper.style;
    const fontScale = this._scale || 1;     // → pill width (text size)
    const hScale = this._hScale || fontScale; // → pill height
    try {
      const rcs = getComputedStyle(row);
      const ncs = neighbor ? getComputedStyle(neighbor) : null;
      const nrect = neighbor ? neighbor.getBoundingClientRect() : null;

      const h = (nrect && nrect.height > 0 ? nrect.height : 28) * hScale;
      if (nrect && nrect.height > 0) w.setProperty("--pl-h", `${Math.round(h)}px`);
      if (ncs) {
        if (ncs.fontSize) {
          const fs = parseFloat(ncs.fontSize);
          w.setProperty("--pl-font-size", fs > 0 ? `${Math.round(fs * fontScale * 10) / 10}px` : ncs.fontSize);
        }
        const r = parseFloat(ncs.borderRadius) || 0;
        if (r > 0) w.setProperty("--pl-radius", `${Math.min(r, h / 2)}px`); // clamp so a wide pill never exceeds stadium
      }

      // Spacing: prefer the row's gap; only synthesize a margin if the row has none.
      const gap = parseFloat(rcs.columnGap || rcs.gap) || 0;
      if (gap > 0) {
        w.removeProperty("margin-inline-start");
        w.removeProperty("margin-inline-end");
      } else if (ncs) {
        const m = parseFloat(ncs.marginLeft) || 0;
        w.setProperty("margin-inline-end", m > 0 ? ncs.marginLeft : "6px");
      }
    } catch (_) {
      /* metric matching is best-effort */
    }
  }

  /* ---- visibility: toggle display, never insert/remove (no per-keystroke churn) ---- */

  show() {
    this.wrapper.style.display = "inline-flex";
  }

  hide() {
    this.wrapper.style.display = "none";
  }

  /** Remove from the host DOM entirely (detach/destroy). */
  remove() {
    this._disarmGuard();
    this._selfMutating = true;
    try {
      this.wrapper.remove();
    } finally {
      this._selfMutating = false;
    }
    this.row = null;
    this.ref = null;
    this._retryCount = 0;
  }

  /** Reset retry budget — call on a new acquisition / navigation. */
  resetRetries() {
    this._retryCount = 0;
    this._retryWindowStart = 0;
  }
}
