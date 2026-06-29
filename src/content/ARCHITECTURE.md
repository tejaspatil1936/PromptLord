# Content layer architecture

> ⚠️ **Status: alternative design — not currently wired into the manifest.**
> The extension that ships today loads the **monolithic** `src/content/index.js`
> (`manifest.json` → `content_scripts.js`). This document describes a separate,
> more advanced **capability-based / layered** redesign of the content script that
> lives in this folder (`bootstrap.js`, `detection.js`, `overlay.js`, …) but is
> **not loaded at runtime**: the manifest does not inject `bootstrap.js` and has no
> `web_accessible_resources`, so the dynamic `import()` below cannot resolve. To
> make this design live, switch `content_scripts.js` to `bootstrap.js` and expose
> `src/content/*.js` via `web_accessible_resources`. Until then, treat the modules
> here as an in-progress alternative to `index.js`.

The content script was re-architected from one monolithic `PromptEnhancer` class
(site-coupled, hardcoded ChatGPT/Claude/Gemini selectors, button inserted into the
host's layout) into a **capability-based, layered system**. It now recognizes a
prompt box *generically* on almost any site and positions the button by
browser-native tethering instead of inserting into the host's DOM flow. Knowing a
specific site is an optional refinement, not a requirement.

## Module map (six layers)

| File | Layer | Responsibility |
|------|-------|----------------|
| `detection.js` | 1 — Detection | The only intelligent component. Scores all visible editables and picks the real prompt box **and** its send button. Hard disqualifiers first, then language-agnostic weighted signals (send-affordance dominates; text matching is minor). Focus-as-ground-truth + per-host memory descriptors. |
| `adapters.js` | 2 — Adapter registry | Per-hostname hints **as data** (scope/override/suppress). Empty by default — the scorer handles the known sites unaided. `resolveAdapter()` is the single seam where a remote (filter-list) table could later be merged. |
| `pill.js` | 3 — Placement (view) | The Enhance pill itself: button + undo/status affordance + button state machine. Pure view, mounted into a shadow root by whichever placement is active. Reads `--pl-h`/`--pl-radius`/`--pl-font-size` so a placement can match host control metrics. |
| `insertion.js` | 3 — Placement (PRIMARY) | `InsertedPlacement`: inserts the pill as a real **flex child** of the host's control row (`findControlRow`) so the host's own layout reflows to make room — native inline position + spacing. Pill lives in the wrapper's own shadow root (style isolation); metrics matched to a neighbor control; insertion confirmed by a before/after reflow diff; re-attached (bounded retry) when a re-render strips it. `INSERTION` config block. |
| `overlay.js` | 3 — Placement (facade + FALLBACK) | Facade `Overlay` (stable interface to `main.js`) that prefers `InsertedPlacement` and locks to the fallback `OverlayPlacement` when safe insertion isn't possible. `OverlayPlacement` is the occupancy solver: a top-layer popover positioned by JS to the first of five candidate slots that collides with nothing (measured against the composer container). Owns the DEBUG overlay (composer/row/INSERTED-or-FALLBACK badge/solve). |
| `textio.js` | 4 — Text I/O | Uniform read/write across textarea / contenteditable / role=textbox. execCommand-insertText path + React value-setter fallback. **Never dispatches Enter events.** |
| `lifecycle.js` | 5 — Lifecycle | When to re-acquire/re-position: narrowed MutationObservers (search vs. composer), ResizeObserver, IntersectionObserver, history pushState/popstate, visualViewport, scroll/resize. Reconcile coalesced to one `requestAnimationFrame` + a low-frequency backstop tick. Ignores self-mutations via `owns()`. |
| `governance.js` | 6 — Governance | Where it may run: static denylist (email/banking/docs/auth), per-site on/off toggle, per-host input memory. All in `chrome.storage.local`. |
| `transport.js` | — | The unchanged backend bridge (`chrome.runtime.sendMessage({action:"enhance_prompt"})`). Behavior identical to the old `callApi`. |
| `util.js` | — | Stateless geometry/DOM helpers. |
| `main.js` | — | Orchestrator. Wires the layers and owns the enhance UX (cooldown, loading/error/limit states, `Ctrl/Cmd+Shift+E`, undo). Holds no detection/positioning logic itself. |
| `bootstrap.js` | — | Classic content-script entry for this layered design — the single file the manifest *would* inject if this design were wired up (see the status note above). |

## Key decisions & tradeoffs

- **ES modules without a bundler.** MV3 content scripts listed in the manifest are
  *classic* scripts and can't `import`/`export`. So the manifest injects only
  `bootstrap.js`, which `import(chrome.runtime.getURL("…/main.js"))`s the real
  module graph. All layer files are listed in `web_accessible_resources`.
  *Tradeoff:* the module files are world-readable (acceptable for this extension)
  and a strict page CSP could in theory interfere with the dynamic import.

- **Placement is insertion-first, overlay-solver as the net.** A wide "Enhance"
  label has no inline gap to dodge into on a packed single-row toolbar, so a pure
  coordinate solver can only evict it to whitespace (a detached sticker). The
  primary mechanism instead **inserts the pill as a real flex child of the host's
  control row** (`insertion.js`) and lets the host's own flexbox reflow the row to
  make room — native inline placement + spacing, which no solver can synthesize.
  Style bleed is contained by giving the inserted node its **own shadow root**;
  framework stripping is handled by **re-attach** driven off the reconcile tick
  (`wrapper.isConnected`) with a bounded retry that gives up to the fallback rather
  than fighting forever. Insertion is **null-biased** (`findControlRow` rejects
  absolute send buttons, composer-shell-sized ancestors, and `space-*` rows) and
  **verified** by a before/after reflow diff (row didn't grow/wrap, send didn't
  shrink or get shoved off-screen, no induced overflow). If no clean row exists or
  verification fails, the facade locks (hysteresis) to **`OverlayPlacement`** — the
  occupancy solver: a top-layer popover positioned by JS to the first of five
  candidate slots whose **clamped** rect collides with nothing in a
  composer-scoped obstacle map (outside-container slots are the accuracy floor, so
  placement is always achievable). CSS Anchor Positioning is unused — it can't
  express "one slot of five avoiding N obstacles," and a shadow-hosted element
  doesn't resolve a light-DOM `anchor-name` across the tree-scope boundary anyway
  (a DEBUG-only `_probeAnchorPositioning` logs this).
  *Tradeoff (deliberate, scoped):* this reverses the rebuild's "never insert into
  host layout" rule for the primary path, accepting re-attach complexity because
  delegating "make room" to the host's flexbox is the only way a wide label sits
  natively in a packed row.

- **Disqualifiers carry the precision; signals carry the recall.** Rejecting
  disabled/readonly/offscreen/nav-header/sensitive-input candidates *before*
  scoring is what keeps the scorer from ever considering login fields or chrome.
  The weighted score then only has to separate "real composer" from "search /
  comment," which the send-affordance + text signals do (validated: search 0.03,
  comment 0.29, composers 0.7–0.8, all below/above the 0.5 threshold).

- **Ambiguity yields, focus decides.** Two genuinely-similar candidates (margin <
  0.12) attach to neither — observing where the user actually types (`focusin`,
  lower threshold) beats guessing. Typing also confirms the box and stores a
  per-host descriptor, so revisits skip detection entirely. This doubles as
  "teach mode": on any site the user can simply click their box to designate it.

- **Governance in code, not the manifest.** The manifest matches broadly
  (`http(s)://*/*`, `all_frames: true`) so same-origin embedded composers are
  reachable; the denylist + per-site toggle gate injection at runtime. Hard
  ceiling accepted: cross-origin iframes and closed shadow roots are unreachable.

- **Backend untouched.** `src/background.js` and the message contract are
  unchanged; `transport.js` calls it exactly as before.
