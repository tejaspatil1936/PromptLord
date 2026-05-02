/**
 * PromptEnhancer - A class to manage the "Enhance" button injection and functionality.
 */
class PromptEnhancer {
    constructor() {
        this.usageCount = 0;
        this.maxFreeUsage = 10;
        this.loadUsageCount();
        this.selectors = {
            sendButtons: [
                'button[data-testid="send-button"]', // ChatGPT
                'button[aria-label="Send message" i]', // Claude, Gemini
                'button[aria-label="Submit" i]', // Perplexity
                'button[aria-label="Ask" i]', // Perplexity alternative
                'button[aria-label="Send" i]', // Generic
                "textarea + button", // Generic fallback
                'div[role="textbox"] ~ button', // Generic fallback
            ],
            // Inputs are now handled via priority logic in findInput
        };

        this.observer = null;
        this.lastClickTime = 0;
        this.isColdStart = true;
        this.init();
    }

    /**
     * Load usage count from storage
     */
    async loadUsageCount() {
        try {
            const result = await chrome.storage.local.get(['freeTrialUsage']);
            this.usageCount = result.freeTrialUsage || 0;
        } catch (err) {
            this.usageCount = 0;
        }
    }

    /**
     * Increment and save usage count
     */
    async incrementUsage() {
        this.usageCount++;
        try {
            await chrome.storage.local.set({ freeTrialUsage: this.usageCount });
        } catch (err) {
            console.error('Failed to save usage count:', err);
        }
    }

    /**
     * Initializes the enhancer.
     */
    init() {
        this.injectButtons();
        this.startObserver();
    }

    /**
     * Starts the MutationObserver to handle dynamic content changes.
     */
    startObserver() {
        let timeout;
        this.observer = new MutationObserver(() => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                this.injectButtons();
            }, 500); // Increased debounce to 500ms for React stability
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    /**
     * Injects the Enhance button next to detected send buttons.
     */
    injectButtons() {
        if (window.location.hostname.includes("perplexity")) return;
        const sendButtons = document.querySelectorAll(this.selectors.sendButtons.join(","));

        sendButtons.forEach((sendBtn) => {
            // Skip if this send button already has an enhance button
            if (sendBtn.dataset.promptlordEnhanced === "true") return;

            const parent = sendBtn.parentElement;
            if (!parent) return;

            // Check if parent or nearby siblings already have enhance button
            if (parent.querySelector(".ai-enhance-button")) return;

            const enhanceBtn = this.createButton();
            parent.insertBefore(enhanceBtn, sendBtn);

            // Mark this send button as already enhanced
            sendBtn.dataset.promptlordEnhanced = "true";
        });
    }

    /**
     * Creates the Enhance button element.
     * @returns {HTMLButtonElement}
     */
    createButton() {
        const btn = document.createElement("button");
        btn.className = "ai-enhance-button";
        btn.type = "button";
        btn.addEventListener("click", (e) => this.handleClick(e, btn));

        // Set initial button text with usage counter for free trial
        this.updateButtonText(btn);

        return btn;
    }

    /**
     * Update button text with usage counter
     */
    async updateButtonText(btn) {
        try {
            const result = await chrome.storage.local.get(['apiKey', 'freeTrialUsage']);
            const isFree = !result.apiKey;
            const usage = result.freeTrialUsage || 0;

            if (isFree && usage < this.maxFreeUsage) {
                const remaining = this.maxFreeUsage - usage;
                btn.textContent = `Enhance (${remaining} left)`;
                btn.title = `${remaining} free enhancements remaining. Add API key for unlimited use.`;
            } else if (isFree) {
                btn.textContent = "Enhance";
                btn.title = "Free trial limit reached. Add your OpenAI API key for unlimited use.";
            } else {
                btn.textContent = "Enhance";
                btn.title = "Enhance your prompt with AI";
            }
        } catch (err) {
            btn.textContent = "Enhance";
        }
    }

    /**
     * Handles the button click event.
     * @param {Event} e 
     * @param {HTMLButtonElement} btn 
     */
    async handleClick(e, btn) {
        e.preventDefault();
        e.stopPropagation();

        // Rate Limiting
        const now = Date.now();
        const cooldown = 5000; // 5 seconds default
        const timeSinceLastClick = now - this.lastClickTime;

        if (timeSinceLastClick < cooldown) {
            const remaining = Math.ceil((cooldown - timeSinceLastClick) / 1000);
            const originalText = btn.textContent;

            // Only show wait message if not already showing it
            if (!btn.textContent.startsWith("Wait")) {
                btn.textContent = `Wait ${remaining}s`;
                btn.disabled = true;

                setTimeout(() => {
                    btn.textContent = "Enhance";
                    btn.disabled = false;
                }, remaining * 1000);
            }
            return;
        }

        this.lastClickTime = now;
        const originalText = btn.textContent;

        // Check if using free trial and show intelligent loading message
        chrome.storage.local.get(['apiKey'], async (result) => {
            const isFree = !result.apiKey;

            if (isFree && this.isColdStart) {
                this.setButtonState(btn, "Waking server...", true, "wait");
                this.isColdStart = false;
            } else {
                this.setButtonState(btn, "Enhancing...", true, "wait");
            }
        });

        this.setButtonState(btn, "Enhancing...", true, "wait");

        try {
            await this.enhancePrompt(btn);

            // Track usage for free trial users
            chrome.storage.local.get(['apiKey'], async (result) => {
                if (!result.apiKey) {
                    await this.incrementUsage();
                    await this.updateButtonText(btn);
                }
            });
        } catch (err) {
            console.error("PromptLord: Enhance failed", err);

            // Show user-friendly error messages
            if (err.message && err.message.includes('FREE_LIMIT_REACHED')) {
                btn.textContent = "Limit reached";
                setTimeout(() => {
                    if (confirm('Free trial limit reached (10/10 used). Add your OpenAI API key in settings for unlimited use.\n\nOpen settings now?')) {
                        chrome.runtime.sendMessage({ action: 'open_options' });
                    }
                    this.setButtonState(btn, "Enhance", false, "");
                }, 100);
            } else {
                btn.textContent = "Error";
                setTimeout(() => {
                    this.setButtonState(btn, "Enhance", false, "");
                }, 2000);
            }
            return;
        }

        setTimeout(() => {
            this.setButtonState(btn, "Enhance", false, "");
        }, 1000);
    }

    /**
     * Sets the visual state of the button.
     * @param {HTMLButtonElement} btn 
     * @param {string} text 
     * @param {boolean} disabled 
     * @param {string} cursor 
     */
    setButtonState(btn, text, disabled, cursor) {
        btn.textContent = text;
        btn.disabled = disabled;
        btn.style.cursor = cursor;
    }

    /**
     * Core logic to enhance the prompt.
     * @param {HTMLButtonElement} btn 
     */
    async enhancePrompt(btn) {
        const sendBtn = btn.nextElementSibling;
        const input = this.findInput(sendBtn);

        if (!input) {
            console.warn("PromptLord: Could not find input field");
            return;
        }

        const currentText = this.readInputText(input);

        if (!currentText || !currentText.trim()) {
            return;
        }

        const enhancedText = await this.callApi(currentText);
        this.updateInput(input, enhancedText);
    }

    /**
     * Reads text from the input, handling various DOM structures.
     * @param {HTMLElement} input 
     * @returns {string}
     */
    readInputText(input) {

        if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
            return input.value;
        }

        // For contenteditable divs (ChatGPT, Claude, etc.)
        // ChatGPT often puts text in <p> tags inside the div
        if (input.getAttribute("contenteditable") === "true") {
            // Check for child paragraphs first (common in rich text editors)
            const paragraphs = input.querySelectorAll("p");
            if (paragraphs.length > 0) {
                return Array.from(paragraphs).map(p => p.innerText).join("\n");
            }
            return input.innerText || input.textContent;
        }

        return input.innerText || "";
    }

    /**
     * Finds the input element associated with the send button.
     * Uses a Priority Proximity Search to find the most specific input.
     * @param {HTMLElement} sendBtn 
     * @returns {HTMLElement|null}
     */
    findInput(sendBtn) {
        // Strategy: Go up the tree level by level and look for inputs with priority.
        // Priority: Visible textarea > Visible contenteditable > Visible role=textbox

        let current = sendBtn.parentElement;
        const maxLevels = 5;

        for (let i = 0; i < maxLevels && current; i++) {
            // Priority 1: Visible Textarea
            const textareas = current.querySelectorAll("textarea");
            for (const textarea of textareas) {
                if (textarea.offsetParent !== null) {
                    return textarea;
                }
            }

            // Priority 2: Visible ContentEditable
            const editables = current.querySelectorAll("[contenteditable='true']");
            for (const editable of editables) {
                if (editable.offsetParent !== null) {
                    return editable;
                }
            }

            // Priority 3: Visible Role=textbox
            const roleTextboxes = current.querySelectorAll("div[role='textbox']");
            for (const textbox of roleTextboxes) {
                if (textbox.offsetParent !== null) {
                    return textbox;
                }
            }

            current = current.parentElement;
        }

        return null;
    }



    /**
     * Updates the input value and triggers input events.
     * @param {HTMLElement} input 
     * @param {string} text 
     */
    updateInput(input, text) {
        input.focus();
        input.click(); // Ensure it's active

        // Strategy 1: execCommand (Universal - works for Textarea AND ContentEditable)
        // This is the most "native" way to insert text
        if (document.queryCommandSupported('insertText')) {
            // Try to select all text first
            try {
                if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
                    input.select();
                } else if (input.getAttribute("contenteditable") === "true") {
                    const range = document.createRange();
                    range.selectNodeContents(input);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            } catch (e) {
                console.warn("PromptLord: Selection failed", e);
            }

            const success = document.execCommand("insertText", false, text);
            if (success) {
                input.dispatchEvent(new Event("input", { bubbles: true }));
                return;
            }
        }

        // Strategy 2: React Value Setter (Fallback for Textarea/Input)
        if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
            const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value"
            ).set;
            nativeTextAreaValueSetter.call(input, text);

            // Dispatch standard events
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));

            // Dispatch advanced events for stubborn frameworks (Claude)
            const events = [
                new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }),
                new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
                new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' })
            ];
            events.forEach(evt => input.dispatchEvent(evt));
            return;
        }

        // Strategy 3: Advanced Event Simulation (Fallback for ContentEditable)

        if (input.id === "prompt-textarea") { // ChatGPT
            input.innerHTML = `<p>${text}</p>`;
        } else {
            input.innerText = text;
        }

        const events = [
            new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }),
            new Event('input', { bubbles: true }),
            new Event('change', { bubbles: true }),
            new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
            new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' })
        ];

        events.forEach(evt => input.dispatchEvent(evt));
    }

    /**
     * Calls the OpenAI API to enhance the text.
     * @param {string} text 
     * @returns {Promise<string>}
     */
    /**
     * Calls the API to enhance the text.
     * Supports BYOK (Bring Your Own Key) and Free Trial via Backend.
     * @param {string} text 
     * @returns {Promise<string>}
     */
    /**
     * Calls the API to enhance the text via the Background Script.
     * @param {string} text 
     * @returns {Promise<string>}
     */
    async callApi(text) {
        return new Promise((resolve, reject) => {
            // Check for orphaned script (Extension reloaded but page not refreshed)
            if (!chrome.runtime?.id || !chrome.storage) {
                alert("PromptLord: Extension updated. Please refresh this page to continue.");
                reject(new Error("EXTENSION_CONTEXT_INVALIDATED"));
                return;
            }

            // Check for user's stored API key first
            chrome.storage.local.get(['apiKey'], (result) => {
                const userKey = result.apiKey;
                const mode = userKey ? "BYOK" : "FREE";

                chrome.runtime.sendMessage({
                    action: "enhance_prompt",
                    text: text,
                    mode: mode,
                    apiKey: userKey
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Runtime Error:", chrome.runtime.lastError);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    if (response && response.success) {
                        resolve(response.enhancedText);
                    } else {
                        if (response && response.error === "FREE_LIMIT_REACHED") {
                            alert("PromptLord: Free trial limit reached (10 requests). Please add your own OpenAI API Key in the extension settings to continue.");
                            reject(new Error("FREE_LIMIT_REACHED"));
                        } else {
                            reject(new Error(response ? response.error : "Unknown Error"));
                        }
                    }
                });
            });
        });
    }
}

// Initialize the enhancer
new PromptEnhancer();
