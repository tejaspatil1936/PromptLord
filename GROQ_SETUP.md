# Groq API Setup Guide

## Why Groq?

**Groq is 10x faster than Gemini:**
- **Groq**: 500+ tokens/second (~0.5-1s response time)
- **Gemini**: 50 tokens/second (~3-5s response time)

Both are **100% FREE** with generous limits!

## Get FREE Groq API Keys

### Step 1: Create Groq Account
1. Go to [https://console.groq.com](https://console.groq.com)
2. Click **Sign Up** (free - no credit card required)
3. Use Google, GitHub, or email to sign up
4. Verify your email if required

### Step 2: Generate API Keys
1. After logging in, go to **API Keys** section
2. Click **Create API Key**
3. Give it a name (e.g., "PromptLord Key 1")
4. Copy the key immediately (it won't be shown again!)
5. **Repeat 2-4 times** to create multiple keys for better availability

### Step 3: Configure Your Backend

#### Option A: Local Development (.env file)
1. Copy `.env.example` to `.env`:
   ```bash
   cp server/.env.example server/.env
   ```

2. Edit `server/.env` and add your keys:
   ```bash
   GROQ_API_KEYS=gsk_abc123...,gsk_def456...,gsk_ghi789...
   ```

#### Option B: Render Production Deployment
1. Go to your Render dashboard
2. Select your backend service
3. Click **Environment**
4. Add environment variable:
   - Key: `GROQ_API_KEYS`
   - Value: `gsk_abc123...,gsk_def456...,gsk_ghi789...`
5. Click **Save Changes**
6. Render will automatically redeploy

## Groq Free Tier Limits

- **Rate Limits**: 30 requests/minute per key
- **Token Limits**: Very generous
- **Daily Limits**: More than enough for personal use

**With 3 keys**: ~90 requests/minute capacity!

## Recommended Models

- **llama-3.1-8b-instant** (default) - Fastest, best for prompts
- **llama-3.1-70b-versatile** - Slower but higher quality
- **mixtral-8x7b-32768** - Good balance

## Testing Your Setup

### 1. Test Locally
```bash
cd server
node index.js
```

You should see:
```
✅ Loaded 3 Groq API key(s)
🚀 PromptLord Backend running on http://localhost:3000
⚡ Using 3 Groq API key(s) with round-robin rotation
🚀 Model: llama-3.1-8b-instant (500+ tokens/sec)
```

### 2. Test API Endpoint
```bash
curl -X POST http://localhost:3000/enhance \
  -H "Content-Type: application/json" \
  -d '{"prompt":"make this better"}'
```

## Troubleshooting

### Error: "GROQ_API_KEYS is not set"
- Make sure you created the `.env` file
- Check the file is in `server/.env` (not root)
- Verify no typos in variable name

### Error: "401 Unauthorized"
- Your API key is invalid or expired
- Generate a new key from Groq console
- Make sure you copied the full key

### Error: "429 Too Many Requests"
- You hit the rate limit on one key
- Add more API keys (the system will rotate)
- Wait a minute and try again

## Security Best Practices

✅ **DO:**
- Keep your API keys in `.env` file
- Add `.env` to `.gitignore`
- Use environment variables on Render
- Create multiple keys for redundancy

❌ **DON'T:**
- Commit `.env` to Git
- Share your API keys publicly
- Hardcode keys in your code
- Use the same key everywhere

## Need Help?

- **Groq Documentation**: [https://console.groq.com/docs](https://console.groq.com/docs)
- **API Reference**: [https://console.groq.com/docs/api-reference](https://console.groq.com/docs/api-reference)
- **Discord Community**: Join Groq's Discord for support

---

**You're all set! Enjoy lightning-fast prompt enhancement! ⚡**
