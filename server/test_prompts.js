const fetch = require('node-fetch');

// Test cases from implementation plan
const testCases = [
    {
        name: "Generic Prompt with Context Reference",
        input: "explain me the above attached assignment",
        shouldNotContain: ["Python", "data structures", "programming", "code"],
        shouldContain: ["above", "assignment"]
    },
    {
        name: "Vague Prompt",
        input: "make it better",
        shouldContain: ["specify", "improve", "clarif"]
    },
    {
        name: "Question That Shouldn't Be Answered",
        input: "what is the capital of France?",
        shouldNotContain: ["Paris", "paris"],
        shouldContain: ["capital", "France"]
    },
    {
        name: "Well-structured Prompt",
        input: "Write a Python function that validates email addresses using regex",
        shouldContain: ["function", "email", "valid"]
    }
];

async function runTests() {
    console.log("🧪 Testing Prompt Enhancement Logic\n");
    console.log("=".repeat(70) + "\n");

    let passed = 0;
    let failed = 0;

    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];

        // Wait 3 seconds before each request (including first) to avoid rate limiting
        if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
            console.log("   Waiting 3 seconds before first request...\n");
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        console.log(`📝 Test: ${testCase.name}`);
        console.log(`   Input: "${testCase.input}"`);

        try {
            const response = await fetch("http://localhost:3000/enhance", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Origin": "chrome-extension://test"
                },
                body: JSON.stringify({ prompt: testCase.input })
            });

            if (!response.ok) {
                console.log(`   ❌ FAILED: HTTP ${response.status}`);
                failed++;
                continue;
            }

            const data = await response.json();
            const enhanced = data.enhancedPrompt;

            console.log(`   Output: "${enhanced}"\n`);

            // Check for unwanted content
            let testPassed = true;
            if (testCase.shouldNotContain) {
                for (const phrase of testCase.shouldNotContain) {
                    if (enhanced.toLowerCase().includes(phrase.toLowerCase())) {
                        console.log(`   ❌ FAILED: Contains unwanted phrase "${phrase}"`);
                        testPassed = false;
                        break;
                    }
                }
            }

            // Check for required content
            if (testPassed && testCase.shouldContain) {
                for (const phrase of testCase.shouldContain) {
                    if (!enhanced.toLowerCase().includes(phrase.toLowerCase())) {
                        console.log(`   ⚠️  WARNING: Missing expected phrase "${phrase}"`);
                    }
                }
            }

            if (testPassed) {
                console.log(`   ✅ PASSED\n`);
                passed++;
            } else {
                failed++;
            }

            // Wait 3 seconds between requests (rate limit)
            await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (error) {
            console.log(`   ❌ FAILED: ${error.message}\n`);
            failed++;
        }
    }

    console.log("=".repeat(70));
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
    console.log(`✅ Success rate: ${Math.round(passed / testCases.length * 100)}%\n`);
}

runTests().catch(console.error);
