# 🔑 Gemini API Setup Guide

This guide will help you get **free** Google Gemini API keys and configure them for PromptLord.

---

## 🎯 Why Multiple API Keys?

Each free Gemini API key has these limits:
- **15 requests per minute**
- **1,500 requests per day**

By using **multiple API keys**, the backend automatically rotates between them, giving you:
- ✅ **45 requests/min** with 3 keys
- ✅ **75 requests/min** with 5 keys
- ✅ **4,500 requests/day** with 3 keys
- ✅ **Automatic failover** if one key hits rate limits

---

## 📝 Step 1: Get Your Free API Keys

### Option A: Using Google Account (No Credit Card Required!)

1. **Go to Google AI Studio**  
   Visit: [https://makersuite.google.com/app/apikey](https://makersuite.google.com/app/apikey)

2. **Sign in with your Google account**

3. **Click "Create API Key"**

4. **Select or create a Google Cloud project**  
   - If you don't have one, click "Create new project"
   - Give it a name like "PromptLord"

5. **Copy your API key**  
   It will look like: `AIzaSyD...` (starts with AIza)

6. **Repeat for multiple keys** (Recommended: 3-5 keys)
   - You can use different Google accounts
   - Or create multiple projects in the same account

---

## 🔧 Step 2: Configure Your Backend

1. **Navigate to the server directory:**
   ```bash
   cd /home/tejas/Programming/PromptLord/server
   ```

2. **Create a `.env` file** (copy from example):
   ```bash
   cp .env.example .env
   ```

3. **Edit the `.env` file:**
   ```bash
   nano .env
   ```
   
   Or use any text editor to add your keys:
   ```env
   GEMINI_API_KEYS=AIzaSyD...,AIzaSyE...,AIzaSyF...
   ```

   **Example with 3 keys:**
   ```env
   GEMINI_API_KEYS=AIzaSyDxxx123abc,AIzaSyExxx456def,AIzaSyFxxx789ghi
   ```

4. **Save the file** (Ctrl+X, then Y, then Enter if using nano)

---

## 🚀 Step 3: Start the Backend

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   node index.js
   ```

3. **Verify it's working:**
   You should see:
   ```
   ✅ Loaded 3 Gemini API key(s)
   🚀 PromptLord Backend running on http://localhost:3000
   📊 Using 3 Gemini API key(s) with round-robin rotation
   ```

4. **Check health status:**
   Open in browser: [http://localhost:3000/health](http://localhost:3000/health)
   
   You'll see:
   ```json
   {
     "status": "healthy",
     "totalKeys": 3,
     "activeKeys": 3,
     "failedKeys": []
   }
   ```

---

## 🎨 How It Works

### Round-Robin Strategy
The backend automatically rotates through your API keys:

```
Request 1 → Key #1
Request 2 → Key #2  
Request 3 → Key #3
Request 4 → Key #1 (cycle repeats)
```

### Automatic Failover
If a key hits rate limits:
1. ✅ It's automatically **marked as failed**
2. ✅ Goes into **1-minute cooldown**
3. ✅ Backend switches to **next available key**
4. ✅ Failed key is **retried after cooldown**

### Smart Retries
- Each request tries up to **3 different keys**
- If all keys fail, user gets a clear error message
- Logs show which key succeeded: `✅ Request successful with API Key #2`

---

## 📊 Monitoring

### View Real-Time Status
```bash
curl http://localhost:3000/health
```

### Server Logs Show:
- ✅ Successful requests: `✅ Request successful with API Key #2`
- ⚠️ Failed keys: `⚠️ API Key #1 marked as failed (fail count: 1)`
- ❌ Errors: `❌ Gemini API Error (Key #3): ...`

---

## 💡 Tips

1. **Start with 3 keys** - This gives you 45 requests/min  
2. **Use different Google accounts** - Easier to manage separate keys
3. **Monitor the `/health` endpoint** - See which keys are active
4. **Add more keys anytime** - Just update `.env` and restart

---

## 🆘 Troubleshooting

### "Error: GEMINI_API_KEYS is not set"
- Make sure you created the `.env` file in the `server/` directory
- Check that your keys are comma-separated with NO spaces after commas

### "All API keys are in cooldown"
- You hit rate limits on all keys
- Wait 1 minute for cooldown to expire
- **Solution:** Add more API keys

### "Invalid API response"
- Double-check your API keys are correct
- Make sure they start with `AIza`
- Verify they're active in Google AI Studio

---

## 📈 Scaling Further

Want to handle even more traffic?

1. **Add 10+ API keys** → 150+ requests/min
2. **Deploy to cloud** (Render, Railway, Heroku)
3. **Use environment variables** on your hosting platform
4. **Set up monitoring** with the `/health` endpoint

---

## 🔐 Security Notes

- ✅ API keys are stored in `.env` (not committed to Git)
- ✅ `.env` is in `.gitignore`
- ✅ Keys are only used server-side
- ⚠️ Never expose keys in frontend code

---

## 🎉 You're All Set!

Your PromptLord extension now uses **FREE** Google Gemini API with automatic load balancing!

**Questions?** Check the main [README.md](README.md) or open an issue.
