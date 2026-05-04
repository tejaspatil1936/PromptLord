#!/bin/bash

# Quick test script for multiple API keys

echo "🧪 Testing Gemini API Key Rotation"
echo "=================================="
echo ""

# Check if server is running
if ! curl -s http://localhost:3000/health > /dev/null; then
    echo "❌ Server is not running!"
    echo "💡 Start it with: cd server && node index.js"
    exit 1
fi

echo "✅ Server is running"
echo ""

# Get health status
echo "📊 Current Status:"
curl -s http://localhost:3000/health | jq '.'
echo ""

# Send test requests
echo "🚀 Sending 5 test requests to see key rotation..."
echo ""

for i in {1..5}; do
    echo "Request $i:"
    response=$(curl -s -X POST http://localhost:3000/enhance \
      -H "Content-Type: application/json" \
      -d '{"prompt":"write a hello world program"}')
    
    echo "$response" | jq -r '.enhancedPrompt // .error' | head -c 100
    echo "..."
    echo ""
    sleep 0.5
done

echo ""
echo "📊 Final Status:"
curl -s http://localhost:3000/health | jq '.'
