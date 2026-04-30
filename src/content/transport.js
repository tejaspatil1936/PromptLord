/**
 * Transport — the ONLY bridge to the backend. Wraps the unchanged
 * `chrome.runtime.sendMessage({ action: "enhance_prompt" })` contract handled by
 * src/background.js. Behavior here is intentionally identical to the original
 * `callApi`: same message shape, same response handling, same rate-limit error.
 */
export function enhance(text) {
  return new Promise((resolve, reject) => {
    // Orphaned content script (extension reloaded, page not refreshed).
    if (!chrome.runtime?.id || !chrome.storage) {
      alert("PromptLord: Extension updated. Please refresh this page to continue.");
      reject(new Error("EXTENSION_CONTEXT_INVALIDATED"));
      return;
    }

    chrome.runtime.sendMessage({ action: "enhance_prompt", text }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.success) {
        resolve(response.enhancedText);
      } else if (response && response.error === "FREE_LIMIT_REACHED") {
        reject(new Error("FREE_LIMIT_REACHED"));
      } else {
        reject(new Error(response ? response.error : "Unknown Error"));
      }
    });
  });
}
