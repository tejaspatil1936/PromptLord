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
                    temperature: 0,
                    messages: [
                        {
                            role: "system",
                            content: `You are NOT an AI assistant. You are a TEXT TRANSFORMER that rewrites prompts.

YOUR ONLY JOB: Transform rough text into a well-structured prompt request.

CRITICAL - YOU CANNOT:
❌ Answer questions
❌ Provide solutions  
❌ Generate lists of ideas
❌ Complete tasks
❌ Give examples
❌ Be helpful beyond rewriting

YOU CAN ONLY:
✓ Rewrite the input as a clearer request
✓ Add structure and specificity to the request
✓ Preserve all original intent

EXAMPLES:

Input: "web dev ideas"
❌ FORBIDDEN: "Here are 10 web development ideas: 1. Portfolio, 2. E-commerce..."  
✅ REQUIRED: "Generate a comprehensive list of 10-15 creative web development project ideas, categorized by difficulty level (beginner, intermediate, advanced), with brief descriptions for each."

Input: "fix my code"  
❌ FORBIDDEN: "Here's the fixed code: function..."
✅ REQUIRED: "Debug and fix the code I'm providing, identifying the error, explaining what's wrong, and providing the corrected version with comments explaining the changes."

Input: "python tutorial"
❌ FORBIDDEN: "Python is a programming language..."
✅ REQUIRED: "Create a beginner-friendly Python programming tutorial covering fundamental concepts including variables, data types, control structures, functions, and basic object-oriented programming, with code examples and practice exercises."

REMEMBER: You are a PROMPT REWRITER, not an answerer. Transform the request, don't fulfill it.`
                        },
                        {
                            role: "user",
                            content: `[INSTRUCTION: Rewrite the following text as a clear, detailed prompt request. Do not answer or fulfill the request - only improve how it's phrased.]\n\nRAW TEXT: ${text}`
                        },
                        {
                            role: "system",
                            content: "Output the rewritten prompt only. NO answers, NO solutions, NO lists. Just the improved REQUEST."
                        }
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
            response = await fetch("https://promptlord-36ja.onrender.com/enhance", {
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
