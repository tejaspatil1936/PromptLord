/**
 * Layer 3 (presentation) — the Enhance pill itself: button + undo/status affordance
 * + the button state machine. Pure view, no placement logic. It is mounted into a
 * shadow root provided by whichever placement is active (inserted flex-child or the
 * overlay popover), so the markup/styles/state live in exactly one place while two
 * independent instances can exist (one per placement).
 *
 * The button reads optional CSS custom properties so a placement can match host
 * control metrics (`--pl-h`, `--pl-radius`, `--pl-font-size`); unset → the default
 * pill look. Appearance, hover, disabled, dark mode, and undo are unchanged.
 */
const PILL_STYLES = `
.pl-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  pointer-events: auto;
  font: 500 var(--pl-font-size, 13px)/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.pl-btn {
  box-sizing: border-box;
  appearance: none;
  display: inline-flex; align-items: center; gap: 4px;
  height: var(--pl-h, auto);
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: var(--pl-radius, 999px);
  background: rgba(255,255,255,0.92);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  color: #4b5563;
  font: inherit; font-weight: 500;
  padding: 4px 10px;
  white-space: nowrap; user-select: none;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.16);
  transition: background-color .15s ease, opacity .15s ease;
}
.pl-btn:hover { background: #fff; }
.pl-btn:disabled { cursor: default; opacity: .7; }

.pl-status {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  pointer-events: auto;
  display: none;
  align-items: center; gap: 6px;
  white-space: nowrap;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(17,24,39,0.92);
  color: #f9fafb;
  box-shadow: 0 1px 3px rgba(0,0,0,0.25);
  font-size: 12px;
}
.pl-status.show { display: inline-flex; }
.pl-undo { cursor: pointer; color: #93c5fd; text-decoration: underline; }

@media (prefers-color-scheme: dark) {
  .pl-btn {
    border-color: rgba(255,255,255,0.14);
    background: rgba(40,40,46,0.92);
    color: #e5e7eb;
  }
  .pl-btn:hover { background: rgba(60,60,68,0.96); }
}
`;

export class Pill {
  constructor({ onClick, onUndo }) {
    this.onClick = onClick;
    this.onUndo = onUndo;
    this._build();
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "pl-pill";
    this.root.dataset.promptlord = "pill";

    this.btn = document.createElement("button");
    this.btn.className = "pl-btn";
    this.btn.type = "button";
    this.btn.dataset.promptlord = "button";
    this.btn.textContent = "Enhance";
    this.btn.title = "Enhance your prompt (Ctrl+Shift+E)";
    this.btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick?.();
    });

    this.status = document.createElement("div");
    this.status.className = "pl-status";
    this.status.dataset.promptlord = "status";

    this.root.append(this.status, this.btn);
  }

  /** Append a private <style> + the pill into the given shadow root (moves it). */
  mount(shadowRoot) {
    if (!shadowRoot.querySelector("style[data-promptlord-style]")) {
      const style = document.createElement("style");
      style.dataset.promptlordStyle = "1";
      style.textContent = PILL_STYLES;
      shadowRoot.appendChild(style);
    }
    shadowRoot.appendChild(this.root);
  }

  /* ---- button state machine (unchanged UX) ---- */

  setLabel(text) {
    this.btn.textContent = text;
  }

  setLoading(text = "Enhancing...") {
    this.btn.textContent = text;
    this.btn.disabled = true;
  }

  reset() {
    this.btn.textContent = "Enhance";
    this.btn.disabled = false;
    this.btn.style.cursor = "";
  }

  setDisabled(disabled) {
    this.btn.disabled = disabled;
  }

  /** "Enhanced ✓ · Undo" affordance, without overloading the button label. */
  showUndo() {
    this.status.replaceChildren();
    const check = document.createElement("span");
    check.textContent = "Enhanced ✓";
    const dot = document.createElement("span");
    dot.textContent = "·";
    const undo = document.createElement("span");
    undo.className = "pl-undo";
    undo.dataset.promptlord = "undo";
    undo.textContent = "Undo";
    undo.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onUndo?.();
      this.hideUndo();
    });
    this.status.append(check, dot, undo);
    this.status.classList.add("show");
  }

  hideUndo() {
    this.status.classList.remove("show");
  }
}
