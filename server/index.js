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
        // SECURITY: Require origin header (blocks curl/Postman exploitation)
        if (!origin) {
            console.warn(`⚠️  Blocked request with no origin (potential curl/API client)`);
            return callback(new Error('Origin header required'));
        }

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
const FREE_LIMIT = 100;
const RATE_WINDOW_MS = 60000; // 1 minute
const MIN_REQUEST_INTERVAL_MS = 2000; // Minimum 2 seconds between requests

// Multiple Groq API Keys (supports comma-separated keys)
const GROQ_API_KEYS = process.env.GROQ_API_KEYS
    ? process.env.GROQ_API_KEYS.split(',').map(key => key.trim()).filter(key => key.length > 0)
    : [];

// Round-robin index for API key rotation
let currentKeyIndex = 0;

// Track failed keys to temporarily skip them
const failedKeys = new Map(); // keyIndex -> { failCount, lastFailTime }
const KEY_COOLDOWN_MS = 60000; // 1 minute cooldown for failed keys

if (GROQ_API_KEYS.length === 0) {
    console.error("❌ Error: GROQ_API_KEYS is not set in .env file");
    console.log("💡 Add multiple keys like: GROQ_API_KEYS=key1,key2,key3");
    console.log("💡 Get free keys at: https://console.groq.com");
    console.error("\n🛑 Server cannot start without API keys. Exiting...");
    process.exit(1); // Fail-fast: Don't start server without API keys
} else {
    console.log(`✅ Loaded ${GROQ_API_KEYS.length} Groq API key(s)`);
}

/**
 * Get next available API key using round-robin with fallback
 */
function getNextApiKey() {
    const now = Date.now();
    let attempts = 0;

    while (attempts < GROQ_API_KEYS.length) {
        const keyIndex = currentKeyIndex % GROQ_API_KEYS.length;
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

        return { key: GROQ_API_KEYS[keyIndex], index: keyIndex };
    }

    // All keys are in cooldown, use the first one anyway
    console.warn("⚠️  All API keys are in cooldown, using fallback");
    return { key: GROQ_API_KEYS[0], index: 0 };
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

    // Input validation: Check if prompt exists and is a string
    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: "Prompt must be a non-empty string" });
    }

    // Input validation: Check if prompt is not just whitespace
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length === 0) {
        return res.status(400).json({ error: "Prompt cannot be empty or whitespace only" });
    }

    // Input validation: Check minimum length (at least 2 characters)
    if (trimmedPrompt.length < 2) {
        return res.status(400).json({ error: "Prompt too short (minimum 2 characters)" });
    }

    // Input validation: Check maximum length
    if (trimmedPrompt.length > 5000) {
        console.warn(`⚠️  Rejected long prompt: ${trimmedPrompt.length} chars from ${ip}`);
        return res.status(400).json({ error: "Prompt too long (max 5,000 characters)" });
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
    for (let attempt = 0; attempt < Math.min(3, GROQ_API_KEYS.length); attempt++) {
        const { key: apiKey, index: keyIndex } = getNextApiKey();

        try {
            // Groq uses OpenAI-compatible API
            const response = await fetch(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: "llama-3.1-8b-instant",  // Fastest Groq model (500+ tokens/sec)
                        messages: [{
                            role: "system",
                            content: `You are a prompt enhancement specialist. Your ONLY job is to improve prompts, NOT to answer them.

STRICT RULES:
1. NEVER answer the question or provide the requested information
2. ONLY return the enhanced version of the original prompt
3. For generic prompts lacking context, enhance them generically without adding specific assumptions
4. Preserve the user's original intent and any context references (e.g., "above", "attached", "previous")
5. Make prompts clearer, more specific, and better structured

ENHANCEMENT FRAMEWORK (Apply where missing):
Use the four key areas for effective prompts when enhancing:
• Persona: Who is asking or who should respond (e.g., "You are a teacher explaining to students...")
• Task: What action to take - ALWAYS include a clear verb (e.g., summarize, write, explain, analyze, create)
• Context: Relevant background, constraints, or details needed
• Format: Desired output structure (e.g., bullet points, paragraph, table, step-by-step)

BEST PRACTICES:
- Use natural, conversational language
- Be concise but specific - aim for clarity without unnecessary complexity
- If the original prompt is complex, suggest breaking it into multiple focused prompts
- Avoid jargon unless it's relevant to the domain
- Strengthen vague prompts by adding specificity
- For prompts like "explain the above" or "summarize the attached", keep these references intact and add structure around them

Return ONLY the enhanced prompt, nothing else.`
                        }, {
                            role: "user",
                            content: `Original prompt:\n"""\n${trimmedPrompt}\n"""\n\nEnhanced prompt:`
                        }],
                        temperature: 0.3,
                        max_tokens: 512  // Optimized for prompt enhancements (reduced from 2048)
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                // Security: Don't log API keys or sensitive data
                console.error(`❌ Groq API Error (Key #${keyIndex + 1}):`, {
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

            if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                console.error("Invalid response structure from Groq API");
                lastError = { error: "Invalid API response" };
                continue;
            }

            const enhancedPrompt = data.choices[0].message.content;

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
        provider: 'Groq',
        model: 'llama-3.1-8b-instant',
        totalKeys: GROQ_API_KEYS.length,
        activeKeys: GROQ_API_KEYS.length - failedKeys.size,
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

// Keep-alive: Prevent Render free tier from sleeping (pings every 14 minutes)
// Render free tier sleeps after 15 min of inactivity, causing 30-50s cold start delay
const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000; // 14 minutes
const RENDER_URL = process.env.RENDER_URL; // Set this in Render env vars

if (RENDER_URL) {
    setInterval(async () => {
        try {
            console.log('🔄 Keep-alive ping...');
            await fetch(`${RENDER_URL}/health`);
            console.log('✅ Keep-alive successful');
        } catch (error) {
            console.warn('⚠️  Keep-alive failed:', error.message);
        }
    }, KEEP_ALIVE_INTERVAL);
    console.log('🔔 Keep-alive enabled (pings every 14 minutes)');
} else {
    console.log('💤 Keep-alive disabled (set RENDER_URL env var to enable)');
}

app.listen(PORT, () => {
    console.log(`🚀 PromptLord Backend running on http://localhost:${PORT}`);
    console.log(`⚡ Using ${GROQ_API_KEYS.length} Groq API key(s) with round-robin rotation`);
    console.log(`🔒 Security: CORS enabled, Rate limiting active (${FREE_LIMIT} req/hour per IP)`);
    console.log(`🚀 Model: llama-3.1-8b-instant (500+ tokens/sec)`);
});

