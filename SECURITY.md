# 🔒 Security Architecture

## Overview

Your PromptLord backend is now **highly secure** with multiple layers of protection. API keys are **NEVER** exposed to the frontend, browser dev tools, or logs.



---

## 🛡️ Security Layers

### 1. **API Keys are Server-Side Only** ✅

```
┌─────────────────────┐
│  Browser Extension  │  ← ❌ NO API KEYS HERE
│  (Frontend Code)    │
└──────────┬──────────┘
           │
           │ HTTPS Request (no keys)
           ▼
┌─────────────────────┐
│  Backend Server     │  ← ✅ API KEYS STORED HERE
│  (.env file)        │
└──────────┬──────────┘
           │
           │ API Calls with keys
           ▼
┌─────────────────────┐
│  Groq API           │
└─────────────────────┘
```

**Protection:**
- API keys are stored in `.env` (server-side only)
- Frontend NEVER sees the keys
- Browser Dev Tools CANNOT access keys
- Keys are NOT in git (`.gitignore`)

---

### 2. **CORS Protection** 🚫

**What it does:** Only allows requests from your browser extension, blocks all other websites.

```javascript
// Only these origins can make requests:
✅ chrome-extension://your-extension-id
✅ moz-extension://your-extension-id
✅ localhost (for development)
❌ evil-website.com (BLOCKED)
```

**Prevents:**
- Other websites stealing your API quota
- Cross-origin attacks
- Unauthorized API access

---

### 3. **Rate Limiting (Per IP)** ⏱️

**Limits (per IP, from `server/index.js`):**
- **100 requests per minute** per IP address (`FREE_LIMIT = 100`, counters reset every `RATE_WINDOW_MS = 60s`)
- **Minimum 2 seconds** between requests (anti-spam, `MIN_REQUEST_INTERVAL_MS = 2000`)

**Example:**
```
Request 1 at 10:00:00 ✅ Allowed
Request 2 at 10:00:01 ❌ Blocked (too fast — must wait until 2s have passed)
Request 3 at 10:00:02 ✅ Allowed
...
Request 101 within the same minute ❌ Blocked (per-minute limit reached)
Request at the next minute       ✅ Allowed (counter reset)
```

**Prevents:**
- API quota exhaustion
- Spam attacks
- DDoS attempts

---

### 4. **Input Validation** 🔍

**Checks every request for:**

| Validation | Limit | Blocks |
|------------|-------|--------|
| Prompt exists | Required | Empty requests |
| Prompt type | String only | Injection attacks |
| Prompt length | Max 5000 chars | Memory overflow |
| Payload size | Max 10KB | Large payloads |

**Example:**
```javascript
❌ { "prompt": null } → Blocked
❌ { "prompt": "<script>...</script>" } → Blocked  
❌ { "prompt": "..." x 10000 } → Blocked (too long)
✅ { "prompt": "write a hello world" } → Allowed
```

---

### 5. **Secure Logging** 📝

**What gets logged:**
```javascript
✅ Request IP addresses
✅ Error messages
✅ Rate limit violations
❌ API keys (NEVER logged)
❌ Full request bodies (potential PII)
```

**Before (Insecure):**
```javascript
console.error("API Error:", errorData); // ❌ Could leak keys
```

**After (Secure):**
```javascript
console.error("API Error:", {
    status: response.status,
    error: errorData.error?.message  // ✅ Only safe data
});
```

---

### 6. **Origin Validation** 🌐

```javascript
// Server checks: "Where is this request coming from?"

chrome-extension://abcd1234... → ✅ Allowed
localhost:3000 → ✅ Allowed (dev mode)
https://evil.com → ❌ BLOCKED + Warning logged
```

---

### 7. **Memory Cleanup** 🧹

**Prevents memory leaks:**
- Inactive IP tracking data cleaned every 5 minutes
- Rate limit counters reset every minute (`RATE_WINDOW_MS`)
- Removed inactive IPs automatically

---

## 🔐 How API Keys Stay Hidden

### ❌ What DOESN'T Work:

```javascript
// DON'T DO THIS (Frontend code)
const API_KEY = "gsk_...";  // ❌ Exposed in browser
fetch("https://api.groq.com", {
    headers: { "Authorization": `Bearer ${API_KEY}` }  // ❌ Visible in Network tab
});
```

### ✅ What DOES Work (Our Implementation):

```javascript
// Frontend (Extension) - NO KEYS
fetch("https://your-backend.com/enhance", {
    method: "POST",
    body: JSON.stringify({ prompt: "hello" })  // ✅ No keys sent
});

// Backend (Server) - KEYS STORED HERE
const GROQ_API_KEYS = process.env.GROQ_API_KEYS;  // ✅ From .env
fetch("https://api.groq.com", {
    headers: { "Authorization": `Bearer ${GROQ_API_KEYS[0]}` }  // ✅ Keys stay server-side
});
```

---

## 🧪 Test Security (Try to Break It!)

### Test 1: Check Browser Dev Tools
```javascript
// Open browser console and try:
chrome.storage.local.get(null, (data) => console.log(data));
// You'll see only local extension preferences — NEVER any backend/Groq API keys ✅
```

### Test 2: Inspect Network Requests
1. Open Dev Tools → Network tab
2. Click "Enhance" button
3. Look at request to backend
4. **You should see:** `{"prompt":"..."}`
5. **You should NOT see:** Any API keys ✅

### Test 3: Try Rate Limit
```bash
# Try sending 105 requests in one minute
for i in {1..105}; do
  curl -X POST http://localhost:3000/enhance \
    -H "Content-Type: application/json" \
    -d '{"prompt":"test"}' &
done

# Expected: up to 100/min succeed; the rest are blocked (and the 2s
# minimum interval also throttles rapid-fire requests) ✅
```

### Test 4: Try Wrong Origin
```bash
# Try from unauthorized domain
curl -X POST http://localhost:3000/enhance \
  -H "Origin: https://evil.com" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test"}'

# Expected: CORS error ✅
```

---

## 🚨 What Users CANNOT Do

| Attack Vector | Protection | Result |
|---------------|------------|--------|
| View API keys in browser | Keys stored server-side | ❌ Impossible |
| Inspect network requests | Keys not in requests | ❌ Impossible |
| Check localStorage/cookies | Keys not stored client-side | ❌ Impossible |
| Spam requests | Rate limiting (2s min interval) | ❌ Blocked after 2s |
| Exhaust quota | IP-based limits (100/min) | ❌ Blocked after 100/min |
| Send from other sites | CORS restrictions | ❌ Blocked immediately |
| Send oversized payloads | 10KB limit | ❌ Blocked |
| Send huge prompts | 5000 char limit | ❌ Blocked |
| Fork and steal keys | Keys in `.env` (not in git) | ❌ No keys to steal |

---

## 🌍 Production Deployment Security

When deploying to Render/Heroku/Railway:

### ✅ **DO:**
1. Set `GROQ_API_KEYS` as **environment variables** (not in code)
2. Enable HTTPS (TLS/SSL)
3. Use environment secrets management
4. Monitor logs for suspicious activity
5. Set up alerts for rate limit violations

### ❌ **DON'T:**
1. Commit `.env` to git
2. Hardcode API keys in code
3. Share API keys in public repos
4. Deploy without HTTPS
5. Expose `/health` endpoint publicly (optional)

### Example: Render.com Setup
```
Environment Variables:
┌────────────────────────────────────────┐
│ GROQ_API_KEYS = gsk_...,gsk_...,gsk_..│
│ NODE_ENV = production                  │
└────────────────────────────────────────┘
```

---

## 📊 Security Checklist

- [x] API keys stored server-side only
- [x] `.env` file in `.gitignore`
- [x] CORS enabled with whitelist
- [x] Rate limiting (IP-based)
- [x] Anti-spam (2s min interval)
- [x] Input validation (type, length)
- [x] Payload size limits (10KB)
- [x] Secure logging (no sensitive data)
- [x] Memory cleanup (prevent leaks)
- [x] Origin validation
- [x] Automatic failover (no key exposure on errors)

---

## 🎯 Summary

### **Your API Keys Are Safe Because:**

1. ✅ **Server-Side Storage** - Keys never leave the backend
2. ✅ **No Frontend Exposure** - Browser never sees keys
3. ✅ **Git Protection** - `.env` is ignored
4. ✅ **CORS Restrictions** - Only your extension can call backend
5. ✅ **Rate Limiting** - Prevents quota exhaustion
6. ✅ **Input Validation** - Blocks malicious payloads
7. ✅ **Secure Logging** - Keys never logged
8. ✅ **Memory Cleanup** - No data leaks

### **Even If Someone:**
- ❌ Inspects your browser → Won't see keys
- ❌ Looks at network traffic → Won't see keys
- ❌ Forks your repo → Won't get keys
- ❌ Tries to spam your backend → Gets rate limited
- ❌ Tries to call from another site → Gets CORS blocked

**Your backend is production-ready and secure! 🔒**
