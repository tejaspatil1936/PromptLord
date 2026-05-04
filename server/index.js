require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

// Security: Strict CORS - Only allow Chrome Extension origins
const allowedOrigins = [
    'chrome-extension://*',
    'moz-extension://*',
    /^chrome-extension:\/\/[a-z]{32}$/,  // Chrome extension ID format
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, Postman)
        if (!origin) return callback(null, true);

        // Check if origin matches allowed patterns
        const isAllowed = allowedOrigins.some(allowed => {
            if (allowed instanceof RegExp) return allowed.test(origin);
            if (allowed === 'chrome-extension://*') return origin.startsWith('chrome-extension://');
            if (allowed === 'moz-extension://*') return origin.startsWith('moz-extension://');
            return allowed === origin;
        });

        // For development: also allow localhost
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
        }

        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`⚠️  Blocked request from unauthorized origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(bodyParser.json({ limit: '10kb' })); // Limit payload size to prevent abuse

// Security: Rate limiting per IP with stricter limits
const ipCounts = {};
const ipLastRequest = {};
const FREE_LIMIT = 50; // Reduced from 100 for better security
const RATE_WINDOW_MS = 60000; // 1 minute
const MIN_REQUEST_INTERVAL_MS = 2000; // Minimum 2 seconds between requests

// Multiple Gemini API Keys (supports comma-separated keys)
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS
    ? process.env.GEMINI_API_KEYS.split(',').map(key => key.trim()).filter(key => key.length > 0)
    : [];

// Round-robin index for API key rotation
let currentKeyIndex = 0;

// Track failed keys to temporarily skip them
const failedKeys = new Map(); // keyIndex -> { failCount, lastFailTime }
const KEY_COOLDOWN_MS = 60000; // 1 minute cooldown for failed keys

if (GEMINI_API_KEYS.length === 0) {
    console.error("❌ Error: GEMINI_API_KEYS is not set in .env file");
    console.log("💡 Add multiple keys like: GEMINI_API_KEYS=key1,key2,key3");
} else {
    console.log(`✅ Loaded ${GEMINI_API_KEYS.length} Gemini API key(s)`);
}

/**
 * Get next available API key using round-robin with fallback
 */
function getNextApiKey() {
    const now = Date.now();
    let attempts = 0;

    while (attempts < GEMINI_API_KEYS.length) {
        const keyIndex = currentKeyIndex % GEMINI_API_KEYS.length;
        currentKeyIndex++;

        // Check if this key is in cooldown
        const failInfo = failedKeys.get(keyIndex);
        if (failInfo) {
            if (now - failInfo.lastFailTime < KEY_COOLDOWN_MS) {
                attempts++;
                continue; // Skip this key, it's in cooldown
            } else {
                // Cooldown expired, remove from failed keys
                failedKeys.delete(keyIndex);
            }
        }

        return { key: GEMINI_API_KEYS[keyIndex], index: keyIndex };
    }

    // All keys are in cooldown, use the first one anyway
    console.warn("⚠️  All API keys are in cooldown, using fallback");
    return { key: GEMINI_API_KEYS[0], index: 0 };
}

/**
 * Mark an API key as failed
 */
function markKeyAsFailed(keyIndex) {
    const failInfo = failedKeys.get(keyIndex) || { failCount: 0, lastFailTime: 0 };
    failInfo.failCount++;
    failInfo.lastFailTime = Date.now();
    failedKeys.set(keyIndex, failInfo);

    console.log(`⚠️  API Key #${keyIndex + 1} marked as failed (fail count: ${failInfo.failCount})`);
}

/**
 * Helper to get client IP
 */
function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

/**
 * POST /enhance
 * Body: { prompt: string }
 */
app.post('/enhance', async (req, res) => {
    const ip = getClientIp(req);
    const { prompt } = req.body;
    const now = Date.now();

    // Security: Validate input
    if (!prompt || typeof prompt !== 'string') {
        console.warn(`⚠️  Invalid prompt from ${ip}`);
        return res.status(400).json({ error: "Valid prompt is required" });
    }

    // Security: Limit prompt length to prevent abuse
    if (prompt.length > 5000) {
        console.warn(`⚠️  Prompt too long from ${ip}: ${prompt.length} chars`);
        return res.status(400).json({ error: "Prompt too long (max 5000 characters)" });
    }

    // Security: Anti-spam - Minimum time between requests
    const lastRequestTime = ipLastRequest[ip] || 0;
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
        const waitTime = Math.ceil((MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest) / 1000);
        console.warn(`⚠️  Rate limit: ${ip} must wait ${waitTime}s`);
        return res.status(429).json({
            error: "Too many requests",
            retryAfter: waitTime
        });
    }

    // Security: Check hourly rate limit per IP
    const currentCount = ipCounts[ip] || 0;
    if (currentCount >= FREE_LIMIT) {
        console.warn(`⚠️  IP ${ip} exceeded limit: ${currentCount}/${FREE_LIMIT}`);
        return res.status(402).json({ error: "FREE_LIMIT_REACHED" });
    }

    // Update tracking
    ipCounts[ip] = currentCount + 1;
    ipLastRequest[ip] = now;

    // Try with multiple API keys if needed
    let lastError = null;
    for (let attempt = 0; attempt < Math.min(3, GEMINI_API_KEYS.length); attempt++) {
        const { key: apiKey, index: keyIndex } = getNextApiKey();

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: `Transform this rough prompt into a clear, comprehensive, well-structured prompt. Return ONLY the improved prompt.

Original: ${prompt}

Enhanced:`
                            }]
                        }],
                        generationConfig: {
                            temperature: 0.3,  // Lower = faster & more deterministic
                            maxOutputTokens: 2048
                        }
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                // Security: Don't log API keys or sensitive data
                console.error(`❌ Gemini API Error (Key #${keyIndex + 1}):`, {
                    status: response.status,
                    error: errorData.error?.message || 'Unknown error'
                });

                // Mark key as failed if rate limited
                if (response.status === 429) {
                    markKeyAsFailed(keyIndex);
                }

                lastError = errorData;
                continue; // Try next key
            }

            const data = await response.json();

            if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                console.error("Invalid response structure from Gemini API");
                lastError = { error: "Invalid API response" };
                continue;
            }

            const enhancedPrompt = data.candidates[0].content.parts[0].text;

            console.log(`✅ Request successful with API Key #${keyIndex + 1}`);
            return res.json({ enhancedPrompt });

        } catch (error) {
            console.error(`❌ Server Error (Key #${keyIndex + 1}):`, error.message);
            lastError = error;
            continue; // Try next key
        }
    }

    // All attempts failed
    console.error("❌ All API key attempts failed");
    res.status(500).json({
        error: "Failed to enhance prompt",
        details: lastError?.message || "All API keys exhausted"
    });
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        totalKeys: GEMINI_API_KEYS.length,
        activeKeys: GEMINI_API_KEYS.length - failedKeys.size,
        failedKeys: Array.from(failedKeys.entries()).map(([index, info]) => ({
            keyIndex: index + 1,
            failCount: info.failCount,
            inCooldown: Date.now() - info.lastFailTime < KEY_COOLDOWN_MS
        }))
    });
});

// Security: Reset rate limit counters every hour
setInterval(() => {
    const activeIPs = Object.keys(ipCounts).length;
    console.log(`🔄 Rate limit reset - ${activeIPs} IPs tracked`);
    Object.keys(ipCounts).forEach(ip => ipCounts[ip] = 0);
}, RATE_WINDOW_MS);

// Security: Clean up old IP tracking data every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - (5 * 60 * 1000);
    Object.keys(ipLastRequest).forEach(ip => {
        if (ipLastRequest[ip] < cutoff) {
            delete ipLastRequest[ip];
            delete ipCounts[ip];
        }
    });
}, 5 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`🚀 PromptLord Backend running on http://localhost:${PORT}`);
    console.log(`📊 Using ${GEMINI_API_KEYS.length} Gemini API key(s) with round-robin rotation`);
    console.log(`🔒 Security: CORS enabled, Rate limiting active (${FREE_LIMIT} req/hour per IP)`);
});
