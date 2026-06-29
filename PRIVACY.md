# PromptLord - Privacy Policy

**Last Updated:** June 29, 2026

## Introduction

PromptLord ("we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy explains how our Chrome browser extension handles information.

## Data Collection

**PromptLord does NOT collect, store, or share any personal data.**

Specifically, we do NOT collect:
- Personal identifiable information (name, email, address, etc.)
- Browsing history or website content
- Keystrokes or user activity tracking
- Location data
- Financial or payment information
- Authentication credentials
- Any form of personal communications

## Data Processing

### Prompt Enhancement
When you click the "Enhance" button:
1. Your prompt text is sent to our backend server (hosted on Render.com)
2. The backend processes it using Groq AI API
3. The enhanced prompt is returned to your browser
4. **No prompts are logged, stored, or retained** after processing

### Local Storage
The extension requests Chrome's `storage` permission to keep local extension
preferences and settings on your device. This data:
- Remains on your device only
- Is never transmitted to any server
- Contains no personal information and no prompt content
- Can be cleared at any time via Chrome's extension settings

Rate limiting on the client side (a short cooldown between enhancements) is handled
in memory and is not persisted.

### Backend Rate Limiting
Our backend server implements IP-based rate limiting to:
- Prevent abuse and ensure fair usage
- Protect API quota from exhaustion

IP addresses are used temporarily for rate limiting and are:
- Not linked to any personal information
- Not stored permanently
- Not shared with third parties
- Held only in server memory and purged automatically (rate counters reset each minute; inactive IPs are removed within minutes)

## Third-Party Services

### Groq API
We use Groq's AI service to process prompt enhancements. Groq processes your prompt text transiently and does not store it. See [Groq's Privacy Policy](https://groq.com/privacy-policy/) for details.

### Render.com
Our backend server is hosted on Render.com. See [Render's Privacy Policy](https://render.com/privacy) for details.

## Data Sharing

**We do NOT:**
- Sell user data to third parties
- Share data with advertisers
- Use data for purposes unrelated to prompt enhancement
- Track or profile users
- Implement any analytics or tracking

## Security

We implement security measures including:
- Server-side API key storage (never exposed to browsers)
- CORS protection to prevent unauthorized access
- Rate limiting to prevent abuse
- HTTPS encryption for all API communications
- Input validation to prevent malicious payloads

## Children's Privacy

PromptLord does not knowingly collect information from children under 13. The extension is intended for general audiences.

## Changes to Privacy Policy

We may update this Privacy Policy occasionally. The "Last Updated" date at the top will reflect any changes. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Data Retention

- Prompt text: **Not retained** (processed transiently only)
- Local storage data: Stays on your device until you clear it via Chrome settings
- Server memory: IP rate-limit data purged automatically (counters reset each minute; inactive IPs removed within minutes); error logs retained for debugging only

## Your Rights

Since we don't collect personal data, there is no personal data to access, modify, or delete. If you have concerns, you can:
- Uninstall the extension at any time
- Clear browser storage via Chrome settings

## Contact

For questions, concerns, or privacy-related inquiries:
- Email: tejaspatil1936@gmail.com
- GitHub: https://github.com/tejaspatil1936/PromptLord

## Compliance

This extension complies with:
- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR) principles
- California Consumer Privacy Act (CCPA) principles

## Open Source

PromptLord is open source. You can review our code at:
https://github.com/tejaspatil1936/PromptLord

---

**Summary:** PromptLord enhances your prompts without collecting any personal data. Your privacy is our priority.
