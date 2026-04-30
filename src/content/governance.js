/**
 * Layer 6 — Governance. Decides WHERE the extension is allowed to run and
 * stores per-site state. Injection is gated in code (here), not in the manifest,
 * so the manifest can match broadly while we still stay out of inappropriate sites.
 *
 * Three pieces of state, all in chrome.storage.local:
 *   - per-site on/off toggle (user controlled)
 *   - per-host input memory (a descriptor of the box the user confirmed)
 * plus a static denylist (compiled in; structured to be remotely replaceable later,
 * same "filter-list" model as the adapter registry).
 */

const STORE_TOGGLES = "promptlord:sites";
const STORE_MEMORY = "promptlord:memory";

/**
 * Hostname suffixes where a prompt enhancer is inappropriate: email, banking,
 * auth, and document editors. Matched as suffixes so subdomains are covered.
 * Not exhaustive by design — the per-site toggle is the user's escape hatch, and
 * this list could later be fetched/updated remotely without an extension release.
 */
const DENYLIST = [
  // Email
  "mail.google.com", "outlook.live.com", "outlook.office.com", "mail.yahoo.com", "proton.me",
  // Document editors
  "docs.google.com", "sheets.google.com", "slides.google.com",
  "office.com", "officeapps.live.com", "onedrive.live.com",
  // Auth
  "accounts.google.com", "login.microsoftonline.com", "login.live.com",
  "appleid.apple.com", "signin.aws.amazon.com",
  // Banking / payments
  "paypal.com", "chase.com", "bankofamerica.com", "wellsfargo.com",
  "citi.com", "americanexpress.com",
];

export function isDenied(hostname) {
  return DENYLIST.some((d) => hostname === d || hostname.endsWith("." + d));
}

/* ---- chrome.storage helpers (promisified, defensive) ---- */

function get(key) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) return resolve(undefined);
    try {
      chrome.storage.local.get(key, (res) => resolve(res ? res[key] : undefined));
    } catch (_) {
      resolve(undefined);
    }
  });
}

function set(key, value) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) return resolve();
    try {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    } catch (_) {
      resolve();
    }
  });
}

/* ---- per-site toggle ---- */

/** Enabled unless the user explicitly turned this host off. */
export async function isEnabled(hostname) {
  const map = (await get(STORE_TOGGLES)) || {};
  return map[hostname] !== false;
}

export async function setEnabled(hostname, enabled) {
  const map = (await get(STORE_TOGGLES)) || {};
  map[hostname] = enabled;
  await set(STORE_TOGGLES, map);
}

/** Subscribe to live toggle changes (e.g. from an options page or another tab). */
export function onToggleChange(hostname, cb) {
  if (!chrome?.storage?.onChanged) return () => {};
  const listener = (changes, area) => {
    if (area !== "local" || !changes[STORE_TOGGLES]) return;
    const next = changes[STORE_TOGGLES].newValue || {};
    cb(next[hostname] !== false);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/* ---- per-host input memory ---- */

export async function getMemory(hostname) {
  const map = (await get(STORE_MEMORY)) || {};
  return map[hostname] || null;
}

export async function setMemory(hostname, descriptor) {
  const map = (await get(STORE_MEMORY)) || {};
  map[hostname] = descriptor;
  await set(STORE_MEMORY, map);
}
