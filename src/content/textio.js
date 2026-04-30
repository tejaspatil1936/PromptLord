/**
 * Layer 4 — Text I/O. Reads and writes the prompt box uniformly across
 * <textarea>/<input>, contenteditable, and role=textbox.
 *
 * IMPORTANT FIX vs. the original implementation: writing text NEVER dispatches
 * synthetic Enter (keydown/keyup) events. On several sites an Enter keydown
 * submits the prompt, so insertion is fully decoupled from anything Enter-like.
 *
 * Rich contenteditable editors (Lexical on Perplexity, ProseMirror on Claude, Quill,
 * Draft) own their own internal state and reconcile the DOM from it — a raw innerHTML
 * write is silently REVERTED. So the contenteditable path is verify-and-escalate:
 * native insertText → (verify) → synthetic paste → (verify) → raw DOM write. We only
 * escalate when a read-back proves the previous attempt didn't land, so a working
 * insert is never double-applied.
 */
import { escapeHtml } from "./util.js";

function isFormField(el) {
  return el.tagName === "TEXTAREA" || el.tagName === "INPUT";
}

function isContentEditable(el) {
  // role=textbox is commonly a contenteditable div; treat both the same.
  return el.isContentEditable || el.getAttribute("contenteditable") === "true" ||
    el.getAttribute("role") === "textbox";
}

/** Read the current text out of any supported prompt box. */
export function readText(el) {
  if (!el) return "";
  if (isFormField(el)) return el.value;

  // Rich editors (ProseMirror/Lexical/Quill/etc.) usually wrap lines in <p>.
  const paragraphs = el.querySelectorAll("p");
  if (paragraphs.length > 0) {
    return Array.from(paragraphs).map((p) => p.innerText).join("\n");
  }
  return el.innerText || el.textContent || "";
}

/**
 * Replace the prompt box contents with `text`. Picks the native path per editor type;
 * for rich contenteditables it verifies the write actually landed and escalates if not.
 * No Enter events are ever fired.
 */
export function writeText(el, text) {
  if (!el) return;
  el.focus();
  if (isFormField(el)) {
    writeFormField(el, text);
    return;
  }
  if (isContentEditable(el)) {
    writeContentEditable(el, text);
  }
}

/* ---------- <textarea> / <input> ---------- */

function writeFormField(el, text) {
  // execCommand insertText keeps React's value tracker in sync via a real beforeinput.
  try {
    el.select();
    if (document.execCommand && document.execCommand("insertText", false, text)) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
  } catch (_) {
    /* fall through to the native setter */
  }

  // React-controlled field — set via the native value setter so React notices the change.
  const proto = el.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
  el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: text }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/* ---------- contenteditable / role=textbox (verify-and-escalate) ---------- */

function selectAllContents(el) {
  try {
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.addRange(range);
  } catch (_) {
    /* selection is best-effort */
  }
}

/** Tolerant comparison: editors may re-wrap, trim, or add a trailing newline. */
function contentMatches(el, text) {
  const got = readText(el).replace(/\s+/g, " ").trim();
  const want = text.replace(/\s+/g, " ").trim();
  if (!want) return got.length === 0;
  return got === want || got.includes(want);
}

function writeContentEditable(el, text) {
  // 1) Native insertText over a select-all → REPLACES content and fires a trusted beforeinput that
  //    Lexical/ProseMirror/Draft fold into their own state (the only path most rich editors respect).
  el.focus();
  selectAllContents(el);
  try { document.execCommand("insertText", false, text); } catch (_) {}

  // 2) Verify after the editor reconciles; escalate ONLY if the text didn't actually land, so a
  //    working insert is never double-applied.
  requestAnimationFrame(() => {
    if (!el.isConnected || contentMatches(el, text)) return;
    if (pasteIntoContentEditable(el, text)) {
      requestAnimationFrame(() => {
        if (!el.isConnected || contentMatches(el, text)) return;
        domWriteContentEditable(el, text);
      });
      return;
    }
    domWriteContentEditable(el, text);
  });
}

/**
 * Simulate a paste — the most editor-agnostic insert for rich frameworks: Lexical and ProseMirror
 * both read `text/plain` off the clipboard data and fold it into their state. Uses a synthetic
 * DataTransfer (no clipboard permission, no real clipboard touched). Returns false if the engine
 * can't construct the event.
 */
function pasteIntoContentEditable(el, text) {
  try {
    el.focus();
    selectAllContents(el);
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Last resort: write the DOM directly. Loosely-managed contenteditables keep this; strictly-managed
 * ones (Lexical) may revert it, but by this point the editor-native paths have already failed.
 */
function domWriteContentEditable(el, text) {
  try {
    if (el.querySelector("p")) el.innerHTML = `<p>${escapeHtml(text)}</p>`;
    else el.innerText = text;
  } catch (_) {
    el.textContent = text;
  }
  el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: text }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
