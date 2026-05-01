// Background Service Worker
// Handles network requests to bypass CORS/Mixed Content restrictions

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.tabs.create({ url: 'src/pages/welcome.html' });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "enhance_prompt") {
        handleEnhanceRequest(request, sendResponse);
        return true; // Will respond asynchronously
    }
});

async function handleEnhanceRequest(request, sendResponse) {
    const { text, mode, apiKey } = request;

    try {
        let response;
        let data;

        if (mode === "BYOK") {
            // --- BYOK MODE (Direct to OpenAI) ---
            response = await fetch("https://api.openai.com/v1/chat/completions", {
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
                            content: "You are an expert prompt engineer. Enhance the user's prompt by improving its structure, clarity, and effectiveness. CRITICAL: You MUST preserve ALL original points, requirements, and specific details exactly as mentioned. Do not remove, omit, or simplify any information. Only improve the wording, organization, and presentation. Return ONLY the enhanced prompt, no explanations."
                        },
                        { role: "user", content: text }
                    ]
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`OpenAI API Error: ${response.status} - ${errText}`);
            }

            data = await response.json();
            sendResponse({ success: true, enhancedText: data.choices[0].message.content });

        } else {
            // --- FREE TRIAL MODE (Production Backend) ---
            response = await fetch("https://promptlord.onrender.com/enhance", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ prompt: text })
            });

            if (response.status === 402 || response.status === 403) {
                sendResponse({ success: false, error: "FREE_LIMIT_REACHED" });
                return;
            }

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Backend Error: ${response.status} - ${errText}`);
            }

            data = await response.json();
            sendResponse({ success: true, enhancedText: data.enhancedPrompt });
        }

    } catch (error) {
        console.error("Background Script Error:", error);
        sendResponse({ success: false, error: error.message });
    }
}
