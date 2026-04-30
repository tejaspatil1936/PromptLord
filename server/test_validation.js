#!/usr/bin/env node

const fetch = require('node-fetch');

const API_URL = 'http://localhost:3000/enhance';

// Test cases for input validation
const testCases = [
    {
        name: "Empty string",
        prompt: "",
        shouldPass: false,
        expectedError: "empty"
    },
    {
        name: "Whitespace only",
        prompt: "     ",
        shouldPass: false,
        expectedError: "whitespace"
    },
    {
        name: "Single character",
        prompt: "a",
        shouldPass: false,
        expectedError: "too short"
    },
    {
        name: "Valid short prompt",
        prompt: "explain this",
        shouldPass: true
    },
    {
        name: "Non-string (number)",
        prompt: 12345,
        shouldPass: false,
        expectedError: "non-empty string"
    },
    {
        name: "Non-string (object)",
        prompt: { text: "hello" },
        shouldPass: false,
        expectedError: "non-empty string"
    },
    {
        name: "Very long prompt (over 5000 chars)",
        prompt: "a".repeat(5001),
        shouldPass: false,
        expectedError: "too long"
    },
    {
        name: "Valid prompt at max length",
        prompt: "a".repeat(5000),
        shouldPass: true
    }
];

async function runTests() {
    console.log('🧪 Testing Input Validation\n');
    console.log('='.repeat(70));

    let passed = 0;
    let failed = 0;

    for (const test of testCases) {
        console.log(`\n📝 Test: ${test.name}`);
        console.log(`   Input type: ${typeof test.prompt}`);
        if (typeof test.prompt === 'string') {
            console.log(`   Input length: ${test.prompt.length} chars`);
        }

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: test.prompt })
            });

            const data = await response.json();

            if (test.shouldPass) {
                if (response.ok && data.enhancedPrompt) {
                    console.log(`   ✅ PASSED - Got enhanced prompt`);
                    passed++;
                } else {
                    console.log(`   ❌ FAILED - Expected success but got: ${response.status}`);
                    console.log(`   Error: ${JSON.stringify(data)}`);
                    failed++;
                }
            } else {
                if (!response.ok && data.error) {
                    console.log(`   ✅ PASSED - Correctly rejected`);
                    console.log(`   Error message: "${data.error}"`);
                    passed++;
                } else {
                    console.log(`   ❌ FAILED - Should have been rejected`);
                    console.log(`   Got: ${JSON.stringify(data)}`);
                    failed++;
                }
            }

        } catch (error) {
            console.log(`   ❌ FAILED - Network error: ${error.message}`);
            failed++;
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n' + '='.repeat(70));
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
    console.log(`✅ Success rate: ${Math.round((passed / testCases.length) * 100)}%`);
}

runTests();
