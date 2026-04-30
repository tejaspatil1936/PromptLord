/**
 * Layer 2 — Adapter registry. Per-hostname HINTS (data, not code) that patch the
 * rare site the generic scorer gets wrong. With NO adapter the scorer still works;
 * an adapter only ever narrows or overrides. Intentionally near-empty: ChatGPT,
 * Grok and Stitch are handled by the generic detector with no entries here. Claude
 * and Gemini carry only a `placement:"inline"` hint — detection stays generic, but
 * their rich editors defeat the generic insertion path, so placement is forced.
 *
 * Shape of an adapter (all fields optional):
 *   {
 *     container: "<css>",   // scope candidate search to this element
 *     input:     "<css>",   // force this element as the prompt box
 *     send:      "<css>",   // force this element as the send button
 *     placement: "dock",    // skip inline insertion; flush-dock the pill to the composer edge
 *     placement: "inline",  // force trusted inline insertion (anchor to send, skip verify, watchdog)
 *     pillScale: 0.78,      // scale the pill's matched font/width (host controls are over/undersized)
 *     pillHeightScale: 0.9, // optional separate height scale (defaults to pillScale)
 *     suppress:  true,      // never attach on this host
 *   }
 *
 * REMOTE SEAM: today this is a local literal. `resolveAdapter` is the single
 * lookup point, so a future version can merge a remotely-fetched table here
 * (filter-list style) without touching any caller.
 */

const LOCAL_ADAPTERS = {
  // Claude: DETERMINISTIC, TRUSTED inline insertion. The pill belongs in the bottom toolbar (between
  // the mic and send), which only a real flex-child insert can produce — but the generic path fails
  // here: the strict before/after reflow-diff verify rejects a valid placement, and tiptap's re-render
  // bursts strip the node. `placement:"inline"` (1) anchors directly to the send button, (2) skips the
  // strict verify (Claude's gap+grow-spacer row reflows around the pill on its own), and (3) glues the
  // node in place with a synchronous re-insert watchdog (re-inserts BEFORE paint, so re-renders can't
  // make it hop). No class strings, no fixed pixels — send-button anchor + computed-style geometry.
  "claude.ai": { placement: "inline" },

  // Gemini: same situation as Claude — its rich (Angular rich-textarea) composer defeats generic
  // inline insertion, so without this it floats the pill in the overlay dock below the box. The
  // trusted-inline path anchors to the send button and watchdogs the node, putting the pill inline
  // in the toolbar (between mic and send). gemini.google.com is NOT denied (only mail/docs/etc. are).
  // Gemini's composer controls are taller than other hosts, so matching the send button oversizes the
  // pill. pillScale shrinks the font/width; pillHeightScale keeps the height a touch taller than the
  // width scale so the pill isn't squat. Two independent knobs — tune to taste.
  "gemini.google.com": { placement: "inline", pillScale: 0.78, pillHeightScale: 0.9 },

  // Microsoft Copilot — the generic engine should handle it (textarea#userInput; the send button
  // appears only after typing, like ChatGPT/Grok). Populate this ONLY in response to an OBSERVED
  // failure (e.g. { input: "#userInput", send: "<observed send selector>" }), not preemptively:
  // "copilot.microsoft.com": {},

  // Example of what an override would look like:
  // "example.com": { container: "#composer", send: "button.submit" },
};

// Populated later if a remote table is ever fetched. Local entries win on conflict.
let remoteAdapters = {};

/** Merge remote hints in (called by a future updater; never required). */
export function applyRemoteAdapters(table) {
  remoteAdapters = table || {};
}

function lookup(table, hostname) {
  if (table[hostname]) return table[hostname];
  // suffix match so "chat.example.com" can inherit "example.com"
  const key = Object.keys(table).find((k) => hostname.endsWith("." + k));
  return key ? table[key] : null;
}

/** Return the merged adapter for a hostname, or null if none applies. */
export function resolveAdapter(hostname) {
  const remote = lookup(remoteAdapters, hostname);
  const local = lookup(LOCAL_ADAPTERS, hostname);
  if (!remote && !local) return null;
  return { ...(remote || {}), ...(local || {}) };
}
