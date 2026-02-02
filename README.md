# PromptLord - AI Prompt Enhancer

A browser extension that transforms basic prompts into detailed, well-structured prompts for better AI responses.

⚡ **Lightning Fast with Groq API!** ⚡  
Response time: **0.5-1 seconds**

## Features

- 🚀 **Lightning Fast**: Powered by Groq's llama-3.1-8b-instant (500+ tokens/sec)
- 🔒 **100% Free**: No cost - uses free Groq API tier
- 🔐 **Secure**: Server-side API keys, CORS protection, rate limiting
- 🔄 **Multi-Key Rotation**: Add multiple API keys for higher availability
- 🎯 **Universal**: Works on ChatGPT, Claude, Google AI, and any text input
- 🎨 **Premium UI**: Native-feeling glassmorphism design with dark mode support

## Quick Setup

### 1. Get FREE Groq API Keys
1. Go to [https://console.groq.com](https://console.groq.com)
2. Create a free account (no credit card needed)
3. Generate 3-5 API keys

📖 **Detailed Guide**: See [GROQ_SETUP.md](GROQ_SETUP.md)

### 2. Deploy Backend to Render (Free)
1. Fork this repo or connect to Render
2. Create a new Web Service on Render
3. Add environment variable: `GROQ_API_KEYS=key1,key2,key3`
4. Deploy!

### 3. Install Extension
1. Download/clone this repository
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select this directory
5. You're ready to go! ⚡

## Local Development

```bash
cd server
npm install
cp .env.example .env
# Add your Groq API keys to .env
node index.js
```

## Architecture

- **Frontend**: Chrome Extension (content scripts + background worker)
- **Backend**: Node.js + Express + Groq API
- **Security**: CORS, rate limiting, API key rotation, input validation

📖 **Full Details**: [ARCHITECTURE.md](ARCHITECTURE.md)  
🔒 **Security Info**: [SECURITY.md](SECURITY.md)

## Performance

- **Response Time**: ~0.5-1 seconds
- **Throughput**: 500+ tokens/second
- **Lightning Fast!** 🚀

## File Structure

- `src/content/index.js`: Button injection and prompt enhancement logic
- `src/background.js`: Background service worker for API calls
- `src/styles/main.css`: Extension UI styles
- `server/index.js`: Backend API with multi-key rotation
- `manifest.json`: Extension configuration

## License

MIT
