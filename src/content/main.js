/**
 * Orchestrator. Wires the six layers together and owns the enhance UX (cooldown,
 * loading/error/limit states, the Ctrl/Cmd+Shift+E shortcut, undo). It holds no
 * detection or positioning logic itself — it coordinates the modules that do.
 *
 * Flow:
 *   governance gate → acquire a prompt box (memory → scorer) → attach overlay →
 *   reposition via lifecycle reconciler → enhance through the unchanged transport.
 */
import { Overlay } from "./overlay.js";
import { Lifecycle } from "./lifecycle.js";
import {
  detect, detectFocused, isDisqualified, resolveSend,
  matchDescriptor, buildDescriptor, EDITABLE_SELECTOR,
} from "./detection.js";
import { readText, writeText } from "./textio.js";
import { enhance } from "./transport.js";
import { resolveAdapter } from "./adapters.js";
import {
  isDenied, isEnabled, onToggleChange, getMemory, setMemory,
} from "./governance.js";

const COOLDOWN_MS = 5000;

// With `all_frames: true`, every same-origin frame runs its own controller. Only the top
// frame acquires proactively (memory/scorer); a sub-frame attaches to a composer ONLY when
// the user focuses it, and shows a pill ONLY while the frame holds focus — so exactly one
// frame owns a visible pill at any time.
const IS_TOP = (() => {
  try { return window.top === window.self; } catch (_) { return true; }
})();

class PromptLord {
  constructor() {
    this.hostname = location.hostname;
    this.adapter = resolveAdapter(this.hostname);
    this.input = null;
    this.sendButton = null;
    this.memory = null;
    this.memorySaved = false;

    this.enabled = false;
    this.started = false;
    this.loading = false;
    this.cooldownActive = false;
    this.inViewport = true;
    this.lastClickTime = 0;
    this.originalText = null;

    this._acqRaf = 0;
    this._sendChase = 0;
    this._undoTimer = 0;
    this._inputHandler = null;
    this._dormantArmed = false;
    this._dormantFocus = null;
    this._dormantObserver = null;
    this._winFocusHandler = null;
  }

  /* ---------- governance gate ---------- */

  async boot() {
    // Never run on inappropriate sites (denylist) or where an adapter explicitly suppresses us.
    if (isDenied(this.hostname) || this.adapter?.suppress) return;

    // Live per-site toggle (from an options page / another tab) regardless of state.
    onToggleChange(this.hostname, (enabled) => this._onToggle(enabled));

    if (!(await isEnabled(this.hostname))) {
      this.enabled = false;
      return;
    }
    this.enabled = true;
    this.memory = await getMemory(this.hostname);
    this._armOrStart();
  }

  _onToggle(enabled) {
    if (enabled && !this.started) {
      this.enabled = true;
      getMemory(this.hostname).then((m) => {
        this.memory = m;
        this._armOrStart();
      });
    } else if (!enabled) {
      this.enabled = false;
      if (this.started) this._stop();
      else this._disarmDormant();
    }
  }

  /* ---------- dormant early-out (per-frame) ---------- */

  /** Stand up the full overlay/observer machinery only if this frame actually has a usable
   *  editable; otherwise stay dormant and spin up lazily when one appears / is focused. */
  _armOrStart() {
    if (!this.enabled || this.started) return;
    if (this._hasViableEditable()) this._start();
    else this._armDormant();
  }

  /** Cheap "is there anything to attach to here?" — mirrors detect()'s adapter handling
   *  (container scope + forced-input override) so the dormancy gate never diverges from what
   *  detection would actually attach to. */
  _hasViableEditable() {
    const a = this.adapter;
    const scope = (a && a.container && document.querySelector(a.container)) || document;
    if (a && a.input) {
      const el = scope.querySelector(a.input);
      return !!(el && !isDisqualified(el));
    }
    const els = scope.querySelectorAll(EDITABLE_SELECTOR);
    for (let i = 0; i < els.length; i++) {
      if (!isDisqualified(els[i])) return true;
    }
    return false;
  }

  _armDormant() {
    if (this._dormantArmed) return;
    this._dormantArmed = true;

    // Focus is ground truth: the moment the user focuses an editable, wake and attach to it.
    this._dormantFocus = (e) => {
      const el = e.target;
      if (el && el.nodeType === 1 && el.matches && el.matches(EDITABLE_SELECTOR) && !isDisqualified(el)) {
        this._disarmDormant();
        this._start();
        this.onFocusIn(e); // _start()'s focusin listener missed this in-flight event
      }
    };
    document.addEventListener("focusin", this._dormantFocus, true);

    // Top frame keeps proactive attach (a cheap childList watch wakes it when a composer
    // renders late). Sub-frames stay fully observer-free — no machinery in ad/consent iframes.
    if (IS_TOP) {
      this._dormantObserver = new MutationObserver(() => {
        if (!this.started && this.enabled && this._hasViableEditable()) {
          this._disarmDormant();
          this._start();
        }
      });
      const target = document.body || document.documentElement;
      if (target) this._dormantObserver.observe(target, { childList: true, subtree: true });
    }
  }

  _disarmDormant() {
    this._dormantArmed = false;
    if (this._dormantFocus) {
      document.removeEventListener("focusin", this._dormantFocus, true);
      this._dormantFocus = null;
    }
    if (this._dormantObserver) {
      this._dormantObserver.disconnect();
      this._dormantObserver = null;
    }
  }

  /* ---------- lifecycle wiring ---------- */

  _start() {
    if (this.started) return;
    this.started = true;
    this._disarmDormant();

    this.overlay = new Overlay({
      onClick: () => this.handleEnhance(),
      onUndo: () => this.handleUndo(),
      forceDock: this.adapter?.placement === "dock", // skip inline, flush-dock to the composer edge
      forceInline: this.adapter?.placement === "inline", // e.g. Claude: trusted inline insert + watchdog
      pillScale: this.adapter?.pillScale, // e.g. Gemini: shrink the pill's width/font vs oversized controls
      pillHeightScale: this.adapter?.pillHeightScale, // optional independent height scale (Gemini)
    });

    this.lifecycle = new Lifecycle({
      getInput: () => this.input,
      owns: (node) => this.overlay.owns(node),
      reconcile: () => {
        // Backstop: if the whole composer was swapped out without firing the
        // narrowed observer (or a SPA nav), re-acquire instead of positioning.
        if (this.input && !this.input.isConnected) {
          this._scheduleAcquire();
          return;
        }
        // Long-tail backstop for a send button that mounts/animates in without a DOM mutation
        // (Claude): re-resolve it whenever it's missing so the periodic tick eventually catches it.
        if (this.input && (!this.sendButton || !this.sendButton.isConnected)) this._refreshSendButton();
        this.overlay.position();
      },
      search: () => this._scheduleAcquire(),
      reacquire: () => this._scheduleAcquire(),
      navigate: () => this._scheduleAcquire(),
      invalidate: () => {
        this._refreshSendButton(); // send button often appears only after text is typed
        this.overlay?.invalidateObstacles();
      },
      onVisibility: (visible) => this._onVisibility(visible),
    });
    this.lifecycle.start();

    this._keyHandler = (e) => this.onKeyDown(e);
    this._focusHandler = (e) => this.onFocusIn(e);
    document.addEventListener("keydown", this._keyHandler, true);
    document.addEventListener("focusin", this._focusHandler, true);

    // Sub-frame ownership: re-evaluate visibility when this frame gains/loses focus so the
    // pill shows only while the frame actually owns the active composer.
    if (!IS_TOP) {
      this._winFocusHandler = () => this.updateVisibility();
      window.addEventListener("focus", this._winFocusHandler);
      window.addEventListener("blur", this._winFocusHandler);
    }

    this.acquire();
  }

  _stop() {
    this.started = false;
    this._disarmDormant();
    this._cancelSendChase();
    if (this._keyHandler) document.removeEventListener("keydown", this._keyHandler, true);
    if (this._focusHandler) document.removeEventListener("focusin", this._focusHandler, true);
    if (this._winFocusHandler) {
      window.removeEventListener("focus", this._winFocusHandler);
      window.removeEventListener("blur", this._winFocusHandler);
      this._winFocusHandler = null;
    }
    this._detachInputListeners();
    this.lifecycle?.stop();
    this.overlay?.destroy();
    this.overlay = null;
    this.lifecycle = null;
    this.input = null;
  }

  /* ---------- acquisition ---------- */

  _scheduleAcquire() {
    if (this._acqRaf) return;
    this._acqRaf = requestAnimationFrame(() => {
      this._acqRaf = 0;
      this.acquire();
    });
  }

  acquire() {
    if (!this.enabled || !this.started) return;

    // Keep the current box if it's still a live, valid prompt box.
    if (this.input && this.input.isConnected && !isDisqualified(this.input)) {
      this.lifecycle.markDirty();
      return;
    }

    // Sub-frames never acquire proactively: shared per-host memory or the scorer can match an
    // editable in a frame the user isn't using (→ cross-frame duplicate). They attach only to
    // a box the user actually focuses (onFocusIn → detectFocused), which IS ownership.
    if (!IS_TOP) {
      if (this.input) this.detachInput();
      return;
    }

    // 1) Per-host memory: the box the user previously confirmed here.
    if (this.memory) {
      const el = matchDescriptor(this.memory);
      if (el) {
        this.attachTo({ input: el, sendButton: resolveSend(el, this.adapter) });
        return;
      }
    }

    // 2) Generic scorer.
    const det = detect(this.adapter);
    if (det && det.confident) {
      this.attachTo(det);
    } else if (this.input) {
      // Previously-attached box is gone and nothing confident replaces it.
      this.detachInput();
    }
    // Otherwise: stay in search mode and wait for focus (ground truth).
  }

  attachTo({ input, sendButton }) {
    if (this.input === input) {
      this.overlay.setSendButton(sendButton);
      this.lifecycle.markDirty();
      return;
    }
    this._detachInputListeners();
    this.input = input;
    this.sendButton = sendButton || null;
    this.memorySaved = false;

    this.overlay.attach(input, sendButton);
    this.lifecycle.observe(input);
    this._attachInputListeners(input);
    this.inViewport = true;
    this.updateVisibility();
  }

  detachInput() {
    this._cancelSendChase();
    this._detachInputListeners();
    this.overlay.detach();
    this.input = null;
    this.sendButton = null;
    this.lifecycle.searchMode();
  }

  /** Re-resolve the send button (it commonly mounts only once text is present) and
   *  tell the overlay, so insertion can find the control row. */
  _refreshSendButton() {
    if (!this.input || !this.overlay) return;
    const sb = resolveSend(this.input, this.adapter);
    if (sb && sb !== this.sendButton) {
      this.sendButton = sb;
      this.overlay.setSendButton(sb);
    }
  }

  /**
   * Bounded rAF poll to catch a send button that appears AFTER text but fades/grows in via a CSS
   * transition (Claude) — transitions fire no DOM mutations, so the mutation-driven _refreshSendButton
   * can miss it for seconds. Polling per frame lands the pill within a frame of the button becoming
   * detectable. Self-terminating: stops as soon as it resolves (and nudges one reconcile to place the
   * pill that frame) or after a short deadline, after which the reconcile backstop still covers it.
   */
  _chaseSendButton() {
    if (this._sendChase) return; // a chase is already running
    if (!this.input || (this.sendButton && this.sendButton.isConnected)) return; // already resolved
    const start = Date.now();
    const tick = () => {
      this._sendChase = 0;
      if (!this.started || !this.input) return;
      this._refreshSendButton();
      if (this.sendButton && this.sendButton.isConnected) {
        this.lifecycle.markDirty(); // newly resolved → place the pill this frame
        return;
      }
      if (Date.now() - start > 2500) return; // give up; the reconcile backstop still covers the tail
      this._sendChase = requestAnimationFrame(tick);
    };
    this._sendChase = requestAnimationFrame(tick);
  }

  _cancelSendChase() {
    if (this._sendChase) {
      cancelAnimationFrame(this._sendChase);
      this._sendChase = 0;
    }
  }

  _attachInputListeners(input) {
    this._inputHandler = () => this.onInput();
    input.addEventListener("input", this._inputHandler);
    input.addEventListener("keyup", this._inputHandler);
  }

  _detachInputListeners() {
    if (this.input && this._inputHandler) {
      this.input.removeEventListener("input", this._inputHandler);
      this.input.removeEventListener("keyup", this._inputHandler);
    }
    this._inputHandler = null;
  }

  /* ---------- focus = ground truth (also powers teach mode) ---------- */

  onFocusIn(e) {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (this.overlay.owns(el)) return;

    const r = detectFocused(el, this.adapter);
    if (!r) return;
    if (this.input === r.input) {
      this.overlay.setSendButton(r.sendButton);
      return;
    }
    // The user is typing here — trust it over our prediction and remember it.
    this.attachTo(r);
  }

  /* ---------- visibility ---------- */

  onInput() {
    this.updateVisibility();
    this.lifecycle.markDirty();
    this._chaseSendButton(); // appear ASAP once the (often animated-in) send button is detectable

    if (!this.memorySaved) {
      const text = readText(this.input);
      if (text && text.trim().length > 0) {
        this.memorySaved = true; // confirmed by typing → remember this box for the host
        setMemory(this.hostname, buildDescriptor(this.input));
      }
    }
  }

  _onVisibility(visible) {
    this.inViewport = visible;
    this.updateVisibility();
  }

  /** A frame may show its pill only if it owns the active composer: the top frame always
   *  qualifies; a sub-frame only while it actually holds focus. */
  _mayShow() {
    if (IS_TOP) return true;
    try { return document.hasFocus(); } catch (_) { return true; }
  }

  updateVisibility() {
    if (!this.input || !this.overlay) return;
    if (this.loading && this._mayShow()) {
      this.overlay.show();
      return;
    }
    const hasText = readText(this.input).trim().length > 0;
    if (hasText && this.inViewport && this._mayShow()) this.overlay.show();
    else this.overlay.hide();
  }

  /* ---------- enhance flow (preserves the original UX) ---------- */

  onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "E" || e.key === "e")) {
      if (this.input && !this.loading && readText(this.input).trim()) {
        e.preventDefault();
        this.handleEnhance();
      }
    }
  }

  async handleEnhance() {
    if (!this.input || this.loading) return;

    const text = readText(this.input);
    if (!text.trim()) return;

    // 5s cooldown — mirrors the original rate-limit behavior.
    const now = Date.now();
    const since = now - this.lastClickTime;
    if (since < COOLDOWN_MS) {
      if (!this.cooldownActive) {
        const remaining = Math.ceil((COOLDOWN_MS - since) / 1000);
        this.cooldownActive = true;
        this.overlay.setLabel(`Wait ${remaining}s`);
        this.overlay.setDisabled(true);
        setTimeout(() => {
          this.cooldownActive = false;
          this.overlay.reset();
        }, remaining * 1000);
      }
      return;
    }

    this.lastClickTime = now;
    this.loading = true;
    this.overlay.hideUndo();
    this.overlay.setLoading("Enhancing...");

    try {
      const original = text;
      const enhanced = await enhance(text);
      this.originalText = original;
      writeText(this.input, enhanced);
      this.loading = false;
      this.overlay.reset();
      this.showUndoTransient();
      this.updateVisibility();
    } catch (err) {
      this.loading = false;
      const msg = err && err.message ? err.message : "";
      if (msg.includes("FREE_LIMIT_REACHED")) {
        this.overlay.setLabel("Limit reached");
        setTimeout(() => {
          alert("Rate limit reached. Please try again later.");
          this.overlay.reset();
        }, 100);
      } else if (msg === "EXTENSION_CONTEXT_INVALIDATED") {
        this.overlay.reset(); // transport already alerted the user
      } else {
        console.error("PromptLord: enhance failed", err);
        this.overlay.setLabel("Error");
        setTimeout(() => this.overlay.reset(), 2000);
      }
    }
  }

  showUndoTransient() {
    this.overlay.showUndo();
    clearTimeout(this._undoTimer);
    this._undoTimer = setTimeout(() => this.overlay?.hideUndo(), 12000);
  }

  handleUndo() {
    if (this.input && typeof this.originalText === "string") {
      writeText(this.input, this.originalText);
      this.updateVisibility();
      this.lifecycle.markDirty();
    }
  }
}

// Single instance per frame; guard against accidental double-injection.
if (!window.__promptlordController) {
  window.__promptlordController = new PromptLord();
  window.__promptlordController.boot();
}
