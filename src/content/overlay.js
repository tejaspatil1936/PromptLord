/**
 * Layer 3 (placement facade) — chooses how the Enhance pill is placed and exposes
 * a stable interface to the orchestrator (attach/setSendButton/show/hide/position/
 * state/owns/detach/destroy). It delegates to two strategies:
 *
 *   1. InsertedPlacement (PRIMARY, insertion.js) — inserts the pill as a real flex
 *      child of the host's control row; the host's layout reflows to make room.
 *   2. OverlayPlacement (FALLBACK, this file) — the occupancy/collision solver:
 *      a top-layer popover positioned by JS to the first of five candidate slots
 *      that collides with nothing. Used when safe insertion isn't possible.
 *
 * Insertion is tried first each present; if it can't attach (no clean control row,
 * or a re-render keeps stripping us past the retry budget) the facade locks to the
 * overlay fallback for this acquisition (hysteresis — no per-reconcile flapping).
 *
 * A DEBUG overlay (localStorage["promptlord:debug"]="1") draws the composer, the
 * detected control row, an INSERTED/FALLBACK badge, and the fallback solve.
 */
import {
  intersects, viewport, clamp, isVisible,
  inflate, overlapArea, clipToRect, unionRect,
} from "./util.js";
import { findComposerContainer, findControlRow } from "./detection.js";
import { Pill } from "./pill.js";
import { InsertedPlacement } from "./insertion.js";

/* ---- overlay/solver tunables (insertion tunables live in insertion.js) ---- */
const CONFIG = {
  GAP: 8,
  SLOP: 2,
  MIN_INPUT_HEIGHT_FOR_C2: 64,
  C2_TOP_INSET: 8,
  CANDIDATE_ORDER: ["C2", "C1", "DB", "DT", "C3", "C5", "C4"], // edge-docks beat open-space floats
  MAX_CONTAINER_LEVELS: 6,
  MIN_MOVE_PX: 2,
  DOCK_OVERLAP: 2, // px the flush-docked pill overlaps the composer border (label-tab look)
  DOCK_INSET: 6, // inset from the composer's top/right edge for the INSIDE dock (top-right corner)
  DOCK_GUTTER_FALLBACK: 8, // dock inset when the input exposes no content padding
  DOCK_ANCHOR_LEVELS: 8, // how far above the input to look for the composer card to dock against
  DOCK_ANCHOR_MIN_RADIUS: 12, // border-radius (px) that marks a "card" — above button/input radii
  SETTLE_MS: 50, // trailing quiet window before a re-place commits (re-render storm)
  MAX_SETTLE_MS: 500, // hard cap so continuous churn still converges
  DEBUG_DEFAULT: false,
};

const OBSTACLE_SELECTOR =
  'button, [role="button"], [aria-haspopup], a[href], select, input:not([type="hidden"])';

const HAS_POPOVER = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

function detectDebug() {
  if (CONFIG.DEBUG_DEFAULT) return true;
  try {
    if (localStorage.getItem("promptlord:debug") === "1") return true;
  } catch (_) {
    /* localStorage may be blocked */
  }
  return typeof window !== "undefined" && !!window.__promptlordDebug;
}

/* ======================================================================== *
 * OverlayPlacement — the occupancy solver (fallback). Top-layer popover,
 * positioned by JS to the first non-colliding candidate slot.
 * ======================================================================== */
export class OverlayPlacement {
  constructor(pill, opts = {}) {
    this.pill = pill; // borrowed: the ONE shared Pill, owned + moved by the Overlay facade
    this._dockOnly = !!(opts && opts.dock); // adapter placement:"dock" → deterministic edge-dock
    this.shown = false;
    this.input = null;
    this.sendButton = null;
    this.lastSolve = null;
    this.root = null; // the positioned pill root — set by enterMode() once the pill is mounted here
    this._resetCaches();
    this._build();
  }

  _build() {
    this.host = document.createElement("div");
    this.host.dataset.promptlord = "overlay-host";
    this.host.style.cssText = "all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0;";
    // The facade mounts the shared pill into this shadow when entering overlay mode; enterMode()
    // then styles the root as a top-layer popover. The host stays in the DOM (empty) when inactive.
    this.shadow = this.host.attachShadow({ mode: "open" });
    (document.documentElement || document.body).appendChild(this.host);
  }

  _resetCaches() {
    this.container = null;
    this._obstacleEls = null;
    this._obstaclesDirty = true;
    this._lastSlotKey = null;
    this._lastRect = null;
  }

  invalidateObstacles() {
    this._obstaclesDirty = true;
    this.container = null;
  }

  /**
   * Take ownership of the shared pill (which the facade has just mounted into this.shadow)
   * for fallback placement: a top-layer popover positioned by JS. Starts hidden until
   * position() commits coordinates and opens it.
   */
  enterMode() {
    this.root = this.pill.root;
    const s = this.root.style;
    s.position = "fixed";
    s.zIndex = "2147483647";
    if (HAS_POPOVER) this.root.setAttribute("popover", "manual");
    s.display = "none";    // hidden until position() commits coords and opens
    this._lastRect = null; // force coordinate re-commit for the fresh layout context
    this._lastSlotKey = null;
    this.shown = false;
  }

  /**
   * Release the shared pill so the same node can serve as an in-flow inserted flex child:
   * close the popover and strip every overlay-only style/attribute.
   */
  exitMode() {
    if (this.root) {
      if (HAS_POPOVER) {
        try { this.root.hidePopover(); } catch (_) {}
        this.root.removeAttribute("popover");
      }
      const s = this.root.style;
      for (const p of ["display", "position", "z-index", "left", "top", "right", "bottom", "transform", "margin"]) {
        s.removeProperty(p);
      }
    }
    this.root = null;
    this.shown = false;
    this._lastRect = null;
    this._lastSlotKey = null;
  }

  /**
   * Open the popover. PRIVATE: only ever called by position() AFTER coordinates are
   * committed, so the UA viewport-centered default state is unreachable.
   */
  _open() {
    if (!this.root) return;
    const s = this.root.style;
    s.position = "fixed";
    if (HAS_POPOVER) {
      s.removeProperty("display"); // undo hide(); popover-open + `.pl-pill` author display render it
      try { if (!this.root.matches(":popover-open")) this.root.showPopover(); } catch (_) {}
    } else {
      s.display = "inline-flex";
    }
    this.shown = true;
  }

  /**
   * Force-close unconditionally. Inline `display:none` beats the `.pl-pill` author rule
   * (`display:inline-flex`), so the pill is truly hidden — not merely popover-closed, which
   * the author rule would override.
   */
  hide() {
    this.shown = false;
    if (!this.root) return;
    if (HAS_POPOVER) {
      try { this.root.hidePopover(); } catch (_) {}
    }
    this.root.style.display = "none";
  }

  _btnSize() {
    const b = this.pill.btn;
    return { bw: b.offsetWidth || 84, bh: b.offsetHeight || 28 };
  }

  /**
   * The single commit path. Solves a slot, commits left/top, and only THEN opens the
   * popover. Any path that can't commit coordinates (no input, degenerate rect, no slot)
   * hides instead of leaving a UA-centered popover open. Returns true iff the pill is
   * now shown with committed coordinates.
   */
  position(input, sendButton) {
    if (input !== this.input) {
      this.input = input;
      this._resetCaches();
    }
    this.sendButton = sendButton || null;
    if (!this.root) {
      // Pill isn't mounted here (not in overlay mode) — nothing to position.
      this.lastSolve = { committed: false };
      return false;
    }
    if (!this.input) {
      this.lastSolve = { committed: false };
      this.hide();
      return false;
    }

    const inputRect = this.input.getBoundingClientRect();
    if (inputRect.width <= 0 || inputRect.height <= 0) {
      this.lastSolve = { committed: false };
      this.hide();
      return false;
    }
    const sendRect =
      this.sendButton && isVisible(this.sendButton) ? this.sendButton.getBoundingClientRect() : null;

    if (!this.container || !this.container.isConnected) {
      this.container = findComposerContainer(this.input, this.sendButton, CONFIG.MAX_CONTAINER_LEVELS);
      this._obstaclesDirty = true;
    }
    const containerRect = this.container ? this.container.getBoundingClientRect() : inputRect;
    const composerRect = unionRect(containerRect, inputRect, sendRect);

    if (this._obstaclesDirty || !this._obstacleEls) {
      this._obstacleEls = this._collectObstacleEls();
      this._obstaclesDirty = false;
    }
    const obstacles = this._buildObstacleRects(composerRect, containerRect, inputRect);

    const rtl = getComputedStyle(this.input).direction === "rtl";
    const gutter = this._dockGutter(rtl);
    const { bw, bh } = this._btnSize();
    const slots = this._candidateSlots({ composerRect, inputRect, sendRect, obstacles, bw, bh, rtl, gutter });
    const chosen = this._dockOnly ? this._solveDock(slots, obstacles) : this._solve(slots, obstacles);

    if (!chosen) {
      this.lastSolve = { composerRect, obstacles, slots, chosenKey: null, committed: false };
      this.hide();
      return false;
    }

    this._applySlot(chosen.rect); // commit coordinates FIRST
    this._open();                 // ...then open the popover
    this.lastSolve = { composerRect, obstacles, slots, chosenKey: chosen.key, committed: true };
    return true;
  }

  _collectObstacleEls() {
    const scope = this.container || document;
    const els = [];
    let i = 0;
    for (const el of scope.querySelectorAll(OBSTACLE_SELECTOR)) {
      if (++i > 200) break;
      if (el.dataset && el.dataset.promptlord != null) continue;
      if (el === this.input) continue;
      els.push(el);
    }
    if (this.sendButton && !els.includes(this.sendButton)) els.push(this.sendButton);
    return els;
  }

  _buildObstacleRects(composerRect, containerRect, inputRect) {
    const band = inflate(composerRect, CONFIG.SLOP);
    const clip = inflate(containerRect, CONFIG.SLOP);
    const rects = [];
    for (const el of this._obstacleEls) {
      if (!el.isConnected) {
        this._obstaclesDirty = true;
        continue;
      }
      if (!isVisible(el)) continue;
      let r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (el !== this.sendButton) {
        const clipped = clipToRect(r, clip);
        if (!clipped) continue;
        r = clipped;
      }
      if (!intersects(r, band)) continue;
      rects.push(inflate(r, CONFIG.SLOP));
    }
    rects.push(inflate(this._textRegion(inputRect), CONFIG.SLOP));
    return rects;
  }

  _textRegion(inputRect) {
    const el = this.input;
    const isCE =
      el.isContentEditable ||
      el.getAttribute("contenteditable") === "true" ||
      el.getAttribute("role") === "textbox";
    if (isCE) {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        if (
          r && r.width > 1 && r.height > 1 &&
          r.top >= inputRect.top - 4 && r.left >= inputRect.left - 4 &&
          r.bottom <= inputRect.bottom + 8 && r.width <= inputRect.width + 8
        ) {
          return r;
        }
      } catch (_) {}
    }
    return inputRect;
  }

  /** Dock inset aligned to the input's content gutter (its inline padding), clamped. */
  _dockGutter(rtl) {
    try {
      const cs = getComputedStyle(this.input);
      const pad = parseFloat(rtl ? cs.paddingLeft : cs.paddingRight) || 0;
      return pad > 0 ? Math.min(pad, 24) : CONFIG.DOCK_GUTTER_FALLBACK;
    } catch (_) {
      return CONFIG.DOCK_GUTTER_FALLBACK;
    }
  }

  /**
   * The composer's visible bounding box to dock against: the nearest rounded/bordered "card"
   * ancestor of the input that is taller than the input (so it includes the control row, e.g.
   * Claude's `rounded-[20px]` composer where the input is only the text area). Class-agnostic —
   * keys off computed border-radius/border, not class strings. Robust where `findComposerContainer`
   * inflates `composerRect`, or where there is no send button yet (empty state). Falls back to the
   * input ∪ send union, then the input rect.
   */
  _dockAnchor(inputRect, sendRect) {
    let n = this.input.parentElement;
    for (let i = 0; i < CONFIG.DOCK_ANCHOR_LEVELS && n; i++, n = n.parentElement) {
      let cs;
      try { cs = getComputedStyle(n); } catch (_) { break; }
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const bordered = (parseFloat(cs.borderTopWidth) || 0) > 0;
      if (radius >= CONFIG.DOCK_ANCHOR_MIN_RADIUS || bordered) {
        const r = n.getBoundingClientRect();
        // Must bound the WHOLE composer: taller than the input (includes the control row) and at
        // least as wide — so we never pick a thin rounded wrapper hugging just the text.
        if (r.width > 0 && r.height > inputRect.height + 8 && r.width >= inputRect.width - 2) return r;
      }
    }
    return unionRect(inputRect, sendRect) || inputRect;
  }

  _candidateSlots({ composerRect, inputRect, sendRect, obstacles, bw, bh, rtl, gutter }) {
    const mk = (left, top) => ({ left, top, right: left + bw, bottom: top + bh, width: bw, height: bh });

    let c1;
    {
      let bandTop;
      let bandBottom;
      let cy;
      if (sendRect) {
        bandTop = sendRect.top - CONFIG.SLOP;
        bandBottom = sendRect.bottom + CONFIG.SLOP;
        cy = sendRect.top + sendRect.height / 2;
      } else {
        bandBottom = inputRect.bottom;
        bandTop = inputRect.bottom - bh - 2 * CONFIG.GAP;
        cy = (bandTop + bandBottom) / 2;
      }
      const center = inputRect.left + inputRect.width / 2;
      const inBand = obstacles.filter((o) => {
        const ocy = (o.top + o.bottom) / 2;
        return ocy >= bandTop && ocy <= bandBottom;
      });
      let left;
      if (!rtl) {
        const cluster = inBand.filter((o) => o.left >= center);
        const edge = cluster.length ? Math.min(...cluster.map((o) => o.left)) : (sendRect ? sendRect.left : composerRect.right);
        left = edge - CONFIG.GAP - bw;
      } else {
        const cluster = inBand.filter((o) => o.right <= center);
        const edge = cluster.length ? Math.max(...cluster.map((o) => o.right)) : (sendRect ? sendRect.right : composerRect.left);
        left = edge + CONFIG.GAP;
      }
      c1 = mk(left, cy - bh / 2);
    }

    let c2 = null;
    if (inputRect.height >= CONFIG.MIN_INPUT_HEIGHT_FOR_C2) {
      const left = rtl ? inputRect.left + CONFIG.GAP : inputRect.right - bw - CONFIG.GAP;
      c2 = mk(left, inputRect.top + CONFIG.C2_TOP_INSET);
    }

    const c3 = mk(rtl ? composerRect.left : composerRect.right - bw, composerRect.top - bh - CONFIG.GAP);
    const c4 = mk(
      rtl ? composerRect.left - CONFIG.GAP - bw : composerRect.right + CONFIG.GAP,
      composerRect.top + composerRect.height / 2 - bh / 2
    );
    const c5 = mk(rtl ? composerRect.left : composerRect.right - bw, composerRect.bottom + CONFIG.GAP);

    // Edge-dock slots, anchored to the composer CARD (its rounded/bordered box — see _dockAnchor),
    // gutter-aligned to the card's send-side edge and straddling the border by DOCK_OVERLAP (label-
    // tab look). DB sits on the bottom border (below the control row), DT on the top border. The
    // occupancy solver rejects either if it would cover a control, so DT wins when the bottom is busy.
    const anchor = this._dockAnchor(inputRect, sendRect);
    const g = gutter ?? CONFIG.DOCK_GUTTER_FALLBACK;
    const dockLeft = rtl ? anchor.left + g : anchor.right - bw - g;
    const di = mk(dockLeft, anchor.top + CONFIG.DOCK_INSET);        // INSIDE the card, top-right corner
    const db = mk(dockLeft, anchor.bottom - CONFIG.DOCK_OVERLAP);    // on the bottom border (tab)
    const dt = mk(dockLeft, anchor.top - bh + CONFIG.DOCK_OVERLAP);  // on the top border (tab)

    return { C1: c1, C2: c2, C3: c3, C4: c4, C5: c5, DI: di, DB: db, DT: dt };
  }

  _clampRect(r) {
    const { width: vw, height: vh } = viewport();
    const left = clamp(r.left, 4, Math.max(4, vw - r.width - 4));
    const top = clamp(r.top, 4, Math.max(4, vh - r.height - 4));
    return { left, top, right: left + r.width, bottom: top + r.height, width: r.width, height: r.height };
  }

  _totalOverlap(rect, obstacles) {
    let sum = 0;
    for (const o of obstacles) sum += overlapArea(rect, o);
    return sum;
  }

  /**
   * Deterministic edge-dock (adapter placement:"dock", e.g. Claude): no obstacle search — bottom
   * border preferred, top border when the bottom slot would fall off-screen. The dock sits below
   * the control row, so there is nothing to collide with; this avoids the solver ever preferring an
   * open-space float over the intended edge.
   */
  _solveDock(slots, obstacles) {
    // Prefer the pill INSIDE the composer (top-right corner); fall back to the bottom then top
    // border. Obstacle-aware so it never sits on the text or a control, but stays inside when clear.
    let best = null;
    for (const key of ["DI", "DB", "DT"]) {
      if (!slots[key]) continue;
      const rect = this._clampRect(slots[key]);
      const overlap = this._totalOverlap(rect, obstacles);
      if (overlap <= 0) return { key, rect, overlap: 0 };
      if (!best || overlap < best.overlap) best = { key, rect, overlap };
    }
    return best;
  }

  _solve(slots, obstacles) {
    const evaluate = (key) => {
      const raw = slots[key];
      if (!raw) return null;
      const rect = this._clampRect(raw);
      return { key, rect, overlap: this._totalOverlap(rect, obstacles) };
    };

    if (this._lastSlotKey) {
      const last = evaluate(this._lastSlotKey);
      if (last && last.overlap <= 0) return last;
    }
    let best = null;
    for (const key of CONFIG.CANDIDATE_ORDER) {
      const c = evaluate(key);
      if (!c) continue;
      if (c.overlap <= 0) {
        this._lastSlotKey = key;
        return c;
      }
      if (!best || c.overlap < best.overlap) best = c;
    }
    if (best) this._lastSlotKey = best.key;
    return best;
  }

  _applySlot(rect) {
    const left = Math.round(rect.left);
    const top = Math.round(rect.top);
    if (
      this._lastRect &&
      Math.abs(this._lastRect.left - left) < CONFIG.MIN_MOVE_PX &&
      Math.abs(this._lastRect.top - top) < CONFIG.MIN_MOVE_PX
    ) {
      return;
    }
    this._lastRect = { left, top };
    const s = this.root.style;
    s.position = "fixed";
    s.transform = "none";
    // Override the UA popover stylesheet `[popover]{ inset:0; margin:auto }` — otherwise the
    // residual right:0/bottom:0 + auto margins CENTER the popover and our left/top only define a
    // centering box (the "floats off to the side/center" bug). Pin it to exactly left/top.
    s.margin = "0";
    s.right = "auto";
    s.bottom = "auto";
    s.left = `${left}px`;
    s.top = `${top}px`;
  }

  destroy() {
    this.host.remove();
  }
}

/* ======================================================================== *
 * Overlay — the facade. Routes to InsertedPlacement (primary) or
 * OverlayPlacement (fallback) and owns the debug overlay.
 * ======================================================================== */
const DEBUG_STYLES = `
.pl-debug { position: fixed; inset: 0; pointer-events: none; z-index: 2147483645; }
.pl-debug .box { position: fixed; pointer-events: none; box-sizing: border-box; font: 10px/1.2 monospace; }
.pl-debug .box > span { position: absolute; top: -1px; left: -1px; padding: 0 2px; color: #fff; }
.pl-debug .badge { position: fixed; padding: 2px 6px; border-radius: 4px; color: #fff; font: 700 11px/1.2 monospace; }
`;

export class Overlay {
  constructor({ onClick, onUndo, forceDock, forceInline, pillScale, pillHeightScale }) {
    this.pill = new Pill({ onClick, onUndo }); // the ONE shared pill, physically moved between mounts
    this._forceDock = !!forceDock; // adapter placement:"dock" → never attempt inline insertion
    this._forceInline = !!forceInline; // adapter placement:"inline" → deterministic, trusted inline insert
    this.inserted = new InsertedPlacement(this.pill);
    if (this._forceInline) this.inserted.setTrust(true);
    // adapter pillScale (width/font) + optional pillHeightScale (height) → shrink/grow the matched pill
    if (pillScale || pillHeightScale) this.inserted.setScale(pillScale ?? 1, pillHeightScale);
    this.overlay = new OverlayPlacement(this.pill, { dock: this._forceDock });

    this.input = null;
    this.sendButton = null;
    this.shown = false;
    this.mode = null; // 'inserted' | 'overlay'
    this._pillAt = null; // which mount currently holds the shared pill: 'inserted' | 'overlay'
    this._fallbackLocked = false;
    this._dockSticky = false; // escape hatch latched: stay docked, don't retry inline this acquisition
    this._wasInserted = false; // have we placed inline at least once this acquisition?
    this._settleTimer = 0;
    this._settleStart = 0;
    this.debug = detectDebug();
    this._probed = false;

    this._buildDebugHost();
  }

  _buildDebugHost() {
    this.debugHost = document.createElement("div");
    this.debugHost.dataset.promptlord = "debug";
    this.debugHost.style.cssText = "all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0;";
    const shadow = this.debugHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = DEBUG_STYLES;
    shadow.appendChild(style);
    this.debugLayer = document.createElement("div");
    this.debugLayer.className = "pl-debug";
    shadow.appendChild(this.debugLayer);
    if (this.debug) (document.documentElement || document.body).appendChild(this.debugHost);
  }

  /** True for any node that belongs to us (so observers ignore our own mutations) — including a
   *  node nested inside one of our shadow roots, so our own placement never feeds the composer
   *  observer and extends the re-render storm. */
  owns(node) {
    if (node.dataset && node.dataset.promptlord != null) return true;
    if (node === this.debugHost || node === this.overlay.host || node === this.inserted.wrapper) return true;
    const root = node.getRootNode && node.getRootNode();
    if (root && root !== document && root.host && root.host.dataset && root.host.dataset.promptlord != null) return true;
    return false;
  }

  /* ---- attachment ---- */

  attach(input, sendButton) {
    this.input = input;
    this.sendButton = sendButton || null;
    this.mode = null;
    this._fallbackLocked = false;
    this._dockSticky = false;
    this._wasInserted = false;
    this._clearSettle();
    this.inserted.resetRetries();
  }

  setSendButton(sendButton) {
    this.sendButton = sendButton || null;
    // Send button appearing is a fresh chance to insert (it shows up after text on some sites) —
    // unless we've latched the deterministic dock fallback for a composer too churny to insert.
    if (sendButton && !this._dockSticky) {
      this._fallbackLocked = false;
      this.inserted.resetRetries();
      if (this.mode !== "inserted") this.mode = null;
    }
  }

  detach() {
    this.shown = false;
    this._clearSettle();
    this._wasInserted = false;
    this._dockSticky = false;
    this.inserted.remove();
    this.overlay.hide();
    this.input = null;
    this.sendButton = null;
    this.mode = null;
    this._fallbackLocked = false;
  }

  destroy() {
    this.detach();
    this.inserted.wrapper.remove();
    this.overlay.destroy();
    this.debugHost.remove();
  }

  /* ---- visibility ---- */

  show() {
    this.shown = true;
    this._present();
  }

  hide() {
    this.shown = false;
    this._clearSettle();
    this.inserted.hide();
    this.overlay.hide();
  }

  position() {
    if (!this.shown) return;
    this._present();
  }

  /**
   * Move the single shared pill between the two mount points. The losing mount is left with
   * NO pill node, so a second on-screen "Enhance" is impossible by construction.
   */
  _movePill(target) {
    if (this._pillAt === target) return;
    if (target === "inserted") {
      this.overlay.exitMode();               // close popover + strip overlay-only styling
      this.pill.mount(this.inserted.shadow); // move the pill root into the wrapper's shadow
    } else {
      this.inserted.remove();                // pull the wrapper out of the host control row
      this.pill.mount(this.overlay.shadow);  // move the pill root into the overlay host's shadow
      this.overlay.enterMode();              // re-apply popover/fixed styling, start hidden
    }
    this._pillAt = target;
  }

  /**
   * Decide placement and apply it. Insertion first; lock to fallback if it can't. First placement
   * is immediate (no added lag on calm sites); a re-placement during a re-render storm is debounced
   * so the pill lands once on the settled row instead of hopping through transient ones.
   */
  _present() {
    if (!this.input || !this.shown) return;
    if (this.debug && !this._probed) this._probeAnchorPositioning();

    // forceInline (adapter placement:"inline", e.g. Claude): deterministic, TRUSTED inline insert —
    // anchor to the send button, skip the strict reflow-diff verify, and let the InsertedPlacement
    // watchdog re-glue the pill after each tiptap re-render. Never falls back to the floating overlay,
    // so the pill is guaranteed to live in the toolbar (between mic and send), not float beside it.
    if (this._forceInline) {
      this._movePill("inserted");
      if (
        this.inserted.tryRefresh(this.sendButton) ||
        this.inserted.ensureOrAttach(this.input, this.sendButton)
      ) {
        this._clearSettle();
        this._wasInserted = true;
        this.mode = "inserted";
        this.inserted.show();
        if (this.debug) this._drawDebug("inserted");
        return;
      }
      // No resolvable toolbar this tick (e.g. send button not present yet in the empty state) — keep
      // any current placement and retry on the next reconcile/settle. No overlay fallback.
      this._scheduleSettle();
      if (this.inserted.isPlaced()) this.inserted.show();
      if (this.debug) this._drawDebug("inserted");
      return;
    }

    // forceDock (adapter placement:"dock", e.g. Claude): skip inline entirely — go straight to the
    // flush-dock. A deliberate up-front choice, so there is no inline↔dock transition to flicker.
    if (!this._forceDock && !this._fallbackLocked) {
      // The pill must live in the wrapper's shadow so the wrapper measures during verify.
      this._movePill("inserted");

      // Already correctly placed → refresh in place; never detach/reinsert (that is the visible hop).
      if (this.inserted.tryRefresh(this.sendButton)) {
        this._clearSettle();
        this._wasInserted = true;
        this.mode = "inserted";
        this.inserted.show();
        if (this.debug) this._drawDebug("inserted");
        return;
      }

      if (!this._wasInserted) {
        // First placement this acquisition → immediate.
        if (this.inserted.ensureOrAttach(this.input, this.sendButton)) {
          this._wasInserted = true;
          this.mode = "inserted";
          this.inserted.show();
          if (this.debug) this._drawDebug("inserted");
          return;
        }
        // A single first-placement miss is usually transient: the composer is mid-re-render at the
        // moment the send button appears (Claude rebuilds its whole toolbar then), so _verify briefly
        // fails. Do NOT lock the overlay on one miss — debounce and let _settle retry on the quiet
        // DOM. _settle locks the fallback only if inline STILL can't place once things settle, and
        // ensureOrAttach's bounded retry budget caps the attempts. (Old behavior locked here on the
        // first miss → a permanent FALLBACK on Claude.)
        this._scheduleSettle();
        if (this.debug) this._drawDebug("inserted");
        return;
      } else {
        // The row changed / was torn down.
        if (!this.inserted.isPlaced() && !this._settleStart) {
          // FIRST strip of a storm: the wrapper is detached, so the pill is invisible right now
          // (e.g. Claude re-rendering its toolbar at the empty→typed boundary). Re-attach immediately
          // so it reappears within a frame instead of after the settle window — nothing is on screen
          // to "hop" since it was invisible, and _verify still guards the landing row. We then start
          // the settle window, so any SUBSEQUENT strips this storm take the debounce path below
          // (no reappear-blink loop during sustained churn).
          if (this.inserted.ensureOrAttach(this.input, this.sendButton)) {
            this._wasInserted = true;
            this.mode = "inserted";
            this.inserted.show();
          }
        }
        // Debounce the move until the DOM quiets, then place once (the safety net for real churn).
        this._scheduleSettle();
        if (this.inserted.isPlaced()) this.inserted.show(); // keep the current spot if still attached
        if (this.debug) this._drawDebug("inserted");
        return;
      }
    }

    // Fallback: move the one pill to the overlay host and place it via the solver. position()
    // commits coordinates and opens the popover only on success (never a UA-centered ghost).
    this._movePill("overlay");
    this.mode = "overlay";
    this.overlay.position(this.input, this.sendButton);
    if (this.debug) this._drawDebug("overlay");
  }

  /* ---- settle debounce: collapse a re-render storm into one re-placement ---- */

  _scheduleSettle() {
    const now = Date.now();
    if (!this._settleStart) this._settleStart = now;
    if (now - this._settleStart >= CONFIG.MAX_SETTLE_MS) {
      this._settle(); // churn won't quiet — force convergence rather than stay unplaced forever
      return;
    }
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => this._settle(), CONFIG.SETTLE_MS);
  }

  _clearSettle() {
    if (this._settleTimer) { clearTimeout(this._settleTimer); this._settleTimer = 0; }
    this._settleStart = 0;
  }

  /** The DOM has been quiet for SETTLE_MS (or hit the cap) → commit one re-placement. */
  _settle() {
    this._clearSettle();
    if (!this.input || !this.shown || this._fallbackLocked) return;
    this._movePill("inserted");
    if (this.inserted.ensureOrAttach(this.input, this.sendButton)) {
      this._wasInserted = true;
      this.mode = "inserted";
      this.inserted.show();
      if (this.debug) this._drawDebug("inserted");
      return;
    }
    if (this._forceInline) {
      // Forced-inline host: never fall back to the floating overlay. The toolbar is just transiently
      // unresolvable (mid re-render); keep the current spot and retry on the next reconcile.
      if (this.inserted.isPlaced()) this.inserted.show();
      if (this.debug) this._drawDebug("inserted");
      return;
    }
    // Couldn't place even after the DOM settled → deterministic, latched flush-dock (no flip-flop).
    this._fallbackLocked = true;
    this._dockSticky = true;
    this._movePill("overlay");
    this.mode = "overlay";
    this.overlay.position(this.input, this.sendButton);
    if (this.debug) this._drawDebug("overlay");
  }

  /* ---- state machine (one shared pill, wherever it is currently mounted) ---- */

  setLabel(t) { this.pill.setLabel(t); }
  setLoading(t) { this.pill.setLoading(t); }
  reset() { this.pill.reset(); }
  setDisabled(d) { this.pill.setDisabled(d); }
  showUndo() { this.pill.showUndo(); }
  hideUndo() { this.pill.hideUndo(); }

  invalidateObstacles() {
    this.overlay.invalidateObstacles();
  }

  /* ---- debug ---- */

  _probeAnchorPositioning() {
    this._probed = true;
    if (!(typeof CSS !== "undefined" && CSS.supports && CSS.supports("anchor-name", "--x"))) {
      console.debug("PromptLord[probe]: CSS anchor positioning unsupported by this engine");
      return;
    }
    try {
      const anchor = document.createElement("div");
      anchor.dataset.promptlord = "probe";
      anchor.style.cssText = "position:fixed;top:100px;left:100px;width:50px;height:20px;anchor-name:--pl-probe;";
      document.body.appendChild(anchor);
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;position-anchor:--pl-probe;left:anchor(--pl-probe right);top:anchor(--pl-probe top);width:10px;height:10px;";
      this.debugHost.shadowRoot.appendChild(probe);
      const r = probe.getBoundingClientRect();
      console.debug("PromptLord[probe]: anchor-name resolves across shadow boundary =",
        Math.abs(r.left - 150) < 4 && Math.abs(r.top - 100) < 4, r);
      probe.remove();
      anchor.remove();
    } catch (e) {
      console.debug("PromptLord[probe] error", e);
    }
  }

  _drawDebug(mode) {
    if (!this.debugHost.isConnected) (document.documentElement || document.body).appendChild(this.debugHost);
    const layer = this.debugLayer;
    layer.replaceChildren();

    const box = (r, color, label, dashed, fill) => {
      if (!r) return;
      const d = document.createElement("div");
      d.className = "box";
      d.style.left = `${r.left}px`;
      d.style.top = `${r.top}px`;
      d.style.width = `${Math.max(0, r.right - r.left)}px`;
      d.style.height = `${Math.max(0, r.bottom - r.top)}px`;
      d.style.border = `1px ${dashed ? "dashed" : "solid"} ${color}`;
      if (fill) d.style.background = fill;
      if (label) {
        const t = document.createElement("span");
        t.textContent = label;
        t.style.background = color;
        d.appendChild(t);
      }
      layer.appendChild(d);
    };
    const badge = (text, color, anchor) => {
      const b = document.createElement("div");
      b.className = "badge";
      b.textContent = text;
      b.style.background = color;
      b.style.left = `${(anchor ? anchor.left : 8)}px`;
      b.style.top = `${(anchor ? anchor.top - 18 : 8)}px`;
      layer.appendChild(b);
    };

    const composer = findComposerContainer(this.input, this.sendButton, CONFIG.MAX_CONTAINER_LEVELS);
    const composerRect = composer ? composer.getBoundingClientRect() : null;
    box(composerRect, "#10b981", "composer", true);

    const found = findControlRow(this.sendButton, {});
    if (found) box(found.row.getBoundingClientRect(), "#a855f7", "row", true);

    if (mode === "inserted") {
      // Tell the truth: the pill is only "INSERTED" if the wrapper is actually connected. When the
      // forced-inline path can't find a sane anchor it removes the wrapper, so show that honestly.
      const placed = this.inserted.isPlaced();
      box(this.inserted.wrapper.getBoundingClientRect(), "#f59e0b", "pill", false, "rgba(245,158,11,0.2)");
      badge(placed ? "INSERTED ✓" : "INLINE · NO SANE ANCHOR", placed ? "#16a34a" : "#f97316", composerRect);
    } else {
      const solve = this.overlay.lastSolve;
      if (solve && solve.slots) {
        for (const o of solve.obstacles || []) box(o, "rgba(239,68,68,0.9)", null, false, "rgba(239,68,68,0.12)");
        for (const key of Object.keys(solve.slots)) {
          const r = solve.slots[key];
          if (!r) continue;
          const chosen = key === solve.chosenKey;
          box(this.overlay._clampRect(r), chosen ? "#f59e0b" : "#3b82f6", key, !chosen, chosen ? "rgba(245,158,11,0.2)" : null);
        }
      }
      const committed = !!(solve && solve.committed);
      badge(
        committed ? `FALLBACK · ${solve.chosenKey} ✓committed` : "FALLBACK · no-commit (hidden)",
        committed ? "#dc2626" : "#f97316",
        composerRect
      );
    }
  }
}
