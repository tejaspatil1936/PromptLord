require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// In-memory store for IP rate limiting
// Format: { "ip_address": count }
const ipCounts = {};
const FREE_LIMIT = 10;

// Server-side OpenAI Key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY is not set in .env file");
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

    if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
    }

    // Check Rate Limit
    const currentCount = ipCounts[ip] || 0;
    if (currentCount >= FREE_LIMIT) {
        return res.status(402).json({ error: "FREE_LIMIT_REACHED" });
    }

    // Increment count
    ipCounts[ip] = currentCount + 1;
    console.log(`[${ip}] Request ${ipCounts[ip]}/${FREE_LIMIT}`);

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: "Improve the following user prompt by making it clearer, more structured, and more effective. Return ONLY the improved prompt."
                    },
                    { role: "user", content: prompt }
                ]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("OpenAI API Error:", errorData);
            return res.status(500).json({ error: "Failed to enhance prompt" });
        }

        const data = await response.json();
        const enhancedPrompt = data.choices[0].message.content;

        res.json({ enhancedPrompt });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(PORT, () => {
    console.log(`PromptLord Backend running on http://localhost:${PORT}`);
});
