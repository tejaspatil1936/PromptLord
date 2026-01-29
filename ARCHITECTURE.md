# 🔄 Multi-Key Architecture Explained

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      PromptLord Extension                        │
│                     (Browser Extension)                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP Request
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend Server (Node.js)                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           Round-Robin Key Selector                       │   │
│  │  • Tracks current key index                              │   │
│  │  • Monitors failed keys & cooldowns                      │   │
│  │  • Auto-rotates to next available key                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                             │                                    │
│         ┌───────────────────┼───────────────────┐               │
│         ▼                   ▼                   ▼               │
│    ┌────────┐         ┌────────┐         ┌────────┐            │
│    │ Key #1 │         │ Key #2 │         │ Key #3 │            │
│    └────┬───┘         └────┬───┘         └────┬───┘            │
│         │                  │                  │                 │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
          └──────────────────┴──────────────────┘
                             │
                             │ API Calls
                             ▼
          ┌─────────────────────────────────────┐
          │   Google Gemini API (Free Tier)     │
          │   • 15 requests/min per key         │
          │   • 1,500 requests/day per key      │
          └─────────────────────────────────────┘
```

## Request Flow

### Normal Operation (Round-Robin)

```
Request 1  →  [Key #1] → ✅ Success (200)
Request 2  →  [Key #2] → ✅ Success (200)
Request 3  →  [Key #3] → ✅ Success (200)
Request 4  →  [Key #1] → ✅ Success (200)  ← Cycle repeats
Request 5  →  [Key #2] → ✅ Success (200)
```

### Rate Limit Handling (Automatic Failover)

```
Request 1  →  [Key #1] → ❌ Rate Limited (429)
              ↓
              Mark Key #1 as failed (1min cooldown)
              ↓
              Retry with [Key #2] → ✅ Success (200)

Request 2  →  [Key #2] → ✅ Success (200)  ← Key #1 skipped
Request 3  →  [Key #3] → ✅ Success (200)  ← Key #1 skipped
Request 4  →  [Key #2] → ✅ Success (200)  ← Key #1 skipped

... after 1 minute cooldown ...

Request 10 →  [Key #1] → ✅ Success (200)  ← Key #1 back online
```

## Key States

```
┌─────────────┐
│   ACTIVE    │ ← Default state, ready to handle requests
└──────┬──────┘
       │
       │ Rate limit (429) or error
       ▼
┌─────────────┐
│   FAILED    │ ← Marked as failed, enters cooldown
└──────┬──────┘
       │
       │ 60 seconds elapsed
       ▼
┌─────────────┐
│   ACTIVE    │ ← Cooldown expired, back to rotation
└─────────────┘
```

## Configuration Examples

### Single Key (Basic)
```env
GEMINI_API_KEYS=AIzaSyD...
```
**Capacity:** 15 req/min, 1,500 req/day

---

### 3 Keys (Recommended)
```env
GEMINI_API_KEYS=AIzaSyD...,AIzaSyE...,AIzaSyF...
```
**Capacity:** 45 req/min, 4,500 req/day

---

### 5 Keys (High Traffic)
```env
GEMINI_API_KEYS=AIzaSyD...,AIzaSyE...,AIzaSyF...,AIzaSyG...,AIzaSyH...
```
**Capacity:** 75 req/min, 7,500 req/day

---

### 10 Keys (Production Scale)
```env
GEMINI_API_KEYS=key1,key2,key3,key4,key5,key6,key7,key8,key9,key10
```
**Capacity:** 150 req/min, 15,000 req/day

## Benefits

| Feature | Description | Impact |
|---------|-------------|--------|
| **Round-Robin** | Evenly distributes load across all keys | Prevents single key exhaustion |
| **Auto-Failover** | Automatically switches to next key on failure | Zero downtime |
| **Smart Cooldown** | Failed keys rest for 60s before retry | Prevents cascade failures |
| **Retry Logic** | Up to 3 attempts with different keys | Higher success rate |
| **Health Monitoring** | `/health` endpoint shows key status | Easy debugging |

## Monitoring

### Health Endpoint Response
```json
{
  "status": "healthy",
  "totalKeys": 3,
  "activeKeys": 2,
  "failedKeys": [
    {
      "keyIndex": 1,
      "failCount": 2,
      "inCooldown": true
    }
  ]
}
```

### Console Logs
```
✅ Loaded 3 Gemini API key(s)
✅ Request successful with API Key #2
⚠️  API Key #1 marked as failed (fail count: 1)
❌ Gemini API Error (Key #3): Rate limit exceeded
```

## Scaling Strategy

```
Users/Hour  │  Keys Needed  │  Total Capacity
────────────┼───────────────┼─────────────────
< 100       │      1        │  15 req/min
100-500     │      3        │  45 req/min
500-1000    │      5        │  75 req/min
1000-2000   │     10        │ 150 req/min
2000+       │     15+       │ 225+ req/min
```

## Cost Analysis

| Solution | Cost/Month | Requests/Day | Requests/Min |
|----------|-----------|--------------|--------------|
| OpenAI GPT-4 | $30+ | ~1,000 | Limited |
| **Gemini (1 key)** | **$0** | **1,500** | **15** |
| **Gemini (3 keys)** | **$0** | **4,500** | **45** |
| **Gemini (10 keys)** | **$0** | **15,000** | **150** |

🎉 **Winner:** Multiple Gemini keys = **Maximum capacity at $0 cost!**
