# PromptLord

A browser extension that adds an AI-powered "Enhance" button to your favorite chat interfaces.

## Features

- **Universal Support**: Works on ChatGPT, Claude, Gemini.
- **Premium UI**: Native-feeling glassmorphism design.
- **Smart Injection**: Automatically detects input fields and injects the button.
- **Dark Mode**: Fully supports light and dark themes.
- **Free API**: Uses Google Gemini API with **no cost** and automatic load balancing.

## Installation

1. Clone the repository.
2. Open Chrome/Edge/Brave and go to `chrome://extensions`.
3. Enable "Developer mode".
4. Click "Load unpacked" and select this directory.

## Backend Setup

The extension requires a backend server for AI prompt enhancement.

### 🆓 Free Setup with Gemini API (Recommended)

1. Get your **free** Google Gemini API keys - see [GEMINI_SETUP.md](GEMINI_SETUP.md)
2. Configure multiple keys for better rate limits (3-5 keys recommended)
3. Start the backend server:

```bash
cd server
npm install
node index.js
```

**📖 Full Setup Guide:** [GEMINI_SETUP.md](GEMINI_SETUP.md)

## Development

- `src/content/index.js`: Main logic for button injection and handling.
- `src/styles/main.css`: Styles for the button.
- `server/index.js`: Backend API with multi-key rotation.
- `manifest.json`: Extension configuration.

## License

MIT

