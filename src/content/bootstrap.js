/**
 * Classic content-script entry (the ONLY file the manifest injects).
 *
 * MV3 content scripts are classic scripts and can't use import/export directly,
 * so we dynamically import the real module entry. That lets every other file in
 * src/content/ use clean ES modules. The module files are exposed to the page
 * via `web_accessible_resources` in the manifest so this import can resolve.
 */
(async () => {
  try {
    await import(chrome.runtime.getURL("src/content/main.js"));
  } catch (err) {
    console.error("PromptLord: failed to load content modules", err);
  }
})();
