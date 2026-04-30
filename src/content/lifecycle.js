/**
 * Layer 5 — Lifecycle. Owns WHEN to re-acquire and re-position, never the how.
 *
 *   - searchObserver: a body observer, active ONLY while unattached, to find a
 *     composer appearing (initial load / late SPA render).
 *   - composerObserver: narrowed to the composer container while attached, to
 *     catch the input being replaced or removed (SPA re-render).
 *   - ResizeObserver on the input  → reposition on line-by-line growth.
 *   - IntersectionObserver on input → hide when it scrolls offscreen.
 *   - history pushState/replaceState + popstate → SPA navigation.
 *   - visualViewport + scroll/resize → track the mobile keyboard and layout shifts.
 *   - reconcile: mark dirty on events, recompute ONCE per requestAnimationFrame,
 *     with a low-frequency backstop tick for event-less layout changes.
 *
 * All callbacks are injected; mutations originating from our own overlay are
 * ignored (owns()) so the observers never self-trigger.
 */
const BACKSTOP_MS = 750;

export class Lifecycle {
  /**
   * @param {object} cb
   * @param {() => Element|null} cb.getInput   current attached input (or null)
   * @param {(node:Node)=>boolean} cb.owns     is this node part of our overlay?
   * @param {()=>void} cb.reconcile            recompute position (rAF-coalesced)
   * @param {()=>void} cb.search               try to acquire a composer (unattached)
   * @param {()=>void} cb.reacquire            input changed/removed while attached
   * @param {()=>void} cb.navigate             SPA navigation happened
   * @param {(visible:boolean)=>void} cb.onVisibility  input entered/left viewport
   */
  constructor(cb) {
    this.cb = cb;
    this.dirty = false;
    this.rafId = 0;
    this.backstop = 0;

    this._onScroll = () => this.markDirty();
    this._onResize = () => this.markDirty();
    this._onNav = () => this.cb.navigate?.();

    this._searchObserver = new MutationObserver((records) => this._onSearchMutations(records));
    this._composerObserver = new MutationObserver((records) => this._onComposerMutations(records));
    this._resizeObserver = new ResizeObserver(() => this.markDirty());
    this._intersectionObserver = new IntersectionObserver(
      (entries) => this.cb.onVisibility?.(entries[entries.length - 1].isIntersecting),
      { threshold: 0 }
    );
  }

  start() {
    // Global trackers (cheap, always on).
    window.addEventListener("scroll", this._onScroll, { capture: true, passive: true });
    window.addEventListener("resize", this._onResize, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", this._onResize, { passive: true });
      window.visualViewport.addEventListener("scroll", this._onScroll, { passive: true });
    }
    this._patchHistory();
    window.addEventListener("popstate", this._onNav);
    window.addEventListener("promptlord:locationchange", this._onNav);

    this.backstop = setInterval(() => this.markDirty(), BACKSTOP_MS);
    this.searchMode();
  }

  stop() {
    window.removeEventListener("scroll", this._onScroll, { capture: true });
    window.removeEventListener("resize", this._onResize);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this._onResize);
      window.visualViewport.removeEventListener("scroll", this._onScroll);
    }
    window.removeEventListener("popstate", this._onNav);
    window.removeEventListener("promptlord:locationchange", this._onNav);
    clearInterval(this.backstop);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this._searchObserver.disconnect();
    this._composerObserver.disconnect();
    this._resizeObserver.disconnect();
    this._intersectionObserver.disconnect();
  }

  /* ---- reconcile scheduling (once per frame) ---- */

  markDirty() {
    if (this.dirty) return;
    this.dirty = true;
    this.rafId = requestAnimationFrame(() => {
      this.dirty = false;
      this.rafId = 0;
      this.cb.reconcile?.();
    });
  }

  /* ---- mode switching: searching vs. attached ---- */

  /** Unattached: watch the body broadly for a composer to appear. */
  searchMode() {
    this._composerObserver.disconnect();
    this._resizeObserver.disconnect();
    this._intersectionObserver.disconnect();
    if (document.body) {
      this._searchObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  /** Attached: narrow observation to the composer container + the input itself. */
  observe(input) {
    this._searchObserver.disconnect();

    const container = input.closest("form") || input.parentElement?.parentElement || input.parentElement || input;
    this._composerObserver.disconnect();
    this._composerObserver.observe(container, { childList: true, subtree: true });

    this._resizeObserver.disconnect();
    this._resizeObserver.observe(input);

    this._intersectionObserver.disconnect();
    this._intersectionObserver.observe(input);

    this.markDirty();
  }

  /* ---- observer handlers ---- */

  _isOursOnly(records) {
    for (const rec of records) {
      if (this._touchesOurs(rec)) continue;
      return false; // at least one non-ours mutation
    }
    return true; // every record was about our overlay
  }

  _touchesOurs(rec) {
    if (this.cb.owns?.(rec.target)) return true;
    for (const n of rec.addedNodes) if (n.nodeType === 1 && this.cb.owns?.(n)) return true;
    for (const n of rec.removedNodes) if (n.nodeType === 1 && this.cb.owns?.(n)) return true;
    return false;
  }

  _onSearchMutations(records) {
    if (this._isOursOnly(records)) return;
    this.cb.search?.();
  }

  _onComposerMutations(records) {
    if (this._isOursOnly(records)) return;
    const input = this.cb.getInput?.();
    if (!input || !input.isConnected) {
      this.cb.reacquire?.();
    } else {
      this.cb.invalidate?.(); // toolbar controls may have appeared/disappeared
      this.markDirty(); // layout may have shifted
    }
  }

  /* ---- SPA navigation ---- */

  _patchHistory() {
    if (window.__promptlordHistoryPatched) return;
    window.__promptlordHistoryPatched = true;
    const fire = () => window.dispatchEvent(new Event("promptlord:locationchange"));
    for (const m of ["pushState", "replaceState"]) {
      const orig = history[m];
      history[m] = function (...args) {
        const r = orig.apply(this, args);
        fire();
        return r;
      };
    }
  }
}
