/**
 * PromptEnhancer - A class to manage the "Enhance" button injection and functionality.
 */
class PromptEnhancer {
    constructor() {
        this.selectors = {
            sendButtons: [
                'button[data-testid="send-button"]', // ChatGPT
                'button[aria-label="Send message"]', // Claude, Gemini
                'button[aria-label="Submit"]', // Perplexity
                "textarea + button", // Generic fallback
                'div[role="textbox"] ~ button', // Generic fallback
            ],
            inputs: [
                "textarea",
                "[contenteditable='true']",
                "div[role='textbox']"
            ],
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
        this.observer = new MutationObserver(() => {
            this.injectButtons();
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
        const sendBtn = btn.nextElementSibling;
        const input = this.findInput(sendBtn);

        if (!input) {
            console.warn("PromptLord: Could not find input field");
            return;
        }

        const currentText = input.value || input.innerText || "";
        if (!currentText.trim()) return;

        const enhancedText = await this.callApi(currentText);
        this.updateInput(input, enhancedText);
    }

    /**
     * Finds the input element associated with the send button.
     * @param {HTMLElement} sendBtn 
     * @returns {HTMLElement|null}
     */
    findInput(sendBtn) {
        const parent = sendBtn.closest("form") || document.body;
        return parent.querySelector(this.selectors.inputs.join(","));
    }

    /**
     * Updates the input value and triggers input events.
     * @param {HTMLElement} input 
     * @param {string} text 
     */
    updateInput(input, text) {
        input.focus();

        if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
            const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value"
            ).set;
            nativeTextAreaValueSetter.call(input, text);
        } else {
            input.innerText = text;
        }

        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    /**
     * Calls the OpenAI API to enhance the text.
     * @param {string} text 
     * @returns {Promise<string>}
     */
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
