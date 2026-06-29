# 🔄 Backend Multi-Key Architecture Explained

> **Scope:** This document describes the **backend** (`server/index.js`) — how it rotates across
> multiple Groq API keys with automatic failover. For the **browser-extension content layer**
> (how the Enhance button is detected, placed, and wired), see
> [`src/content/ARCHITECTURE.md`](src/content/ARCHITECTURE.md).

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
          │      Groq API (Free Tier)           │
          │   • 30 requests/min per key         │
          │   • 500+ tokens/sec throughput      │
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
GROQ_API_KEYS=gsk_abc123...
```
**Capacity:** 30 req/min, Very generous daily limit

---

### 3 Keys (Recommended)
```env
GROQ_API_KEYS=gsk_abc123...,gsk_def456...,gsk_ghi789...
```
**Capacity:** 90 req/min, Very generous daily limit

---

### 5 Keys (High Traffic)
```env
GROQ_API_KEYS=gsk_key1...,gsk_key2...,gsk_key3...,gsk_key4...,gsk_key5...
```
**Capacity:** 150 req/min, Very generous daily limit

---

### 10 Keys (Production Scale)
```env
GROQ_API_KEYS=key1,key2,key3,key4,key5,key6,key7,key8,key9,key10
```
**Capacity:** 300 req/min, Very generous daily limit

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

`GET /health` returns:

```json
{
  "status": "healthy",
  "provider": "Groq",
  "model": "llama-3.1-8b-instant",
  "totalKeys": 3,
  "activeKeys": 2,
  "failedKeys": [
    {
      "keyIndex": 2,
      "failCount": 2,
      "inCooldown": true
    }
  ]
}
```

> `keyIndex` in the response is **1-based** (key #2 above), while `activeKeys = totalKeys − failedKeys.size`.

### Console Logs
```
✅ Loaded 3 Groq API key(s)
✅ Request successful with API Key #2
⚠️  API Key #1 marked as failed (fail count: 1)
❌ Groq API Error (Key #3): Rate limit exceeded
```

## Scaling Strategy

```
Users/Hour  │  Keys Needed  │  Total Capacity
────────────┼───────────────┼─────────────────
< 100       │      1        │  30 req/min
100-500     │      3        │  90 req/min
500-1000    │      5        │ 150 req/min
1000-2000   │     10        │ 300 req/min
2000+       │     15+       │ 450+ req/min
```

## Cost Analysis

| Solution | Cost/Month | Speed | Requests/Min |
|----------|-----------|-------|---------------|
| OpenAI GPT-4 | $30+ | Medium | Limited |
| **Groq API (1 key)** | **$0** | **Very Fast (500+ tok/s)** | **30** |
| **Groq API (3 keys)** | **$0** | **Very Fast (500+ tok/s)** | **90** |
| **Groq API (10 keys)** | **$0** | **Very Fast (500+ tok/s)** | **300** |

🎉 **Winner:** Multiple Groq keys = **Maximum capacity at $0 cost!**
