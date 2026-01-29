// Background Service Worker
// Handles network requests to the Gemini-powered backend

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
    const { text } = request;

    try {
        // Call Gemini-powered backend
        const response = await fetch("https://promptlord-2kjz.onrender.com/enhance", {
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

        const data = await response.json();
        sendResponse({ success: true, enhancedText: data.enhancedPrompt });

    } catch (error) {
        console.error("Background Script Error:", error);
        sendResponse({ success: false, error: error.message });
    }
}

// Keep-alive ping to prevent Render free tier from sleeping
// Pings every 14 minutes (under the 15-minute sleep threshold)
const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000; // 14 minutes

function keepAlive() {
    fetch("https://promptlord-2kjz.onrender.com/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "ping" })
    })
        .then(() => console.log('Keep-alive ping sent'))
        .catch(() => { }); // Ignore errors
}

// Start keep-alive pings
setInterval(keepAlive, KEEP_ALIVE_INTERVAL);
// Send initial ping after 1 minute to warm up the server
setTimeout(keepAlive, 60000);
