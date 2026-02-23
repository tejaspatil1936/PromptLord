# PromptLord - AI Prompt Enhancer

> Transform basic prompts into detailed, well-structured prompts for better AI responses with a single click.

[![Version](https://img.shields.io/badge/version-1.0.2-blue.svg)](https://github.com/tejaspatil1936/PromptLord)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

⚡ **Lightning Fast** • 🔒 **100% Free** • 🔐 **Secure**

## ✨ Features

- ⚡ **Lightning Fast**: Powered by Groq's llama-3.1-8b-instant model (500+ tokens/sec)
- 🆓 **Completely Free**: Uses free Groq API tier - no credit card required
- 🔐 **Secure & Private**: Server-side API key management, CORS protection, rate limiting
- 🔄 **Multi-Key Rotation**: Automatic failover with multiple API keys for 99.9% uptime
- 🎯 **Universal Compatibility**: Works seamlessly on ChatGPT, Claude, and Google AI (Gemini)
- 🎨 **Premium UI**: Beautiful glassmorphism design with native dark mode support
- 🚀 **One-Click Enhancement**: Enhance any prompt with a single button click

## 🌐 Supported Platforms

- ✅ [ChatGPT](https://chatgpt.com) (OpenAI)
- ✅ [Claude](https://claude.ai) (Anthropic)
- ✅ [Gemini](https://gemini.google.com) (Google AI)

## 🚀 Quick Start

### Prerequisites
- Chrome/Edge browser (Manifest V3 compatible)
- Free Groq API account

### 1. Get Your FREE Groq API Keys

1. Visit [https://console.groq.com](https://console.groq.com)
2. Sign up for a free account (no credit card needed)
3. Generate 3-5 API keys for best performance

📖 **Need help?** See our detailed [Groq Setup Guide](GROQ_SETUP.md)

### 2. Deploy Backend (Free on Render)

1. Fork this repository
2. Create a new Web Service on [Render](https://render.com)
3. Connect your forked repository
4. Add environment variable:
   ```
   GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3
   ```
5. Click "Deploy" and copy your backend URL

### 3. Install Browser Extension

1. Clone/download this repository:
   ```bash
   git clone https://github.com/tejaspatil1936/PromptLord.git
   cd PromptLord
   ```

2. Update the backend URL in `manifest.json`:
   ```json
   "host_permissions": [
     "https://your-backend-url.onrender.com/*"
   ]
   ```

3. Load the extension:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the PromptLord directory

4. You're all set! 🎉

## 💻 Local Development

```bash
# Install backend dependencies
cd server
npm install

# Create environment file
cp .env.example .env

# Add your Groq API keys to .env
# GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3

# Start the backend server
npm start
```

The server will run on `http://localhost:3000`

## 📁 Project Structure

```
PromptLord/
├── src/
│   ├── content/
│   │   └── index.js          # Content script for button injection
│   ├── background.js          # Background service worker
│   ├── styles/
│   │   └── main.css          # Extension UI styles
│   └── pages/
│       └── welcome.html       # Welcome page
├── server/
│   ├── index.js              # Express API server
│   ├── package.json          # Backend dependencies
│   └── .env.example          # Environment template
├── icons/                     # Extension icons
├── manifest.json             # Extension configuration
├── ARCHITECTURE.md           # Technical architecture docs
├── SECURITY.md              # Security implementation details
└── GROQ_SETUP.md            # API setup guide
```

## 🏗️ Architecture

**Frontend**: Chrome Extension (Manifest V3)
- Content scripts inject enhancement button
- Background service worker handles API communication
- Premium glassmorphism UI with dark mode

**Backend**: Node.js + Express
- Multi-key rotation with automatic failover
- Rate limiting and input validation
- CORS protection and security headers

**AI Engine**: Groq Cloud API
- llama-3.1-8b-instant model
- 500+ tokens/second throughput
- Sub-second response times

📖 **Detailed Architecture**: See [ARCHITECTURE.md](ARCHITECTURE.md)  
🔒 **Security Details**: See [SECURITY.md](SECURITY.md)

## ⚡ Performance

| Metric | Value |
|--------|-------|
| Response Time | 0.5-1 seconds |
| Throughput | 500+ tokens/sec |
| Uptime (multi-key) | 99.9% |
| Cost | $0 / month |

## 📚 Documentation

- [Architecture Guide](ARCHITECTURE.md) - System design and multi-key rotation
- [Security Documentation](SECURITY.md) - Security measures and best practices
- [Groq Setup Guide](GROQ_SETUP.md) - Step-by-step API key configuration
- [Privacy Policy](PRIVACY.md) - Data handling and privacy

## 🛡️ Security

PromptLord is built with security as a top priority:

- ✅ Server-side API key storage (never exposed to client)
- ✅ CORS protection with whitelist
- ✅ Rate limiting to prevent abuse
- ✅ Input validation and sanitization
- ✅ Secure HTTPS communication
- ✅ Helmet.js security headers

## 🤝 Contributing

Contributions are welcome! Feel free to:

- Report bugs
- Suggest new features
- Submit pull requests

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Author

**Tejas Patil**
- GitHub: [@tejaspatil1936](https://github.com/tejaspatil1936)

---

<div align="center">

**Made with ❤️ by Tejas Patil**

If you find this useful, give it a ⭐!

</div>
