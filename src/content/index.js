/**
 * PromptEnhancer - A class to manage the "Enhance" button injection and functionality.
 */
class PromptEnhancer {
    constructor() {
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
        this.init();
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
        const sendButtons = document.querySelectorAll(this.selectors.sendButtons.join(","));

        sendButtons.forEach((sendBtn) => {
            const parent = sendBtn.parentElement;
            if (!parent || parent.querySelector(".ai-enhance-button")) return;

            const enhanceBtn = this.createButton();
            parent.insertBefore(enhanceBtn, sendBtn);
        });
    }

    /**
     * Creates the Enhance button element.
     * @returns {HTMLButtonElement}
     */
    createButton() {
        const btn = document.createElement("button");
        btn.className = "ai-enhance-button";
        btn.textContent = "Enhance";
        btn.type = "button";
        btn.addEventListener("click", (e) => this.handleClick(e, btn));
        return btn;
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
        this.setButtonState(btn, "Enhancing...", true, "wait");

        try {
            await this.enhancePrompt(btn);
        } catch (err) {
            console.error("PromptLord: Enhance failed", err);
            btn.textContent = "Error";
        } finally {
            setTimeout(() => {
                this.setButtonState(btn, "Enhance", false, "");
            }, 1000);
        }
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
        console.log("PromptLord: enhancePrompt started");
        const sendBtn = btn.nextElementSibling;
        const input = this.findInput(sendBtn);

        if (!input) {
            console.warn("PromptLord: Could not find input field");
            return;
        }

        const currentText = this.readInputText(input);
        console.log("PromptLord: Current text", currentText);

        if (!currentText || !currentText.trim()) {
            console.log("PromptLord: Empty text, skipping");
            // Debug: Log innerHTML to see what's actually there
            console.log("PromptLord: Input innerHTML:", input.innerHTML);
            return;
        }

        const enhancedText = await this.callApi(currentText);
        console.log("PromptLord: API response received", enhancedText);
        this.updateInput(input, enhancedText);
    }

    /**
     * Reads text from the input, handling various DOM structures.
     * @param {HTMLElement} input 
     * @returns {string}
     */
    readInputText(input) {
        console.log("PromptLord: Reading input", input.tagName, input.className);

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
        // Priority: textarea > contenteditable > role=textbox

        let current = sendBtn.parentElement;
        const maxLevels = 5;

        for (let i = 0; i < maxLevels && current; i++) {
            // Priority 1: Textarea (Perplexity, ChatGPT fallback)
            let input = current.querySelector("textarea");
            if (input) {
                console.log(`PromptLord: Found textarea at level ${i}`, input);
                return input;
            }

            // Priority 2: ContentEditable (Claude, Gemini)
            input = current.querySelector("[contenteditable='true']");
            if (input) {
                console.log(`PromptLord: Found contenteditable at level ${i}`, input);
                return input;
            }

            // Priority 3: Generic Role (Fallback)
            // Only accept if it doesn't contain the above (which we already checked)
            input = current.querySelector("div[role='textbox']");
            if (input) {
                console.log(`PromptLord: Found role=textbox at level ${i}`, input);
                return input;
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
        console.log("PromptLord: Updating input", input);
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
                console.log("PromptLord: execCommand success");
                // Dispatch input event just in case
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

            console.log("PromptLord: React setter success with advanced events");
            return;
        }

        // Strategy 3: Advanced Event Simulation (Fallback for ContentEditable)
        console.log("PromptLord: Trying advanced event simulation fallback");

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
    async callApi(text) {
        const apiKey = window.PromptLordConfig?.apiKey;

        if (!apiKey) {
            throw new Error("API Key not configured");
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert prompt engineer. Rewrite the user's prompt to be more precise, detailed, and effective. Return ONLY the rewritten prompt, no explanations."
                    },
                    { role: "user", content: text }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }
}

// Initialize the enhancer
new PromptEnhancer();
